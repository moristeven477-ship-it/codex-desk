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

test('compaction shares lifecycle, preserves CLI settings and rejects a turn started before Desk connects', async () => {
  const f = await fixture();
  try {
    const thread = (await f.desk.handle('thread.create', { access: 'danger-full-access' })) as Thread;
    await f.cli.request('thread/resume', { threadId: thread.id });
    const settings = await f.cli.request('test.settings', { threadId: thread.id });
    const completed = eventWhere(f.cli, (e) => e.method === 'turn/completed');
    await f.desk.handle('thread.compact', { threadId: thread.id });
    assert.equal(((await completed).params!.turn as { status: string }).status, 'completed');
    assert.deepEqual(await f.cli.request('test.settings', { threadId: thread.id }), settings);
    await f.cli.request('test.compaction', { mode: 'filtered', item: false });
    const failed = eventWhere(f.desk, (e) => e.method === 'turn/completed');
    await f.cli.request('thread/compact/start', { threadId: thread.id });
    assert.equal(((await failed).params!.turn as { status: string }).status, 'failed');
    const history = (await f.desk.handle('thread.read', { threadId: thread.id })) as Thread;
    assert.match(history.turns.at(-1)!.error!.message, /content_filter/);
    assert.equal(history.turns.at(-1)!.items.length, 0);
    await f.desk.codex.stop();
    const { turn } = await f.cli.request<{ turn: { id: string } }>('turn/start', {
      threadId: thread.id,
      input: [{ type: 'text', text: 'wait for CLI task' }],
    });
    await f.desk.connect();
    assert.equal(f.desk.runningCount, 0);
    await assert.rejects(
      f.desk.handle('thread.compact', { threadId: thread.id }),
      /Wait for the running turn/,
    );
    await f.cli.request('turn/interrupt', { threadId: thread.id, turnId: turn.id });
  } finally {
    await f.close();
  }
});

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

test('steering shares the active CLI turn and images without overriding settings or starting another turn', async () => {
  const f = await fixture();
  try {
    const thread = (await f.desk.handle('thread.create', { access: 'danger-full-access' })) as Thread;
    await f.cli.request('thread/resume', { threadId: thread.id });
    const started = await f.cli.request<{ turn: { id: string } }>('turn/start', {
      threadId: thread.id,
      input: [{ type: 'text', text: 'wait for directions from Desk' }],
    });
    const before = await f.cli.request('test.settings', { threadId: thread.id });
    const image = path.join(f.root, 'pasted-image.png');
    f.desk.authorizeImages([image]);
    const received = eventWhere(
      f.cli,
      (event) =>
        event.method === 'item/completed' &&
        String((event.params?.item as { id: string })?.id).startsWith('steer-'),
    );
    assert.deepEqual(
      await f.desk.handle('turn.steer', {
        threadId: thread.id,
        expectedTurnId: started.turn.id,
        text: 'Use this screenshot instead',
        images: [image],
      }),
      { turnId: started.turn.id },
    );
    assert.equal((await received).params?.turnId, started.turn.id);
    const request = await f.cli.request<Record<string, unknown>>('test.lastSteer');
    assert.deepEqual(Object.keys(request).sort(), ['expectedTurnId', 'input', 'threadId']);
    assert.deepEqual(request.input, [
      { type: 'text', text: 'Use this screenshot instead', text_elements: [] },
      { type: 'localImage', path: image },
    ]);
    assert.deepEqual(await f.cli.request('test.settings', { threadId: thread.id }), before);
    const receivedByDesk = eventWhere(
      f.desk,
      (event) =>
        event.method === 'item/completed' &&
        String((event.params?.item as { id: string })?.id).startsWith('steer-'),
    );
    await f.cli.request('turn/steer', {
      threadId: thread.id,
      expectedTurnId: started.turn.id,
      input: [{ type: 'text', text: 'Follow-up from CLI' }],
    });
    await receivedByDesk;
    const history = (await f.desk.handle('thread.read', { threadId: thread.id })) as Thread;
    assert.equal(history.turns.length, 1);
    assert.equal(history.turns[0].id, started.turn.id);
    assert.equal(history.turns[0].items.filter((item) => item.type === 'userMessage').length, 3);
    await assert.rejects(
      f.desk.handle('turn.steer', {
        threadId: thread.id,
        expectedTurnId: 'stale-turn',
        text: 'Reject stale steer',
      }),
      /does not match/,
    );
    await assert.rejects(
      f.desk.handle('turn.steer', {
        threadId: thread.id,
        expectedTurnId: started.turn.id,
        images: ['/unpicked/private.png'],
      }),
      /attachment picker/,
    );
    await assert.rejects(
      f.desk.handle('turn.steer', {
        threadId: thread.id,
        expectedTurnId: started.turn.id,
        text: 'No overrides',
        access: 'read-only',
      }),
      /Unrecognized key/,
    );
    await f.cli.request('turn/interrupt', { threadId: thread.id, turnId: started.turn.id });
    await assert.rejects(
      f.desk.handle('turn.steer', { threadId: thread.id, expectedTurnId: started.turn.id, text: 'Too late' }),
      /No active turn/,
    );
    assert.equal(((await f.desk.handle('thread.read', { threadId: thread.id })) as Thread).turns.length, 1);
  } finally {
    await f.close();
  }
});

