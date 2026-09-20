import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { homedir } from 'node:os';
import { mkdir } from 'node:fs/promises';
import { z } from 'zod';
import { CodexProcess, RpcError } from './codex';
import { Store, settingsPatchSchema } from './store';
import { directoryPath, gitDiff, gitStatus, listFiles, previewFile } from './workspace';
import type { Bootstrap, CodexEvent, JsonObject, Model, Thread, ThreadGoal, Turn } from '../src/shared/types';
import { CodexTerminal } from './pty';
import type { TerminalCommand } from './terminal';
import { APP_VERSION } from '../src/shared/version';
import { isWriterConflict } from '../src/shared/errors';
import { permissionOverride, threadPermissions } from '../src/shared/permissions';
import { storedThreadContext } from './thread-context';
import { isFastTier } from '../src/shared/speed';

const text = z.string().min(1).max(4096);
const threadArgs = z.object({ threadId: text });
const access = z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional();
const turnArgs = z.object({
  threadId: text,
  text: z.string().max(200_000).default(''),
  model: z.string().max(256).optional(),
  effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']).optional(),
  access,
  images: z.array(z.string().max(4096)).max(8).default([]),
  collaborationMode: z.enum(['default', 'plan']).optional(),
});
const steerArgs = turnArgs
  .pick({ threadId: true, text: true, images: true })
  .extend({
    expectedTurnId: text,
    clientUserMessageId: z.string().min(1).max(256).optional(),
  })
  .strict();

export class DeskService extends EventEmitter {
  readonly codex: CodexProcess;
  readonly store: Store;
  readonly terminal: CodexTerminal;
  private models: Model[] = [];
  private account: Bootstrap['account'] = null;
  private loaded = new Set<string>();
  private resuming = new Map<string, Promise<void>>();
  private runtime = new Map<string, Partial<Thread>>();
  private activeTurns = new Map<string, string>();
  private imagePaths = new Set<string>();
  private pristine = new Set<string>();

