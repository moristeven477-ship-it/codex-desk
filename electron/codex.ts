import { EventEmitter } from 'node:events';
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Approval, CodexEvent, Connection, JsonObject, Settings } from '../src/shared/types';
import { APP_VERSION } from '../src/shared/version';
import { socketReady, startSharedListener } from './shared-server';
import WebSocket from 'ws';

const exec = promisify(execFile);
const supportedRequests = new Set([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/tool/requestUserInput',
  'item/permissions/requestApproval',
  'mcpServer/elicitation/request',
]);
export class RpcError extends Error {
  constructor(
    message: string,
    public code = -1,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export async function findCodex(configured = ''): Promise<{ binary: string; env: NodeJS.ProcessEnv }> {
  const home = homedir();
  const extras = [
    path.join(home, '.npm-global/bin'),
    path.join(home, '.local/bin'),
    path.join(home, '.volta/bin'),
    path.join(home, '.bun/bin'),
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ];
  const nvmRoot = path.join(home, '.nvm/versions/node');
  const versions = await readdir(nvmRoot).catch(() => []);
  versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  extras.push(...versions.map((v) => path.join(nvmRoot, v, 'bin')));
  const paths = [...new Set([...(process.env.PATH ?? '').split(path.delimiter), ...extras].filter(Boolean))];
  const env = { ...process.env, PATH: paths.join(path.delimiter) };
  const candidates = configured ? [configured] : paths.map((p) => path.join(p, 'codex'));
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) continue;
    try {
      await access(candidate, constants.X_OK);
      return { binary: candidate, env };
    } catch {
      /* next */
    }
  }
  throw new Error(
    configured
      ? `Codex executable not found: ${configured}`
      : 'Codex CLI was not found. Install it, or choose its absolute path in Settings.',
  );
}

export class CodexProcess extends EventEmitter {
  connection: Connection = { phase: 'stopped' };
  approvals = new Map<string | number, Approval>();
  private child?: ChildProcessWithoutNullStreams;
  private socket?: WebSocket;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private starting?: Promise<void>;
  private tail = '';
  private generation = 0;

  constructor(
    private timeoutMs = 60_000,
    private transport: 'shared' | 'stdio' = 'shared',
  ) {
    super();
  }
  private publish(event: CodexEvent) {
    this.emit('event', event);
  }
  private status(connection: Connection) {
    this.connection = connection;
    this.publish({ kind: 'connection', connection });
  }

