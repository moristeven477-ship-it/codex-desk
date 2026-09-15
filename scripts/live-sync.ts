import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DeskService } from '../electron/service';
import type { CodexEvent, Thread, Bootstrap } from '../src/shared/types';

// Explicit opt-in: two tiny model turns in an isolated workspace, using real login.
if (!process.argv.includes('--turns')) throw new Error('Pass --turns to run the real CLI / Desk round trip.');
const root = await mkdtemp(path.join(tmpdir(), 'desk-live-sync-'));
const desk = new DeskService(path.join(root, 'data'));
let threadId = '',
  terminalId = '',
  output = '',
  latestTurn = '',
  goalCleared = false,
  completed = 0;
let unsubscribe = () => {};
async function until(predicate: () => boolean, label: string, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
async function type(command: string) {
  await desk.handle('terminal.write', { id: terminalId, data: '\x15' + command });
  await new Promise((resolve) => setTimeout(resolve, 400));
  await desk.handle('terminal.write', { id: terminalId, data: '\r' });
}
try {
  await desk.init();
  await desk.connect();
  const boot = (await desk.handle('bootstrap')) as Bootstrap;
  assert.equal(boot.connection.shared, true);
  const cwd = path.join(root, 'scratch');
  await mkdir(cwd);
  const project = (await desk.handle('project.add', { path: cwd })) as { id: string };
  const thread = (await desk.handle('thread.create', {
    projectId: project.id,
    access: 'read-only',
  })) as Thread;
  threadId = thread.id;
  const listener = (event: CodexEvent) => {
    if (event.kind === 'terminal' && event.data) {
      output += event.data;
      // Emulate terminal device reports for this headless PTY check. The embedded
      // xterm handles these itself in the desktop application.
      if (terminalId && event.data.includes('\x1b[6n'))
        void desk.handle('terminal.write', { id: terminalId, data: '\x1b[1;1R' });
      if (terminalId && /\x1b\[(?:\?|>)?c/.test(event.data))
        void desk.handle('terminal.write', { id: terminalId, data: '\x1b[?1;2c' });
    }
    if (event.method === 'turn/started' && event.params?.threadId === threadId)
      latestTurn = (event.params.turn as { id: string }).id;
    if (event.method === 'thread/goal/cleared' && event.params?.threadId === threadId) goalCleared = true;
    if (event.method === 'turn/completed' && event.params?.threadId === threadId) completed++;
  };
  desk.on('event', listener);
  unsubscribe = () => desk.off('event', listener);
  const session = (await desk.handle('terminal.start', { threadId, cols: 120, rows: 42 })) as { id: string };
  terminalId = session.id;
  await until(() => output.includes('/review') && output.includes('›'), 'TUI prompt', 30_000);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await desk.handle('goal.set', { threadId, objective: 'CODEX_DESK_SHARED_GOAL_CHECK', status: 'paused' });
  await type('/goal');
  await until(() => output.includes('CODEX_DESK_SHARED_GOAL_CHECK'), 'Desk goal visible in real TUI', 15_000);
  console.log(JSON.stringify({ check: 'desk-goal-to-real-cli', result: 'passed' }));
  await type('/goal clear');
  await until(() => goalCleared, 'CLI goal cleared in Desk', 15_000);
  console.log(JSON.stringify({ check: 'real-cli-goal-to-desk', result: 'passed' }));
  await type('Reply with exactly DESK_FROM_CLI_OK. Do not read files, run commands, or use tools.');
  await until(() => completed >= 1, 'CLI turn completion');
  const fromCli = (await desk.handle('thread.read', { threadId })) as Thread;
  assert.ok(
    fromCli.turns.some((turn) =>
      turn.items.some((item) => item.type === 'agentMessage' && item.text?.includes('DESK_FROM_CLI_OK')),
    ),
  );
  console.log(JSON.stringify({ check: 'real-cli-message-to-desk', result: 'passed' }));
  const offset = output.length;
  await desk.handle('turn.start', {
    threadId,
    text: 'Reply with exactly CLI_FROM_DESK_OK. Do not read files, run commands, or use tools.',
    access: 'read-only',
    model: boot.models.find((model) => model.isDefault)?.model,
    effort: 'low',
  });
  await until(() => completed >= 2, 'Desk turn completion');
  await until(
    () => output.slice(offset).includes('CLI_FROM_DESK_OK'),
    'Desk response visible in real TUI',
    15_000,
  );
  console.log(JSON.stringify({ check: 'desk-message-to-real-cli', result: 'passed', sandbox: 'read-only' }));
} catch (error) {
  await writeFile('/tmp/codex-desk-live-tui.txt', output, { mode: 0o600 });
  throw error;
} finally {
  unsubscribe();
  if (terminalId) await desk.handle('terminal.stop', { id: terminalId }).catch(() => {});
  if (threadId) {
    if (desk.runningCount && latestTurn)
      await desk.handle('turn.interrupt', { threadId, turnId: latestTurn }).catch(() => {});
    await desk.handle('goal.clear', { threadId }).catch(() => {});
    await desk.handle('thread.archive', { threadId }).catch(() => {});
  }
  desk.terminal.close();
  await desk.codex.stop();
  await rm(root, { recursive: true, force: true });
}