  constructor(directory: string, codex = new CodexProcess()) {
    super();
    this.store = new Store(directory);
    this.codex = codex;
    this.terminal = new CodexTerminal((event) => this.emit('event', event));
    codex.on('event', (event) => {
      if (event.kind === 'connection' && event.connection?.phase !== 'ready') {
        this.loaded.clear();
        this.resuming.clear();
        this.runtime.clear();
        this.activeTurns.clear();
      }
      if (event.method === 'turn/started') {
        this.activeTurns.set(event.params.threadId, event.params.turn.id);
        this.pristine.delete(event.params.threadId);
      }
      if (event.method === 'turn/completed') this.activeTurns.delete(event.params.threadId);
      if (event.method === 'thread/closed') {
        this.loaded.delete(event.params.threadId);
        this.activeTurns.delete(event.params.threadId);
        this.runtime.delete(event.params.threadId);
      }
      if (event.method === 'thread/settings/updated') {
        const settings = event.params.threadSettings;
        this.runtime.set(event.params.threadId, {
          ...this.runtime.get(event.params.threadId),
          model: settings.model,
          ...(settings.serviceTier !== undefined ? { serviceTier: settings.serviceTier } : {}),
          reasoningEffort: settings.effort,
          collaborationMode: settings.collaborationMode?.mode,
          ...threadPermissions(settings),
        });
      }
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
    if (this.resuming.has(threadId)) return this.resuming.get(threadId);
    const operation = (async () => {
      let overrides: JsonObject = {};
      // Live CLI state always wins. Only an unloaded legacy thread needs its saved
      // context restored: app-server otherwise replaces its sandbox with defaults.
      let cursor: string | null = null,
        live = false;
      do {
        const page: { data: string[]; nextCursor: string | null } = await this.codex.request(
          'thread/loaded/list',
          { limit: 100, cursor },
        );
        live = page.data.includes(threadId);
        cursor = page.nextCursor;
      } while (!live && cursor);
      if (!live) {
        const { thread } = await this.codex.request<{ thread: Thread }>('thread/read', {
          threadId,
          includeTurns: false,
        });
        overrides = (
          await storedThreadContext(
            this.codex.connection.codexHome ||
              this.store.state.settings.codexHome ||
              path.join(homedir(), '.codex'),
            thread,
          )
        ).resume;
      }
      const result = await this.codex.request<{
        thread: Thread;
        model?: string;
        serviceTier?: string | null;
        reasoningEffort?: string;
        sandbox?: { type: string };
        approvalPolicy?: Thread['approvalPolicy'];
        approvalsReviewer?: string;
        activePermissionProfile?: Thread['activePermissionProfile'];
      }>('thread/resume', { threadId, excludeTurns: true, ...overrides });
      this.runtime.set(threadId, {
        ...this.runtime.get(threadId),
        ...(result.model ? { model: result.model } : {}),
        ...(result.serviceTier !== undefined ? { serviceTier: result.serviceTier } : {}),
        ...(result.reasoningEffort ? { reasoningEffort: result.reasoningEffort } : {}),
        ...threadPermissions(result),
      });
      this.loaded.add(threadId);
    })();
    this.resuming.set(threadId, operation);
    try {
      await operation;
    } finally {
      if (this.resuming.get(threadId) === operation) this.resuming.delete(threadId);
    }
  }
  get defaultWorkspace() {
    return this.store.state.settings.defaultWorkspace || path.join(homedir(), 'Codex', 'workspace');
  }
  private updateThreadSettings(
    threadId: string,
    overrides: JsonObject,
    matches: (settings: JsonObject) => boolean,
    timeoutMessage: string,
  ) {
    // The response only acknowledges queueing. Use the actual settings event
    // before enabling another send, and never invent an optimistic CLI setting.
    return new Promise<void>((resolve, reject) => {
      let acknowledged = false,
        applied = false;
      const cleanup = () => {
        clearTimeout(timer);
        this.codex.off('event', receive);
      };
      const finish = () => {
        if (acknowledged && applied) {
          cleanup();
          resolve();
        }
      };
      const receive = (event: CodexEvent) => {
        if (event.method !== 'thread/settings/updated' || event.params?.threadId !== threadId) return;
        if (!matches(event.params.threadSettings as JsonObject)) return;
        applied = true;
        finish();
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(timeoutMessage));
      }, 10_000);
      this.codex.on('event', receive);
      void this.codex
        .request('thread/settings/update', { threadId, ...overrides })
        .then(() => {
          acknowledged = true;
          finish();
        })
        .catch((error) => {
          cleanup();
          reject(error);
        });
    });
  }
  private async history(threadId: string): Promise<Thread> {
    const { thread } = await this.codex.request<{ thread: Thread }>('thread/read', {
      threadId,
      includeTurns: false,
    });
    if (this.pristine.has(threadId)) return { ...thread, turns: [] };
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
          appVersion: APP_VERSION,
          defaultWorkspace: this.defaultWorkspace,
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
        if (patch.defaultWorkspace && !path.isAbsolute(patch.defaultWorkspace))
          throw new Error('Use an absolute workspace path.');
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
      case 'thread.open': {
        const args = z.object({ threadId: text, archived: z.boolean().default(false) }).parse(params);
        if (args.archived) return this.history(args.threadId);
        try {
          await this.resume(args.threadId);
        } catch (error) {
          if (!isWriterConflict(error)) throw error;
          const thread = await this.history(args.threadId);
          const context = await storedThreadContext(
            this.codex.connection.codexHome ||
              this.store.state.settings.codexHome ||
              path.join(homedir(), '.codex'),
            thread,
          );
          return { ...thread, ...context.display, syncState: 'external' } satisfies Thread;
        }
        const thread = {
          ...(await this.history(args.threadId)),
          ...this.runtime.get(args.threadId),
          syncState: 'live' as const,
        };
        const active =
          thread.status.type === 'active' && thread.turns.findLast((turn) => turn.status === 'inProgress');
        if (active) this.activeTurns.set(thread.id, active.id);
        return thread;
      }
      case 'thread.terminalCommand': {
        const { thread } = await this.codex.request<{ thread: Thread }>('thread/read', {
          ...threadArgs.parse(params),
          includeTurns: false,
        });
        const binary = this.codex.connection.binary;
        if (!binary) throw new Error('Connect Codex before opening a terminal.');
        const args = ['--remote', 'unix://', 'resume', thread.id];
        const codexHome = this.codex.connection.codexHome || homedir() + '/.codex';
        const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
        return {
          binary,
          args,
          cwd: thread.cwd,
          codexHome,
          command: ['env', `CODEX_HOME=${codexHome}`, binary, ...args].map(quote).join(' '),
        };
      }
      case 'terminal.start': {
        const args = z
          .object({
            threadId: text,
            cols: z.number().int().min(20).max(500),
            rows: z.number().int().min(5).max(300),
          })
          .parse(params);
        const command = (await this.handle('thread.terminalCommand', {
          threadId: args.threadId,
        })) as TerminalCommand;
        return this.terminal.start(command, args.cols, args.rows);
      }
      case 'terminal.write': {
        const args = z.object({ id: text, data: z.string().max(65536) }).parse(params);
        this.terminal.send(args.id, { type: 'write', data: args.data });
        return {};
      }
      case 'terminal.resize': {
        const args = z
          .object({
            id: text,
            cols: z.number().int().min(20).max(500),
            rows: z.number().int().min(5).max(300),
          })
          .parse(params);
        this.terminal.send(args.id, { type: 'resize', cols: args.cols, rows: args.rows });
        return {};
      }
      case 'terminal.stop': {
        this.terminal.stop(z.object({ id: text }).parse(params).id);
        return {};
      }
      case 'goal.get':
        return this.codex.request<{ goal: ThreadGoal | null }>('thread/goal/get', threadArgs.parse(params));
      case 'goal.set': {
        const args = z
          .object({
            threadId: text,
            objective: z.string().trim().min(1).max(200_000).optional(),
            status: z.enum(['active', 'paused']).optional(),
            tokenBudget: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
          })
          .parse(params);
        await this.resume(args.threadId);
        return this.codex.request('thread/goal/set', args);
      }
      case 'goal.clear': {
        const args = threadArgs.parse(params);
        await this.resume(args.threadId);
        return this.codex.request('thread/goal/clear', args);
      }
      case 'thread.compact': {
        const args = threadArgs.parse(params);
        await this.resume(args.threadId);
        // A CLI turn may already be running when Desk joins the thread, before
        // this client has received any turn/started notification.
        const { thread } = await this.codex.request<{ thread: Thread }>('thread/read', {
          ...args,
          includeTurns: false,
        });
        if (this.activeTurns.has(args.threadId) || thread.status.type === 'active')
          throw new Error('Wait for the running turn before compacting.');
        return this.codex.request('thread/compact/start', args);
      }
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
          .object({ projectId: text.optional(), model: z.string().max(256).optional(), access })
          .parse(params);
        let project;
        if (args.projectId) project = this.project(args.projectId);
        else {
          await mkdir(this.defaultWorkspace, { recursive: true });
          project = (await this.handle('project.add', {
            path: this.defaultWorkspace,
            name: 'Codex Workspace',
          })) as { id: string; path: string };
        }
        const overrides = permissionOverride(args.access);
        const result = await this.codex.request<{ thread: Thread } & JsonObject>('thread/start', {
          cwd: project.path,
          ephemeral: false,
          ...(args.model ? { model: args.model } : {}),
          ...(args.access
            ? {
                sandbox: args.access,
                approvalPolicy: overrides.approvalPolicy,
                approvalsReviewer: overrides.approvalsReviewer,
              }
            : {}),
        });
        const { thread } = result;
        this.runtime.set(thread.id, {
          ...threadPermissions(result),
          model: (result.model as string | undefined) ?? thread.model,
          reasoningEffort: (result.reasoningEffort as string | undefined) ?? thread.reasoningEffort,
          ...(result.serviceTier !== undefined ? { serviceTier: result.serviceTier as string | null } : {}),
        });
        this.loaded.add(thread.id);
        this.pristine.add(thread.id);
        // Save the reported Git branch through Codex's metadata API. This
        // materializes the empty thread before another client resumes its ID,
        // without inserting a message, goal, or placeholder conversation name.
        await this.codex.request('thread/metadata/update', {
          threadId: thread.id,
          gitInfo: { branch: thread.gitInfo?.branch ?? null },
        });
        await this.codex.request('thread/read', { threadId: thread.id, includeTurns: true });
        return { ...thread, ...this.runtime.get(thread.id), syncState: 'live' } satisfies Thread;
      }
      case 'thread.rename': {
        const args = z.object({ threadId: text, name: z.string().trim().min(1).max(200) }).parse(params);
        await this.codex.request('thread/name/set', args);
        return {};
      }
      case 'thread.configure': {
        const args = z
          .object({ threadId: text, access: z.enum(['read-only', 'workspace-write', 'danger-full-access']) })
          .parse(params);
        await this.resume(args.threadId);
        if (this.activeTurns.has(args.threadId))
          throw new Error('Wait for the running turn before changing startup mode.');
        const overrides = permissionOverride(args.access);
        await this.updateThreadSettings(
          args.threadId,
          overrides,
          (incoming) => {
            const settings = threadPermissions(incoming);
            return (
              settings.permissionMode === args.access && settings.approvalPolicy === overrides.approvalPolicy
            );
          },
          'Codex has not confirmed the startup mode. Try selecting it again.',
        );
        return {};
      }
      case 'thread.speed': {
        const args = z
          .object({ threadId: text, serviceTier: z.enum(['priority', 'fast']).nullable() })
          .parse(params);
        await this.resume(args.threadId);
        if (this.activeTurns.has(args.threadId))
          throw new Error('Wait for the running turn before changing Fast mode.');
        await this.updateThreadSettings(
          args.threadId,
          { serviceTier: args.serviceTier },
          (settings) =>
            args.serviceTier === null
              ? settings.serviceTier === null || settings.serviceTier === 'default'
              : isFastTier(settings.serviceTier as string | null | undefined),
          'Codex has not confirmed Fast mode. Try selecting it again.',
        );
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
          deferGoalContinuation: true,
        });
        this.loaded.add(thread.id);
        return { ...(await this.history(thread.id)), syncState: 'live' } satisfies Thread;
      }
      case 'turn.start': {
        const args = turnArgs.parse(params);
        if (!args.text.trim() && !args.images.length) throw new Error('Enter a message.');
        if (this.activeTurns.has(args.threadId))
          throw new Error('This conversation already has a running turn.');
        for (const image of args.images)
          if (!this.imagePaths.has(image))
            throw new Error('Attach images using the attachment picker or paste them into the composer.');
        await this.resume(args.threadId);
        const input = [
          ...(args.text.trim() ? [{ type: 'text', text: args.text, text_elements: [] }] : []),
          ...args.images.map((file) => ({ type: 'localImage', path: file })),
        ];
        const result = await this.codex.request<{ turn: Turn }>('turn/start', {
          threadId: args.threadId,
          input,
          ...permissionOverride(args.access),
          ...(args.model ? { model: args.model } : {}),
          ...(args.effort ? { effort: args.effort } : {}),
          ...(args.collaborationMode
            ? {
                collaborationMode: {
                  mode: args.collaborationMode,
                  settings: {
                    model:
                      args.model ||
                      this.runtime.get(args.threadId)?.model ||
                      this.models.find((model) => model.isDefault)?.model,
                    reasoning_effort: args.effort || null,
                    developer_instructions: null,
                  },
                },
              }
            : {}),
        });
        // The protocol's turn/started notification is authoritative; it may precede this response.
        return result;
      }
      case 'turn.steer': {
        const args = steerArgs.parse(params);
        if (!args.text.trim() && !args.images.length) throw new Error('Enter a message.');
        for (const image of args.images)
          if (!this.imagePaths.has(image))
            throw new Error('Attach images using the attachment picker or paste them into the composer.');
        await this.resume(args.threadId);
        // The server checks the expected ID atomically. Never turn a rejected steer into a new task.
        return this.codex.request<{ turnId: string }>('turn/steer', {
          threadId: args.threadId,
          expectedTurnId: args.expectedTurnId,
          ...(args.clientUserMessageId ? { clientUserMessageId: args.clientUserMessageId } : {}),
          input: [
            ...(args.text.trim() ? [{ type: 'text', text: args.text, text_elements: [] }] : []),
            ...args.images.map((file) => ({ type: 'localImage', path: file })),
          ],
        });
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
