import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { settingsPatchSchema } from './store';
import type { DeskService } from './service';
import type {
  Bootstrap,
  CodexEvent,
  ImageAttachment,
  ImageUpload,
  JsonObject,
  Settings,
} from '../src/shared/types';

const preferences = settingsPatchSchema
  .pick({ locale: true, theme: true, fontSize: true, lastProjectId: true, lastThreadId: true })
  .strict();
const deviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  hash: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  preferences: preferences.default({}),
});
const configSchema = z.object({
  enabled: z.boolean().default(false),
  publicOrigin: z.string().default(''),
  devices: z.array(deviceSchema).max(20).default([]),
});
type Device = z.infer<typeof deviceSchema>;
type Reply = { ok: true; value: unknown } | { ok: false; error: string };
const operations = new Set([
  'threads.list',
  'thread.read',
  'thread.open',
  'thread.older',
  'thread.create',
  'thread.rename',
  'thread.configure',
  'thread.speed',
  'thread.archive',
  'thread.unarchive',
  'thread.fork',
  'thread.compact',
  'thread.terminalCommand',
  'turn.start',
  'turn.steer',
  'turn.interrupt',
  'approval.respond',
  'goal.get',
  'goal.set',
  'goal.clear',
  'account.limits',
  'skills.list',
  'project.add',
  'project.remove',
  'file.list',
  'file.read',
  'git.status',
  'git.diff',
]);
const reads = new Set([
  'bootstrap',
  'threads.list',
  'thread.read',
  'thread.older',
  'thread.terminalCommand',
  'goal.get',
  'account.limits',
  'skills.list',
  'file.list',
  'file.read',
  'git.status',
  'git.diff',
]);
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
type Options = {
  directory: string;
  assets: string;
  service: DeskService;
  importImages: (uploads: ImageUpload[]) => Promise<ImageAttachment[]>;
  port?: number;
};

