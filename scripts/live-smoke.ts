import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { DeskService } from '../electron/service';
import type { Bootstrap, Thread, CodexEvent } from '../src/shared/types';

const directory = await mkdtemp(path.join(tmpdir(), 'codex-desk-smoke-'));
const service = new DeskService(directory);
try {
  await service.init();
  await service.connect();
  const state = (await service.handle('bootstrap')) as Bootstrap;
  assert.equal(state.connection.phase, 'ready');
  console.log(
    JSON.stringify({
      check: 'connection',
      version: state.connection.version,
      models: state.models.length,
      signedIn: !!state.account,
    }),
  );
  const threads = (await service.handle('threads.list')) as { data: Thread[] };
  console.log(JSON.stringify({ check: 'history-list', count: threads.data.length }));
  if (threads.data.length) {
    const thread = (await service.handle('thread.read', { threadId: threads.data[0].id })) as Thread;
    assert.equal(thread.id, threads.data[0].id);
    console.log(
      JSON.stringify({
        check: 'history-read',
        turns: thread.turns.length,
        paginated: !!thread.nextTurnsCursor,
      }),
    );
  }
  if (process.argv.includes('--turn')) {
    const projectPath = path.join(directory, 'scratch');
    await mkdir(projectPath);
    const project = (await service.handle('project.add', { path: projectPath })) as { id: string };
    const thread = (await service.handle('thread.create', {
      projectId: project.id,
      access: 'read-only',
    })) as Thread;
    let turnId = '';
    try {
      const completion = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          service.off('event', listener);
          reject(new Error('Live turn timed out'));
        }, 120_000);
        function listener(event: CodexEvent) {
          if (event.params?.threadId !== thread.id) return;
          if (event.method === 'turn/started') turnId = String((event.params.turn as { id: string }).id);
          if (event.method === 'turn/completed') {
            clearTimeout(timer);
            service.off('event', listener);
            resolve();
          }
        }
        service.on('event', listener);
      });
      await service.handle('turn.start', {
        threadId: thread.id,
        text: 'Reply with exactly CODEX_DESK_OK. Do not read files, run commands, or use tools.',
        access: 'read-only',
      });
      await completion;
      const history = (await service.handle('thread.read', { threadId: thread.id })) as Thread;
      assert.ok(
        history.turns.some((t) =>
          t.items.some((i) => i.type === 'agentMessage' && i.text?.includes('CODEX_DESK_OK')),
        ),
      );
      console.log(JSON.stringify({ check: 'live-turn', result: 'passed', sandbox: 'read-only' }));
    } finally {
      if (service.runningCount && turnId)
        await service.handle('turn.interrupt', { threadId: thread.id, turnId }).catch(() => {});
      await service.handle('thread.archive', { threadId: thread.id }).catch(() => {});
    }
  }
} finally {
  await service.codex.stop();
  await rm(directory, { recursive: true, force: true });
}
