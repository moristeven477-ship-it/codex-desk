import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { CodexProcess, RpcError } from './codex';
import { Store, settingsPatchSchema } from './store';
import { directoryPath, gitDiff, gitStatus, listFiles, previewFile } from './workspace';
import type { Bootstrap, JsonObject, Model, Thread, Turn } from '../src/shared/types';

const text = z.string().min(1).max(4096);
const threadArgs = z.object({ threadId: text });
const access = z.enum(['read-only', 'workspace-write', 'danger-full-access']).default('workspace-write');
const turnArgs = z.object({
  threadId: text,
  text: z.string().max(200_000).default(''),
  model: z.string().max(256).optional(),
  effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']).optional(),
  access,
  images: z.array(z.string().max(4096)).max(8).default([]),
});

export class DeskService extends EventEmitter {
  readonly codex: CodexProcess;
  readonly store: Store;
  private models: Model[] = [];
  private account: Bootstrap['account'] = null;
  private loaded = new Set<string>();
  private activeTurns = new Map<string, string>();
  private imagePaths = new Set<string>();

  constructor(directory: string, codex = new CodexProcess()) {
    super();
    this.store = new Store(directory);
    this.codex = codex;
    codex.on('event', (event) => {
      if (event.kind === 'connection' && event.connection?.phase !== 'ready') {
        this.loaded.clear();
        this.activeTurns.clear();
      }
      if (event.method === 'turn/started') this.activeTurns.set(event.params.threadId, event.params.turn.id);
      if (event.method === 'turn/completed') this.activeTurns.delete(event.params.threadId);
      this.emit('event', event);
    });
  }
  async init() {
    await this.store.load();
  }
  authorizeImages(paths: string[]) {
    for (const file of paths) this.imagePaths.add(file);
  }
  get runningCount() {
    return this.activeTurns.size;
  }
  async connect() {
    this.models = [];
    this.account = null;
    await this.codex.start(this.store.state.settings);
    const results = await Promise.allSettled([
      this.codex.request<{ data: Model[] }>('model/list', { limit: 100 }),
      this.codex.request<{ account: Bootstrap['account'] }>('account/read', { refreshToken: false }),
    ]);
    if (results[0].status === 'fulfilled') this.models = results[0].value.data;
    if (results[1].status === 'fulfilled') this.account = results[1].value.account;
    for (const result of results)
      if (result.status === 'rejected')
        this.emit('event', { kind: 'notice', message: String(result.reason) });
  }
  private project(id: string) {
    const project = this.store.state.projects.find((p) => p.id === id);
    if (!project) throw new Error('Project not found.');
    return project;
  }
  private async resume(threadId: string) {
    if (this.loaded.has(threadId)) return;
    await this.codex.request('thread/resume', { threadId, excludeTurns: true });
    this.loaded.add(threadId);
  }
  private async history(threadId: string): Promise<Thread> {
    const { thread } = await this.codex.request<{ thread: Thread }>('thread/read', {
      threadId,
      includeTurns: false,
    });
    try {
      const page = await this.codex.request<{ data: Turn[]; nextCursor: string | null }>(
        'thread/turns/list',
        {
          threadId,
          limit: 30,
          sortDirection: 'desc',
          itemsView: 'full',
        },
      );
      return { ...thread, turns: page.data.reverse(), nextTurnsCursor: page.nextCursor };
    } catch (err) {
      if (!(err instanceof RpcError) || ![-32601, -32600, -32602].includes(err.code)) throw err;
      // Older CLI releases predate paginated history.
      return (await this.codex.request<{ thread: Thread }>('thread/read', { threadId, includeTurns: true }))
        .thread;
    }
  }
  async handle(method: string, raw: unknown = {}): Promise<unknown> {
    const params = z.record(z.string(), z.unknown()).parse(raw);
    switch (method) {
      case 'bootstrap':
        return {
          ...this.store.state,
          connection: this.codex.connection,
          models: this.models,
          account: this.account,
          approvals: [...this.codex.approvals.values()],
          appVersion: '0.1.0',
        } satisfies Bootstrap;
      case 'codex.connect': {
        if (this.codex.connection.phase === 'error') await this.codex.stop();
        await this.connect();
        return this.handle('bootstrap');
      }
      case 'codex.restart': {
        if (this.runningCount) throw new Error('Stop running turns before reconnecting Codex.');
        await this.codex.stop();
        await this.connect();
        return this.handle('bootstrap');
      }
      case 'settings.update': {
        const patch = settingsPatchSchema.parse(params);
        for (const key of ['binaryPath', 'codexHome'] as const) {
          if (patch[key] && !path.isAbsolute(patch[key])) throw new Error('Use an absolute path.');
          if (patch[key] !== undefined && patch[key] !== this.store.state.settings[key] && this.runningCount)
            throw new Error('Stop running turns before changing the Codex installation.');
        }
        Object.assign(this.store.state.settings, patch);
        await this.store.save();
        return this.store.state.settings;
      }
      case 'project.add': {
        const args = z.object({ path: text, name: z.string().max(100).optional() }).parse(params);
        const folder = await directoryPath(args.path);
        let project = this.store.state.projects.find((p) => p.path === folder);
        if (!project) {
          project = {
            id: randomUUID(),
            path: folder,
            name: args.name?.trim() || path.basename(folder) || folder,
            createdAt: Date.now(),
          };
          this.store.state.projects.push(project);
          await this.store.save();
        }
        return project;
      }
      case 'project.remove': {
        const { projectId } = z.object({ projectId: text }).parse(params);
        this.project(projectId);
        this.store.state.projects = this.store.state.projects.filter((p) => p.id !== projectId);
        if (this.store.state.settings.lastProjectId === projectId)
          this.store.state.settings.lastProjectId = '';
        await this.store.save();
        return {};
      }
      case 'threads.list': {
        const args = z
          .object({
            cwd: z.string().optional(),
            cursor: z.string().nullable().optional(),
            search: z.string().max(1000).optional(),
            archived: z.boolean().optional(),
          })
          .parse(params);
        return this.codex.request('thread/list', {
          limit: 60,
          sortKey: 'updated_at',
          modelProviders: [],
          sourceKinds: ['cli', 'vscode', 'appServer', 'exec'],
          ...(args.cwd ? { cwd: args.cwd } : {}),
          ...(args.search ? { searchTerm: args.search } : {}),
          cursor: args.cursor ?? null,
          archived: args.archived ?? false,
        });
      }
      case 'thread.read':
        return this.history(threadArgs.parse(params).threadId);
      case 'thread.older': {
        const args = z.object({ threadId: text, cursor: text }).parse(params);
        return this.codex.request('thread/turns/list', {
          ...args,
          limit: 30,
          sortDirection: 'desc',
          itemsView: 'full',
        });
      }
      case 'thread.create': {
        const args = z
          .object({ projectId: text, model: z.string().max(256).optional(), access })
          .parse(params);
        const { thread } = await this.codex.request<{ thread: Thread }>('thread/start', {
          cwd: this.project(args.projectId).path,
          ...(args.model ? { model: args.model } : {}),
          sandbox: args.access,
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
        });
        this.loaded.add(thread.id);
        return thread;
      }
      case 'thread.rename': {
        const args = z.object({ threadId: text, name: z.string().trim().min(1).max(200) }).parse(params);
        await this.codex.request('thread/name/set', args);
        return {};
      }
      case 'thread.archive': {
        const args = threadArgs.parse(params);
        if (this.activeTurns.has(args.threadId))
          throw new Error('Stop this turn before archiving the conversation.');
        await this.codex.request('thread/archive', args);
        this.loaded.delete(args.threadId);
        return {};
      }
      case 'thread.unarchive':
        return this.codex.request('thread/unarchive', threadArgs.parse(params));
      case 'thread.fork': {
        const args = threadArgs.parse(params);
        const { thread } = await this.codex.request<{ thread: Thread }>('thread/fork', {
          ...args,
          excludeTurns: true,
        });
        this.loaded.add(thread.id);
        return this.history(thread.id);
      }
      case 'turn.start': {
        const args = turnArgs.parse(params);
        if (!args.text.trim() && !args.images.length) throw new Error('Enter a message.');
        if (this.activeTurns.has(args.threadId))
          throw new Error('This conversation already has a running turn.');
        for (const image of args.images)
          if (!this.imagePaths.has(image))
            throw new Error('Select image attachments using the attachment picker.');
        await this.resume(args.threadId);
        const sandboxPolicy =
          args.access === 'read-only'
            ? { type: 'readOnly', networkAccess: false }
            : args.access === 'danger-full-access'
              ? { type: 'dangerFullAccess' }
              : {
                  type: 'workspaceWrite',
                  writableRoots: [],
                  networkAccess: false,
                  excludeTmpdirEnvVar: false,
                  excludeSlashTmp: false,
                };
        const input = [
          ...(args.text.trim() ? [{ type: 'text', text: args.text, text_elements: [] }] : []),
          ...args.images.map((file) => ({ type: 'localImage', path: file })),
        ];
        const result = await this.codex.request<{ turn: Turn }>('turn/start', {
          threadId: args.threadId,
          input,
          sandboxPolicy,
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
          ...(args.model ? { model: args.model } : {}),
          ...(args.effort ? { effort: args.effort } : {}),
        });
        // The protocol's turn/started notification is authoritative; it may precede this response.
        return result;
      }
      case 'turn.interrupt': {
        const args = z.object({ threadId: text, turnId: text }).parse(params);
        return this.codex.request('turn/interrupt', args);
      }
      case 'approval.respond':
        return this.respond(params);
      case 'account.login':
        return this.codex.request('account/login/start', { type: 'chatgpt' });
      case 'account.refresh': {
        const result = await this.codex.request<{ account: Bootstrap['account'] }>('account/read', {
          refreshToken: false,
        });
        this.account = result.account;
        return result;
      }
      case 'account.limits':
        return this.codex.request('account/rateLimits/read');
      case 'skills.list': {
        const { projectId } = z.object({ projectId: text }).parse(params);
        return this.codex.request('skills/list', { cwds: [this.project(projectId).path] });
      }
      case 'file.list':
      case 'file.read':
      case 'git.status':
      case 'git.diff': {
        const args = z.object({ projectId: text, path: z.string().max(4096).default('') }).parse(params);
        const root = this.project(args.projectId).path;
        if (method === 'file.list') return listFiles(root, args.path);
        if (method === 'file.read') return previewFile(root, args.path);
        if (method === 'git.status') return gitStatus(root);
        return gitDiff(root, args.path);
      }
      default:
        throw new Error(`Unknown operation: ${method}`);
    }
  }
  private respond(params: JsonObject) {
    const args = z
      .object({
        id: z.union([z.string(), z.number()]),
        decision: z.enum(['accept', 'acceptForSession', 'decline', 'cancel']).optional(),
        answers: z.record(z.string(), z.array(z.string().max(20_000))).optional(),
        content: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(params);
    const request = this.codex.approvals.get(args.id);
    if (!request) throw new Error('This request has already been resolved.');
    let result: JsonObject;
    if (request.method === 'item/tool/requestUserInput') {
      const questions = request.params.questions as { id: string }[];
      result = {
        answers: Object.fromEntries(questions.map((q) => [q.id, { answers: args.answers?.[q.id] ?? [] }])),
      };
    } else if (request.method === 'item/permissions/requestApproval') {
      const requested = request.params.permissions as JsonObject;
      const accepted = args.decision === 'accept' || args.decision === 'acceptForSession';
      result = {
        permissions: accepted ? { network: requested.network, fileSystem: requested.fileSystem } : {},
        scope: args.decision === 'acceptForSession' ? 'session' : 'turn',
      };
    } else if (request.method === 'mcpServer/elicitation/request') {
      result = {
        action: args.decision === 'accept' ? 'accept' : args.decision === 'cancel' ? 'cancel' : 'decline',
        content: args.decision === 'accept' ? (args.content ?? null) : null,
        _meta: null,
      };
    } else {
      if (!args.decision) throw new Error('Choose an approval decision.');
      const available = request.params.availableDecisions;
      if (Array.isArray(available) && !available.includes(args.decision))
        throw new Error('This decision is not offered by Codex.');
      result = { decision: args.decision };
    }
    this.codex.respond(args.id, result);
    return {};
  }
}