/** Loopback only. Tailscale Serve terminates HTTPS; paired devices also need a private session. */
export class RemoteGateway {
  private config = configSchema.parse({});
  private server?: Server;
  private ws = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  private clients = new Map<WebSocket, { deviceId: string; alive: boolean }>();
  private terminals = new Map<string, Set<string>>();
  private requests = new Map<string, { fingerprint: string; result: Promise<Reply>; done: boolean }>();
  private pair?: { hash: string; expiresAt: number };
  private attempts: number[] = [];
  private heartbeat?: ReturnType<typeof setInterval>;
  private saving = Promise.resolve();
  private connection?: Promise<unknown>;
  private generation = 0;
  constructor(private options: Options) {}
  async init() {
    try {
      this.config = configSchema.parse(JSON.parse(await readFile(this.file, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (this.config.enabled) await this.start();
  }
  private get file() {
    return path.join(this.options.directory, 'remote.json');
  }
  private async save() {
    const data = JSON.stringify(this.config);
    this.saving = this.saving
      .catch(() => {})
      .then(async () => {
        await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
        await writeFile(this.file + '.tmp', data, { mode: 0o600 });
        await rename(this.file + '.tmp', this.file);
      });
    await this.saving;
  }
  get status() {
    const address = this.server?.address();
    const port = address && typeof address !== 'string' ? address.port : (this.options.port ?? 43125);
    return {
      enabled: !!this.server,
      port,
      publicOrigin: this.config.publicOrigin,
      localOrigin: `http://127.0.0.1:${port}`,
      devices: this.config.devices
        .filter((d) => d.expiresAt > Date.now())
        .map(({ id, name, createdAt, expiresAt }) => ({
          id,
          name,
          createdAt,
          expiresAt,
          online: [...this.clients.values()].some((c) => c.deviceId === id),
        })),
    };
  }
  async setOrigin(value: string) {
    if (value) {
      const url = new URL(value);
      if (
        url.protocol !== 'https:' ||
        !/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/i.test(url.hostname) ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      )
        throw new Error('Use the HTTPS address supplied by Tailscale Serve.');
      value = url.origin;
    }
    this.config.publicOrigin = value;
    await this.save();
    return this.status;
  }
  async start() {
    if (this.server) return this.status;
    const server = createServer((request, response) => void this.handle(request, response));
    server.requestTimeout = 30_000;
    server.headersTimeout = 10_000;
    server.on('upgrade', (request, socket, head) => {
      try {
        this.checkHost(request);
        if (new URL(request.url!, this.status.localOrigin).pathname !== '/v1/events')
          throw new HttpError(404, 'Not found');
        this.checkOrigin(request);
        const device = this.authenticate(request);
        this.ws.handleUpgrade(request, socket, head, (client) => {
          this.clients.set(client, { deviceId: device.id, alive: true });
          client.on('pong', () => {
            const state = this.clients.get(client);
            if (state) state.alive = true;
          });
          client.on('close', () => this.clients.delete(client));
          client.on('error', () => this.clients.delete(client));
          client.send(JSON.stringify({ kind: 'remote', online: true }));
        });
      } catch {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.options.port ?? 43125, '127.0.0.1', resolve);
    });
    this.server = server;
    this.generation++;
    this.config.enabled = true;
    this.options.service.on('event', this.broadcast);
    this.heartbeat = setInterval(() => {
      for (const [client, state] of this.clients) {
        if (
          !state.alive ||
          !this.config.devices.some((d) => d.id === state.deviceId && d.expiresAt > Date.now())
        )
          client.terminate();
        else {
          state.alive = false;
          client.ping();
        }
      }
    }, 15_000);
    this.heartbeat.unref();
    await this.save();
    return this.status;
  }
  async stop(persist = true) {
    this.generation++;
    const server = this.server;
    this.server = undefined;
    clearInterval(this.heartbeat);
    this.options.service.off('event', this.broadcast);
    for (const client of this.clients.keys()) client.terminate();
    this.clients.clear();
    for (const ids of this.terminals.values()) for (const id of ids) this.options.service.terminal.stop(id);
    this.terminals.clear();
    this.pair = undefined;
    this.requests.clear();
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (persist) {
      this.config.enabled = false;
      await this.save();
    }
    return this.status;
  }
  createPairing() {
    if (!this.server) throw new Error('Start remote access first.');
    const code = randomBytes(16).toString('base64url');
    this.pair = { hash: hash(code), expiresAt: Date.now() + 5 * 60_000 };
    return { code, expiresAt: this.pair.expiresAt, publicOrigin: this.config.publicOrigin };
  }
  async revoke(id: string) {
    this.config.devices = this.config.devices.filter((d) => d.id !== id);
    for (const [client, state] of this.clients) if (state.deviceId === id) client.terminate();
    for (const terminal of this.terminals.get(id) ?? []) this.options.service.terminal.stop(terminal);
    this.terminals.delete(id);
    for (const key of this.requests.keys()) if (key.startsWith(id + ':')) this.requests.delete(key);
    await this.save();
    return this.status;
  }
  private broadcast = (event: CodexEvent) => {
    for (const [client, state] of this.clients) {
      if (event.kind === 'terminal' && !this.terminals.get(state.deviceId)?.has(event.terminalId!)) continue;
      if (event.kind === 'navigate') continue; // Each screen keeps its own selected conversation.
      if (client.bufferedAmount > 2 * 1024 * 1024) client.terminate();
      else if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(event));
    }
  };
  private checkHost(request: IncomingMessage) {
    const allowed = [new URL(this.status.localOrigin).host];
    if (this.config.publicOrigin) allowed.push(new URL(this.config.publicOrigin).host);
    if (!allowed.includes(request.headers.host ?? '')) throw new HttpError(403, 'Unrecognized host.');
  }
  private checkOrigin(request: IncomingMessage) {
    const host = request.headers.host;
    const expected =
      host === new URL(this.status.localOrigin).host ? this.status.localOrigin : this.config.publicOrigin;
    if (request.headers.origin !== expected) throw new HttpError(403, 'Unrecognized origin.');
  }
  private authenticate(request: IncomingMessage) {
    const token = /(?:^|;\s*)cd_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(request.headers.cookie ?? '')?.[1];
    const device =
      token && this.config.devices.find((d) => d.hash === hash(token) && d.expiresAt > Date.now());
    if (!device) throw new HttpError(401, 'Pair this device from Codex Desk on your computer.');
    return device;
  }
  private async body(request: IncomingMessage, limit = 1_000_000) {
    if (!request.headers['content-type']?.startsWith('application/json'))
      throw new HttpError(415, 'JSON required.');
    if (Number(request.headers['content-length'] ?? 0) > limit)
      throw new HttpError(413, 'Request too large.');
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request) {
      length += chunk.length;
      if (length > limit) throw new HttpError(413, 'Request too large.');
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      throw new HttpError(400, 'Invalid JSON.');
    }
  }
  private json(response: ServerResponse, code: number, body: unknown) {
    response.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(body));
  }
  private async bootstrap(device: Device) {
    const boot = (await this.options.service.handle('bootstrap')) as Bootstrap;
    return {
      ...boot,
      settings: { ...boot.settings, ...device.preferences, binaryPath: '', codexHome: '' },
      connection: {
        phase: boot.connection.phase,
        version: boot.connection.version,
        shared: true,
        error: boot.connection.error,
      },
    };
  }
  private async rpc(device: Device, method: string, params: JsonObject): Promise<unknown> {
    if (method === 'bootstrap') return this.bootstrap(device);
    if (method === 'codex.connect') {
      if (this.options.service.codex.connection.phase !== 'ready') {
        this.connection ??= this.options.service.handle('codex.connect').finally(() => {
          this.connection = undefined;
        });
        await this.connection;
      }
      return this.bootstrap(device);
    }
    if (method === 'settings.update') {
      Object.assign(device.preferences, preferences.parse(params));
      await this.save();
      return (await this.bootstrap(device)).settings;
    }
    if (method.startsWith('terminal.')) {
      const ids = this.terminals.get(device.id) ?? new Set<string>();
      this.terminals.set(device.id, ids);
      if (method === 'terminal.start') {
        const generation = this.generation;
        const result = (await this.options.service.handle(method, params)) as { id: string };
        if (generation !== this.generation || !this.config.devices.includes(device)) {
          this.options.service.terminal.stop(result.id);
          throw new Error('Remote session closed.');
        }
        ids.add(result.id);
        return result;
      }
      if (
        !['terminal.stop', 'terminal.write', 'terminal.resize'].includes(method) ||
        !ids.has(String(params.id))
      )
        throw new Error('This terminal belongs to another client.');
      return this.options.service.handle(method, params);
    }
    if (!operations.has(method)) throw new Error('This operation is only available on the computer.');
    return this.options.service.handle(method, params);
  }
  private async handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    try {
      this.checkHost(request);
      const url = new URL(request.url!, this.status.localOrigin);
      if (request.method === 'POST') this.checkOrigin(request);
      if (request.method === 'POST' && url.pathname === '/v1/pair') {
        this.attempts = this.attempts.filter((t) => t > Date.now() - 60_000);
        if (this.attempts.length >= 8) throw new HttpError(429, 'Wait one minute before trying again.');
        this.attempts.push(Date.now());
        const input = z
          .object({ code: z.string().max(128), name: z.string().trim().min(1).max(80) })
          .strict()
          .parse(await this.body(request, 1024));
        const pair = this.pair;
        if (
          !pair ||
          pair.expiresAt < Date.now() ||
          !timingSafeEqual(Buffer.from(pair.hash), Buffer.from(hash(input.code.trim())))
        )
          throw new HttpError(401, 'Invalid or expired pairing code.');
        this.pair = undefined;
        this.config.devices = this.config.devices.filter((d) => d.expiresAt > Date.now());
        if (this.config.devices.length >= 20) throw new HttpError(409, 'Remove an old paired device first.');
        const token = randomBytes(32).toString('base64url');
        const device: Device = {
          id: randomUUID(),
          name: input.name,
          hash: hash(token),
          createdAt: Date.now(),
          expiresAt: Date.now() + 30 * 86400_000,
          preferences: {},
        };
        this.config.devices.push(device);
        await this.save();
        const secure = request.headers.host !== new URL(this.status.localOrigin).host;
        response.setHeader(
          'Set-Cookie',
          `cd_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure ? '; Secure' : ''}`,
        );
        this.json(response, 200, { ok: true });
        return;
      }
      if (url.pathname.startsWith('/v1/')) {
        const device = this.authenticate(request);
        if (request.method === 'GET' && url.pathname === '/v1/session') {
          this.json(response, 200, { name: device.name, expiresAt: device.expiresAt });
          return;
        }
        if (request.method === 'POST' && url.pathname === '/v1/logout') {
          await this.revoke(device.id);
          response.setHeader('Set-Cookie', 'cd_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
          this.json(response, 200, { ok: true });
          return;
        }
        if (request.method === 'POST' && url.pathname === '/v1/images') {
          const input = z
            .object({
              name: z.string().min(1).max(255),
              base64: z
                .string()
                .max(28_000_000)
                .regex(/^[A-Za-z0-9+/]+={0,2}$/),
            })
            .strict()
            .parse(await this.body(request, 28_000_400));
          const result = await this.options.importImages([
            { name: input.name, bytes: Buffer.from(input.base64, 'base64') },
          ]);
          this.options.service.authorizeImages(result.map((i) => i.path));
          this.json(response, 200, result);
          return;
        }
        if (request.method === 'POST' && url.pathname === '/v1/rpc') {
          const { id, method, params } = z
            .object({
              id: z.string().uuid(),
              method: z.string().max(100),
              params: z.record(z.string(), z.unknown()).default({}),
            })
            .strict()
            .parse(await this.body(request));
          const key = device.id + ':' + id,
            fingerprint = hash(JSON.stringify({ method, params }));
          let cached = this.requests.get(key);
          if (cached && cached.fingerprint !== fingerprint)
            throw new HttpError(409, 'Request ID already used.');
          if (!cached) {
            if ([...this.requests.values()].filter((r) => !r.done).length >= 32)
              throw new HttpError(429, 'Too many pending requests.');
            while (this.requests.size >= 128) {
              const first = [...this.requests].find(([, r]) => r.done);
              if (!first) break;
              this.requests.delete(first[0]);
            }
            const result = this.rpc(device, method, params).then(
              (value) => ({ ok: true as const, value }),
              (error) => ({
                ok: false as const,
                error: error instanceof Error ? error.message : String(error),
              }),
            );
            cached = { fingerprint, result, done: false };
            this.requests.set(key, cached);
            void result.then(() => {
              cached!.done = true;
              // History and file reads can be large; retain only mutation receipts for retries.
              if (reads.has(method)) this.requests.delete(key);
            });
          }
          this.json(response, 200, await cached.result);
          return;
        }
        throw new HttpError(404, 'Not found.');
      }
      if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!/^(index\.html|icon\.(svg|png)|assets\/[A-Za-z0-9_.-]+\.(js|css|woff2?))$/.test(file))
        throw new HttpError(404, 'Not found.');
      const data = await readFile(path.join(this.options.assets, file));
      const types: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.woff2': 'font/woff2',
      };
      response.writeHead(200, {
        'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
        'Cache-Control': file.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-store',
      });
      response.end(data);
    } catch (error) {
      if (!response.headersSent && !response.destroyed)
        this.json(
          response,
          error instanceof HttpError
            ? error.status
            : (error as NodeJS.ErrnoException).code === 'ENOENT'
              ? 404
              : 400,
          { error: error instanceof Error ? error.message : 'Request failed.' },
        );
    }
  }
}
