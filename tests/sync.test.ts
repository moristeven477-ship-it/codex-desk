import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DeskService } from '../electron/service';
import { CodexProcess } from '../electron/codex';
import type { CodexEvent, Thread, ThreadGoal } from '../src/shared/types';
// @ts-expect-error Shared with the native JavaScript smoke runner.
import { sharedFixture } from './fixtures/shared-server.mjs';

function eventWhere(source: DeskService | CodexProcess, predicate: (event: CodexEvent) => boolean) {
  return new Promise<CodexEvent>((resolve, reject) => {
    const timer = setTimeout(() => {
      source.off('event', handler);
      reject(new Error('Sync event timed out'));
    }, 5000);
    function handler(event: CodexEvent) {
      if (predicate(event)) {
        clearTimeout(timer);
        source.off('event', handler);
        resolve(event);
      }
    }
    source.on('event', handler);
  });
}
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'desk-sync-'));
  const shared = await sharedFixture(root, root);
  const desk = new DeskService(path.join(root, 'desk'));
  await desk.init();
  await desk.handle('settings.update', {
    binaryPath: path.resolve('tests/fixtures/fake-codex.mjs'),
    codexHome: shared.home,
    defaultWorkspace: path.join(root, 'default'),
  });
  await desk.connect();
  const cli = new CodexProcess();
  await cli.start(desk.store.state.settings);
  return {
    root,
    desk,
    cli,
    close: async () => {
      desk.terminal.close();
      await desk.codex.stop();
      await cli.stop();
      await shared.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('two Unix WebSocket clients share turns, goals and approvals; closing Desk leaves CLI usable', async () => {
  const f = await fixture();
  try {
    const thread = (await f.desk.handle('thread.create', {})) as Thread;
    assert.equal(thread.cwd, path.join(f.root, 'default'));
    assert.ok((await stat(thread.cwd)).isDirectory());
    await f.cli.request('thread/resume', { threadId: thread.id });
    const cliComplete = eventWhere(f.cli, (event) => event.method === 'turn/completed');
    await f.desk.handle('turn.start', {
      threadId: thread.id,
      text: 'From Desk',
      access: 'read-only',
      collaborationMode: 'plan',
      model: 'test-codex',
      effort: 'high',
    });
    await cliComplete;
    const actual = await f.cli.request<{
      collaborationMode: { mode: string; settings: { developer_instructions: null } };
    }>('test.lastTurn');
    assert.equal(actual.collaborationMode.mode, 'plan');
    assert.equal(actual.collaborationMode.settings.developer_instructions, null);
    const deskComplete = eventWhere(f.desk, (event) => event.method === 'turn/completed');
    await f.cli.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'From CLI' }] });
    await deskComplete;
    const history = (await f.desk.handle('thread.read', { threadId: thread.id })) as Thread;
    assert.equal(history.turns.length, 2);
    assert.ok(
      history.turns[1].items.some(
        (item) =>
          Array.isArray(item.content) &&
          item.content.some((part) => typeof part === 'object' && part.text === 'From CLI'),
      ),
    );
    const goalEvent = eventWhere(f.desk, (event) => event.method === 'thread/goal/updated');
    await f.cli.request('thread/goal/set', {
      threadId: thread.id,
      objective: 'Shared goal',
      status: 'paused',
      tokenBudget: 5000,
    });
    assert.equal((await goalEvent).params?.threadId, thread.id);
    await f.desk.handle('goal.set', { threadId: thread.id, status: 'active' });
    assert.equal(
      (await f.cli.request<{ goal: ThreadGoal }>('thread/goal/get', { threadId: thread.id })).goal.status,
      'active',
    );
    const approval = eventWhere(f.desk, (event) => event.kind === 'request');
    await f.cli.request('turn/start', {
      threadId: thread.id,
      input: [{ type: 'text', text: 'approval from CLI' }],
    });
    const id = (await approval).request!.id;
    const resolved = eventWhere(f.desk, (event) => event.kind === 'resolved');
    f.cli.respond(id, { decision: 'decline' });
    await resolved;
    assert.equal(f.desk.codex.approvals.size, 0);
    await f.desk.codex.stop();
    assert.deepEqual(await f.cli.request('test.ping', { alive: true }), { alive: true });
  } finally {
    await f.close();
  }
});

test('standalone writer remains readable and attaches to the same ID after release', async () => {
  const f = await fixture();
  try {
    await f.cli.request('test.lock', { threadId: 'fixture-history', locked: true });
    const external = (await f.desk.handle('thread.open', { threadId: 'fixture-history' })) as Thread;
    assert.equal(external.syncState, 'external');
    assert.equal(external.turns[0].items[1].text, 'This is **Atlas**, a small React workspace.');
    await f.cli.request('test.lock', { threadId: 'fixture-history', locked: false });
    const live = (await f.desk.handle('thread.open', { threadId: external.id })) as Thread;
    assert.equal(live.syncState, 'live');
    assert.equal(live.id, external.id);
    assert.deepEqual(live.turns, external.turns);
  } finally {
    await f.close();
  }
});

test('embedded CLI uses a real PTY, supports resize and input, and closes its own client', async () => {
  const f = await fixture();
  try {
    const ready = eventWhere(
      f.desk,
      (event) => event.kind === 'terminal' && !!event.data?.includes('CODEX_CLI_FIXTURE_READY'),
    );
    const { id } = (await f.desk.handle('terminal.start', {
      threadId: 'fixture-history',
      cols: 100,
      rows: 30,
    })) as { id: string };
    await ready;
    await f.desk.handle('terminal.resize', { id, cols: 80, rows: 24 });
    await assert.rejects(f.desk.handle('terminal.resize', { id, cols: 0, rows: 24 }));
    const output = eventWhere(
      f.desk,
      (event) => event.kind === 'terminal' && !!event.data?.includes('CLI executed: /status'),
    );
    await f.desk.handle('terminal.write', { id, data: '/status\r' });
    await output;
    const exited = eventWhere(f.desk, (event) => event.kind === 'terminal' && event.exitCode !== undefined);
    await f.desk.handle('terminal.stop', { id });
    await exited;
    assert.deepEqual(await f.cli.request('test.ping', { connected: true }), { connected: true });
  } finally {
    await f.close();
  }
});