test('CLI settings win across opening and ordinary sends; only explicit Desk selection overrides YOLO', async () => {
  const f = await fixture();
  try {
    await f.cli.request('thread/settings/update', {
      threadId: 'fixture-history',
      sandboxPolicy: { type: 'dangerFullAccess' },
      approvalPolicy: 'never',
      approvalsReviewer: 'auto_review',
      model: 'test-fast',
      effort: 'low',
    });
    const opened = (await f.desk.handle('thread.open', { threadId: 'fixture-history' })) as Thread;
    assert.equal(opened.permissionMode, 'danger-full-access');
    assert.equal(opened.approvalPolicy, 'never');
    const done = eventWhere(f.cli, (event) => event.method === 'turn/completed');
    await f.desk.handle('turn.start', { threadId: opened.id, text: 'Inherit CLI settings' });
    await done;
    const sent = await f.cli.request<Record<string, unknown>>('test.lastTurn');
    for (const key of [
      'sandboxPolicy',
      'approvalPolicy',
      'approvalsReviewer',
      'model',
      'effort',
      'collaborationMode',
    ])
      assert.equal(Object.hasOwn(sent, key), false, `${key} must not be overridden`);
    let actual = await f.cli.request<Record<string, unknown>>('test.settings', { threadId: opened.id });
    assert.equal(actual.approvalPolicy, 'never');
    assert.deepEqual(actual.sandboxPolicy, { type: 'dangerFullAccess' });
    const done2 = eventWhere(f.cli, (event) => event.method === 'turn/completed');
    await f.desk.handle('turn.start', {
      threadId: opened.id,
      text: 'Explicitly restrict this turn',
      access: 'read-only',
    });
    await done2;
    actual = await f.cli.request('test.settings', { threadId: opened.id });
    assert.deepEqual(actual.sandboxPolicy, { type: 'readOnly', networkAccess: false });
    assert.equal(actual.approvalPolicy, 'on-request');
    const done3 = eventWhere(f.cli, (event) => event.method === 'turn/completed');
    await f.desk.handle('turn.start', {
      threadId: opened.id,
      text: 'Explicit YOLO',
      access: 'danger-full-access',
    });
    await done3;
    actual = await f.cli.request('test.settings', { threadId: opened.id });
    assert.equal(actual.approvalPolicy, 'never');
    assert.deepEqual(actual.sandboxPolicy, { type: 'dangerFullAccess' });
    const created = (await f.desk.handle('thread.create', { access: 'danger-full-access' })) as Thread;
    assert.equal(created.approvalPolicy, 'never');
    assert.equal(created.permissionMode, 'danger-full-access');
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

test('startup mode waits for Codex to apply queued settings before returning', async () => {
  const f = await fixture();
  try {
    const thread = (await f.desk.handle('thread.create', {})) as Thread;
    await f.cli.request('test.settingsDelay', { milliseconds: 150 });
    let finished = false;
    const configure = f.desk
      .handle('thread.configure', { threadId: thread.id, access: 'danger-full-access' })
      .then(() => {
        finished = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(finished, false);
    await configure;
    const opened = (await f.desk.handle('thread.open', { threadId: thread.id })) as Thread;
    assert.equal(opened.permissionMode, 'danger-full-access');
    assert.equal(opened.approvalPolicy, 'never');
    await f.desk.handle('turn.start', { threadId: thread.id, text: 'Use the confirmed CLI settings' });
    const actual = await f.cli.request<Record<string, unknown>>('test.lastTurn');
    assert.ok(!('sandboxPolicy' in actual));
    assert.ok(!('approvalPolicy' in actual));
  } finally {
    await f.close();
  }
});

test('Fast inherits CLI state and only explicit changes update the shared service tier', async () => {
  const f = await fixture();
  try {
    const threadId = 'fixture-history';
    const changed = eventWhere(f.desk, (event) => event.method === 'thread/settings/updated');
    await f.cli.request('thread/settings/update', {
      threadId,
      serviceTier: 'priority',
      sandboxPolicy: { type: 'dangerFullAccess' },
      approvalPolicy: 'never',
      effort: 'high',
    });
    await changed;
    const opened = (await f.desk.handle('thread.open', { threadId })) as Thread;
    assert.equal(opened.serviceTier, 'priority');
    const before = await f.cli.request<Record<string, unknown>>('test.settings', { threadId });
    const completed = eventWhere(f.cli, (event) => event.method === 'turn/completed');
    await f.desk.handle('turn.start', { threadId, text: 'Inherit Fast from CLI' });
    await completed;
    const sent = await f.cli.request<Record<string, unknown>>('test.lastTurn');
    for (const field of [
      'serviceTier',
      'serviceTierForTurn',
      'model',
      'effort',
      'approvalPolicy',
      'sandboxPolicy',
    ])
      assert.ok(!(field in sent), `Ordinary sends must omit ${field}`);
    assert.deepEqual(await f.cli.request('test.settings', { threadId }), before);

    await f.cli.request('test.settingsDelay', { milliseconds: 150 });
    let finished = false;
    const off = f.desk.handle('thread.speed', { threadId, serviceTier: null }).then(() => {
      finished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(finished, false, 'must wait for CLI settings confirmation');
    await off;
    assert.deepEqual(await f.cli.request('test.settings', { threadId }), {
      ...before,
      serviceTier: 'default',
    });
    assert.equal(((await f.desk.handle('thread.open', { threadId })) as Thread).serviceTier, 'default');
    await f.desk.handle('thread.speed', { threadId, serviceTier: 'priority' });
    assert.deepEqual(await f.cli.request('test.settings', { threadId }), before);
    await f.cli.request('test.settingsError', { message: 'Fast unavailable' });
    await assert.rejects(f.desk.handle('thread.speed', { threadId, serviceTier: null }), /Fast unavailable/);
    assert.equal(((await f.desk.handle('thread.open', { threadId })) as Thread).serviceTier, 'priority');
    await f.cli.request('test.settingsError', { message: '' });
    await f.cli.request('turn/start', { threadId, input: [{ type: 'text', text: 'wait' }] });
    await assert.rejects(
      f.desk.handle('thread.speed', { threadId, serviceTier: null }),
      /Wait for the running turn/,
    );
  } finally {
    await f.close();
  }
});
