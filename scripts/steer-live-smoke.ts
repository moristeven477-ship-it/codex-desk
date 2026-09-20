// Exercise the installed, unmodified CLI against a loopback Responses fixture.
// No account, external model request, user workspace or shared server is used.
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { gunzipSync } from 'node:zlib';
import { DeskService } from '../electron/service';
import { CodexProcess } from '../electron/codex';
import { socketReady } from '../electron/shared-server';
import type { CodexEvent, Thread, Turn } from '../src/shared/types';
import { reduceThread } from '../src/lib/events';

const root = await mkdtemp(path.join(tmpdir(), 'desk-real-steer-'));
const cliHome = path.join(root, 'cli');
const socket = path.join(cliHome, 'app-server-control/app-server-control.sock');
const requests: Record<string, unknown>[] = [];
let held: ServerResponse | undefined;
let sequence = 0;
function event(response: ServerResponse, type: string, data: object) {
  response.write(
    `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...data })}\n\n`,
  );
}
function finish(response: ServerResponse, id: string) {
  const item = {
    id: `msg_${id}`,
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: 'Local response fixture completed.', annotations: [] }],
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
  response.end();
}
const provider = createServer(async (request, response) => {
  if (request.method !== 'POST' || !request.url?.endsWith('/responses')) {
    response.writeHead(404).end();
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  requests.push(
    JSON.parse((request.headers['content-encoding'] === 'gzip' ? gunzipSync(bytes) : bytes).toString()),
  );
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  event(response, 'response.created', { response: { id: `resp_${requests.length}`, status: 'in_progress' } });
  if (requests.length === 1) held = response;
  else finish(response, `resp_${requests.length}`);
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
service_tier = "fast"
[features]
fast_mode = true
[model_providers.local_fixture]
name = "Local steering validation"
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
async function until(check: () => boolean | Promise<boolean>, description: string) {
  const deadline = Date.now() + 20_000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, description);
    await delay(50);
  }
}
try {
  await until(() => socketReady(socket), 'isolated app-server startup timed out');
  await desk.init();
  await desk.handle('settings.update', {
    ...(path.isAbsolute(binary) ? { binaryPath: binary } : {}),
    codexHome: cliHome,
    defaultWorkspace: path.join(root, 'workspace'),
  });
  await desk.connect();
  await cli.start(desk.store.state.settings);
  const thread = (await desk.handle('thread.create', { access: 'danger-full-access' })) as Thread;
  assert.equal(thread.serviceTier, 'priority', 'new conversations inherit the CLI Fast default');
  await cli.request('thread/resume', { threadId: thread.id });
  const { turn } = await cli.request<{ turn: Turn }>('turn/start', {
    threadId: thread.id,
    input: [{ type: 'text', text: 'Initial input from the CLI client.' }],
  });
  await until(() => !!held, 'real CLI did not reach the local Responses fixture');
  assert.deepEqual(
    await desk.handle('turn.steer', {
      threadId: thread.id,
      expectedTurnId: turn.id,
      text: 'Additional direction from Desk.',
    }),
    { turnId: turn.id },
  );
  await cli.request('turn/steer', {
    threadId: thread.id,
    expectedTurnId: turn.id,
    input: [{ type: 'text', text: 'Additional direction from the CLI client.' }],
  });
  await assert.rejects(
    desk.handle('turn.steer', {
      threadId: thread.id,
      expectedTurnId: 'stale',
      text: 'Must not start another turn.',
    }),
  );
  finish(held!, 'resp_1');
  await until(
    () => events.some((event) => event.method === 'turn/completed'),
    'real CLI turn did not complete',
  );
  const history = (await desk.handle('thread.read', { threadId: thread.id })) as Thread;
  assert.equal(history.turns.length, 1);
  assert.equal(history.turns[0].id, turn.id);
  assert.equal(history.turns[0].status, 'completed');
  const users = history.turns[0].items.filter((item) => item.type === 'userMessage');
  assert.equal(users.length, 3);
  const rendered = events.reduce(reduceThread, { ...thread, turns: [] });
  assert.equal(rendered.turns[0].items.filter((item) => item.type === 'userMessage').length, 3);
  assert.deepEqual(
    rendered.turns[0].items.filter((item) => item.type === 'userMessage').map((item) => item.content),
    users.map((item) => item.content),
    'live completion summaries must preserve exactly the same user input as stored history',
  );
  const sent = JSON.stringify(requests);
  assert.ok(sent.includes('Additional direction from Desk.'));
  assert.ok(sent.includes('Additional direction from the CLI client.'));
  assert.equal(events.filter((event) => event.method === 'turn/started').length, 1);
  await assert.rejects(
    desk.handle('turn.steer', {
      threadId: thread.id,
      expectedTurnId: turn.id,
      text: 'Completed turns reject steering.',
    }),
  );
  const opened = (await desk.handle('thread.open', { threadId: thread.id })) as Thread;
  assert.equal(opened.permissionMode, 'danger-full-access');
  assert.equal(opened.approvalPolicy, 'never');
  assert.equal(opened.serviceTier, 'priority');
  assert.ok(requests.every((request) => request.service_tier === 'priority'));
  await desk.handle('thread.speed', { threadId: thread.id, serviceTier: null });
  const standard = await cli.request<{ serviceTier: string | null; model: string; approvalPolicy: string }>(
    'thread/resume',
    { threadId: thread.id, excludeTurns: true },
  );
  assert.equal(standard.serviceTier, 'default', 'Desk can turn Fast off for the same CLI thread');
  assert.equal(standard.model, opened.model);
  assert.equal(standard.approvalPolicy, 'never');
  const previousRequests = requests.length;
  const { turn: standardTurn } = (await desk.handle('turn.start', {
    threadId: thread.id,
    text: 'Standard-speed input from Desk.',
  })) as { turn: Turn };
  await until(
    () =>
      events.some(
        (event) => event.method === 'turn/completed' && (event.params?.turn as Turn)?.id === standardTurn.id,
      ),
    'standard-speed turn did not complete',
  );
  assert.ok(requests.length > previousRequests);
  assert.ok(requests.slice(previousRequests).every((request) => request.service_tier !== 'priority'));
  await desk.handle('thread.speed', { threadId: thread.id, serviceTier: 'priority' });
  assert.equal(
    (
      await cli.request<{ serviceTier: string | null }>('thread/resume', {
        threadId: thread.id,
        excludeTurns: true,
      })
    ).serviceTier,
    'priority',
  );
  const checkpoint = events.length;
  await cli.request('thread/settings/update', { threadId: thread.id, serviceTier: null });
  await until(
    () =>
      events
        .slice(checkpoint)
        .some(
          (event) =>
            event.method === 'thread/settings/updated' &&
            (event.params?.threadSettings as { serviceTier?: string | null })?.serviceTier === 'default',
        ),
    'CLI Fast update did not synchronize',
  );
  assert.equal(
    ((await desk.handle('thread.open', { threadId: thread.id })) as Thread).serviceTier,
    'default',
  );
  const another = (await desk.handle('thread.create', {})) as Thread;
  assert.equal(another.serviceTier, 'priority', 'per-thread toggles must not change the CLI default');
  console.log(
    JSON.stringify({
      passed: true,
      cli: desk.codex.connection.version,
      turns: history.turns.length,
      userMessages: users.length,
      modelRequests: requests.length,
      provider: 'loopback synthetic Responses',
      liveSettings: 'YOLO preserved',
      staleAndCompletedSteers: 'rejected',
      liveUserMessages: 'preserved after the summary completion',
      fast: 'CLI default inherited; Desk/CLI toggles synchronized; request tiers verified',
    }),
  );
} finally {
  held?.destroy();
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