  start(settings: Pick<Settings, 'binaryPath' | 'codexHome'>): Promise<void> {
    if (this.connection.phase === 'ready') return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = this.launch(settings).finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }
  private async launch(settings: Pick<Settings, 'binaryPath' | 'codexHome'>) {
    const generation = ++this.generation;
    this.status({ phase: 'starting' });
    this.tail = '';
    try {
      const { binary, env } = await findCodex(settings.binaryPath);
      if (settings.codexHome) env.CODEX_HOME = settings.codexHome;
      const { stdout: version } = await exec(binary, ['--version'], {
        env,
        timeout: 10_000,
        maxBuffer: 64 * 1024,
      });
      if (generation !== this.generation) throw new Error('Codex startup cancelled.');
      // The daemon owns the writer. Desk and the real TUI are independent subscribers.
      // This command starts it only when absent; never restart a daemon used by other clients.
      const codexHome = env.CODEX_HOME || path.join(homedir(), '.codex');
      const socket = path.join(codexHome, 'app-server-control', 'app-server-control.sock');
      if (this.transport === 'shared' && !(await socketReady(socket))) {
        try {
          await exec(binary, ['app-server', 'daemon', 'start'], {
            env,
            timeout: 20_000,
            maxBuffer: 64 * 1024,
          });
        } catch {
          await startSharedListener(binary, env, socket);
        }
      }
      if (generation !== this.generation) throw new Error('Codex startup cancelled.');
      if (this.transport === 'shared') {
        const client = new WebSocket(`ws+unix://${socket}:/`, {
          headers: { Host: 'localhost' },
          perMessageDeflate: false,
          maxPayload: 32 * 1024 * 1024,
          handshakeTimeout: 10_000,
        });
        this.socket = client;
        client.on('message', (data) => {
          if (generation !== this.generation) return;
          try {
            this.receive(JSON.parse(data.toString()) as JsonObject);
          } catch {
            this.publish({ kind: 'notice', message: 'Ignored a malformed Codex protocol message.' });
          }
        });
        client.on('error', (error) => {
          if (generation === this.generation && this.socket === client) this.fail(error);
        });
        client.on('close', () => {
          if (generation === this.generation && this.socket === client)
            this.fail(new Error('The shared Codex connection closed. Reconnect in Settings.'));
        });
        await new Promise<void>((resolve, reject) => {
          client.once('open', resolve);
          client.once('error', reject);
        });
      } else {
        const child = spawn(binary, ['app-server'], {
          env,
          cwd: homedir(),
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
        this.child = child;
        let buffer = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (s: string) => {
          this.tail = (this.tail + s).slice(-4000);
        });
        child.stdout.on('data', (chunk: string) => {
          if (generation !== this.generation) return;
          buffer += chunk;
          if (buffer.length > 32 * 1024 * 1024) {
            this.fail(new Error('Codex sent an oversized protocol message.'));
            return;
          }
          let newline: number;
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line) continue;
            try {
              this.receive(JSON.parse(line) as JsonObject);
            } catch {
              this.publish({ kind: 'notice', message: 'Ignored a malformed Codex protocol message.' });
            }
          }
        });
        child.on('error', (err) => {
          if (generation === this.generation) this.fail(err);
        });
        child.stdin.on('error', (err) => {
          if (generation === this.generation) this.fail(err);
        });
        child.on('exit', (code, signal) => {
          if (generation !== this.generation) return;
          this.child = undefined;
          this.fail(new Error(`Codex app-server exited (${signal ?? code}). ${this.tail.trim()}`));
        });
      }
      const initialized = await this.request<JsonObject>('initialize', {
        clientInfo: { name: 'codex_desk', title: 'Codex Desk', version: APP_VERSION },
        capabilities: { experimentalApi: true },
      });
      this.write({ method: 'initialized' });
      this.status({
        phase: 'ready',
        binary,
        version: version.trim(),
        pid: this.child?.pid,
        shared: this.transport === 'shared',
        endpoint: this.transport === 'shared' ? 'unix://' : undefined,
        codexHome: String(initialized.codexHome ?? env.CODEX_HOME ?? path.join(homedir(), '.codex')),
      });
    } catch (err) {
      if (generation === this.generation) this.fail(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  request<T = unknown>(method: string, params?: JsonObject): Promise<T> {
    if ((!this.child || this.child.killed) && this.socket?.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error('Codex is not connected. Open Settings to connect.'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject, timer });
      try {
        this.write({ id, method, ...(params === undefined ? {} : { params }) });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }
  private write(message: JsonObject) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
      return;
    }
    if (!this.child?.stdin.writable) throw new Error('Codex input stream is closed.');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  private receive(message: JsonObject) {
    if (typeof message.method === 'string') {
      const params = (message.params ?? {}) as JsonObject;
      if (typeof message.id === 'number' || typeof message.id === 'string') {
        if (message.method === 'currentTime/read') {
          this.write({ id: message.id, result: { currentTimeAt: Math.floor(Date.now() / 1000) } });
          return;
        }
        if (!supportedRequests.has(message.method)) {
          this.write({
            id: message.id,
            error: { code: -32601, message: `Codex Desk does not implement ${message.method}.` },
          });
          this.publish({ kind: 'notice', message: `Unsupported Codex client request: ${message.method}` });
          return;
        }
        const request: Approval = { id: message.id, method: message.method, params, receivedAt: Date.now() };
        this.approvals.set(request.id, request);
        this.publish({ kind: 'request', request });
      } else {
        if (message.method === 'serverRequest/resolved') {
          const id = params.requestId as string | number;
          this.approvals.delete(id);
          this.publish({ kind: 'resolved', id });
        }
        if (message.method === 'turn/completed') {
          for (const [id, approval] of this.approvals) {
            if (
              approval.params.threadId === params.threadId &&
              approval.params.turnId === (params.turn as JsonObject)?.id
            ) {
              this.approvals.delete(id);
              this.publish({ kind: 'resolved', id });
            }
          }
        }
        this.publish({ kind: 'notification', method: message.method, params });
      }
      return;
    }
    const entry = this.pending.get(message.id as number);
    if (!entry) return;
    this.pending.delete(message.id as number);
    clearTimeout(entry.timer);
    if (message.error) {
      const err = message.error as { message: string; code: number };
      entry.reject(new RpcError(err.message, err.code));
    } else entry.resolve(message.result);
  }
  respond(id: string | number, result: JsonObject) {
    if (!this.approvals.has(id)) throw new Error('This request is no longer pending.');
    this.write({ id, result });
    this.approvals.delete(id);
    this.publish({ kind: 'resolved', id });
  }
  private rejectPending(error: Error) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
    for (const id of this.approvals.keys()) this.publish({ kind: 'resolved', id });
    this.approvals.clear();
  }
  private fail(error: Error) {
    this.rejectPending(error);
    const child = this.child;
    this.child = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.removeAllListeners('close');
      socket.terminate();
    }
    if (child && !child.killed) child.kill();
    this.status({ ...this.connection, phase: 'error', error: error.message });
  }
  async stop() {
    ++this.generation;
    const child = this.child;
    this.child = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (socket) socket.close();
    this.rejectPending(new Error('Codex disconnected.'));
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 2500);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        child.stdin.end();
        child.kill('SIGTERM');
      });
    }
    this.status({ phase: 'stopped' });
  }
}
