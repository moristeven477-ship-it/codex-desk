// Exercise the installed CLI using a private home and synthetic loopback provider.
// No account, external model request or user conversation is used.
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DeskService } from '../electron/service';
import { CodexProcess } from '../electron/codex';
import { socketReady } from '../electron/shared-server';
import { compactionFailure } from '../src/shared/errors';
import type { CodexEvent, Thread, Turn } from '../src/shared/types';

const root = await mkdtemp(path.join(tmpdir(), 'desk-real-compact-'));
const cliHome = path.join(root, 'cli');
const socket = path.join(cliHome, 'app-server-control/app-server-control.sock');
let filtered = false;
let requests = 0;
let sequence = 0;
function event(response: ServerResponse, type: string, data: object) {
  response.write(
    `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...data })}\n\n`,
  );
}
const provider = createServer(async (request, response) => {
  if (request.method !== 'POST' || !request.url?.endsWith('/responses')) {
    response.writeHead(404).end();
    return;
  }
  for await (const chunk of request) void chunk;
  const id = `resp_${++requests}`;
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  event(response, 'response.created', { response: { id, status: 'in_progress' } });
  if (filtered) {
    event(response, 'response.incomplete', {
      response: { id, status: 'incomplete', incomplete_details: { reason: 'content_filter' } },
    });
  } else {
    const item = {
      id: `msg_${requests}`,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'Synthetic compaction summary.', annotations: [] }],
    };
    event(response, 'response.output_item.added', {
      output_index: 0,
      item: { ...item, status: 'in_progress', content: [] },
    });
    event(response, 'response.output_item.done', { output_index: 0, item });
    event(response, 'response.completed', {
      response: {
        id,
        object: 'response',
        status: 'completed',
        output: [item],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      },
    });
  }
  response.end();
});
await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
const address = provider.address() as { port: number };
await mkdir(path.dirname(socket), { recursive: true });
await writeFile(
  path.join(cliHome, 'config.toml'),
  `model = "gpt-5.4"
model_provider = "local_fixture"
approval_policy = "never"
sandbox_mode = "danger-full-access"
[model_providers.local_fixture]
name = "Local compaction validation"
base_url = "http://127.0.0.1:${address.port}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0
stream_idle_timeout_ms = 15000
`,
);
const binary = process.env.DESK_LIVE_BINARY || 'codex';
const server = spawn(binary, ['app-server', '--listen', `unix://${socket}`], {
  cwd: root,
  env: { ...process.env, CODEX_HOME: cliHome },
  detached: true,
  stdio: 'ignore',
});
const desk = new DeskService(path.join(root, 'desk'));
const cli = new CodexProcess();
const events: CodexEvent[] = [];
desk.on('event', (event) => events.push(event));
function isCompactionItem(event: CodexEvent) {
  return (event.params?.item as { type?: string } | undefined)?.type === 'contextCompaction';
}
async function until(check: () => boolean | Promise<boolean>, description: string) {
  const deadline = Date.now() + 30_000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, description);
    await delay(50);
  }
}
async function completedAfter(index: number) {
  await until(
    () => events.slice(index).some((e) => e.method === 'turn/completed'),
    'compaction did not complete',
  );
  return events.slice(index).find((e) => e.method === 'turn/completed')!.params!.turn as Turn;
}
try {
  await until(() => socketReady(socket), 'isolated app-server did not start');
  await desk.init();
  await desk.handle('settings.update', {
    ...(path.isAbsolute(binary) ? { binaryPath: binary } : {}),
    codexHome: cliHome,
    defaultWorkspace: path.join(root, 'workspace'),
  });
  await desk.connect();
  await cli.start(desk.store.state.settings);
  const thread = (await desk.handle('thread.create', { access: 'danger-full-access' })) as Thread;
  await cli.request('thread/resume', { threadId: thread.id });
  let index = events.length;
  await desk.handle('turn.start', { threadId: thread.id, text: 'Synthetic task for context compaction.' });
  assert.equal((await completedAfter(index)).status, 'completed');

  filtered = true;
  index = events.length;
  await desk.handle('thread.compact', { threadId: thread.id });
  const failed = await completedAfter(index);
  assert.equal(failed.status, 'failed');
  assert.equal(
    compactionFailure(failed.error!.message, events.slice(index).some(isCompactionItem)),
    'filtered',
    JSON.stringify(failed),
  );
  const saved = (await desk.handle('thread.read', { threadId: thread.id })) as Thread;
  assert.ok(saved.turns.some((t) => t.items.some((i) => i.type === 'userMessage')));
  assert.match(saved.turns.at(-1)!.error!.message, /content_filter/);

  // This synthetic provider switches back to success to verify both lifecycle
  // outcomes, not to retry or bypass a real service-side content filter.
  filtered = false;
  index = events.length;
  await cli.request('thread/compact/start', { threadId: thread.id });
  assert.equal((await completedAfter(index)).status, 'completed');
  assert.ok(events.slice(index).some((e) => e.method === 'item/completed' && isCompactionItem(e)));
  const opened = (await desk.handle('thread.open', { threadId: thread.id })) as Thread;
  assert.equal(opened.permissionMode, 'danger-full-access');
  assert.equal(opened.approvalPolicy, 'never');
  console.log(
    JSON.stringify({
      passed: true,
      cli: desk.codex.connection.version,
      compaction: 'failure and success shared by both clients',
      history: 'preserved',
      liveSettings: 'YOLO preserved',
      provider: 'loopback synthetic Responses',
      requests,
    }),
  );
} finally {
  provider.closeAllConnections();
  await new Promise<void>((resolve) => provider.close(() => resolve()));
  await desk.codex.stop();
  await cli.stop();
  if (server.pid) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
  }
  await delay(100);
  await rm(root, { recursive: true, force: true });
}
