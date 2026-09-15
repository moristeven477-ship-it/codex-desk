import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { CodexProcess } from '../electron/codex';
import { DeskService } from '../electron/service';
import type { Approval, CodexEvent, Thread } from '../src/shared/types';

const binary = path.resolve('tests/fixtures/fake-codex.mjs');
await chmod(binary, 0o755);
function eventWhere(codex: CodexProcess, predicate: (e: CodexEvent) => boolean) {
  return new Promise<CodexEvent>((resolve, reject) => {
    const timer = setTimeout(() => {
      codex.off('event', handler);
      reject(new Error('Event timed out'));
    }, 4000);
    function handler(e: CodexEvent) {
      if (predicate(e)) {
        clearTimeout(timer);
        codex.off('event', handler);
        resolve(e);
      }
    }
    codex.on('event', handler);
  });
}
test('real subprocess framing, concurrent responses, malformed input, stop and restart', async () => {
  const codex = new CodexProcess(500);
  try {
    await Promise.all([
      codex.start({ binaryPath: binary, codexHome: '' }),
      codex.start({ binaryPath: binary, codexHome: '' }),
    ]);
    assert.equal(codex.connection.phase, 'ready');
    const values = await Promise.all([
      codex.request('test.ping', { n: 1 }),
      codex.request('test.ping', { n: 2 }),
    ]);
    assert.deepEqual(values, [{ n: 1 }, { n: 2 }]);
    assert.deepEqual(await codex.request('test.malformed'), { ok: true });
    await assert.rejects(codex.request('test.hang'), /timed out/);
    const outstanding = assert.rejects(codex.request('test.hang'), /disconnected/);
    await codex.stop();
    await outstanding;
    assert.equal(codex.connection.phase, 'stopped');
    await codex.start({ binaryPath: binary, codexHome: '' });
    assert.deepEqual(await codex.request('test.ping', { restarted: true }), { restarted: true });
  } finally {
    await codex.stop();
  }
});
test('a crashed CLI rejects requests and reconnects with a fresh process', async () => {
  const codex = new CodexProcess(2000);
  try {
    await codex.start({ binaryPath: binary, codexHome: '' });
    await assert.rejects(codex.request('test.exit'), /exited/);
    assert.equal(codex.connection.phase, 'error');
    await codex.start({ binaryPath: binary, codexHome: '' });
    assert.equal(codex.connection.phase, 'ready');
  } finally {
    await codex.stop();
  }
});
test('service approval lifecycle, streamed output, unknown operation rejection and persistence', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'desk-service-'));
  const service = new DeskService(directory);
  try {
    await service.init();
    await service.handle('settings.update', { binaryPath: binary });
    await service.connect();
    const project = (await service.handle('project.add', { path: directory })) as { id: string };
    const thread = (await service.handle('thread.create', { projectId: project.id })) as Thread;
    const approvalEvent = eventWhere(service.codex, (e) => e.kind === 'request');
    await service.handle('turn.start', { threadId: thread.id, text: 'approval please' });
    const approval = (await approvalEvent).request as Approval;
    assert.equal(service.runningCount, 1);
    assert.equal(approval.params.command, 'npm test');
    await assert.rejects(service.handle('codex.restart'), /Stop running/);
    await assert.rejects(
      service.handle('approval.respond', { id: approval.id, decision: 'acceptForSession' }),
      /not offered/,
    );
    const completed = eventWhere(service.codex, (e) => e.method === 'turn/completed');
    await service.handle('approval.respond', { id: approval.id, decision: 'accept' });
    await completed;
    assert.equal(service.runningCount, 0);
    assert.equal(service.codex.approvals.size, 0);
    await assert.rejects(
      service.handle('approval.respond', { id: approval.id, decision: 'accept' }),
      /already been resolved/,
    );
    const history = (await service.handle('thread.read', { threadId: thread.id })) as Thread;
    assert.ok(history.turns[0].items.some((i) => i.text === 'Decision: accept'));
    await assert.rejects(service.handle('process.exec', { command: 'anything' }), /Unknown operation/);
    await assert.rejects(
      service.handle('turn.start', { threadId: thread.id, images: ['/unpicked/private.png'] }),
      /attachment picker/,
    );
    const next = new DeskService(directory);
    await next.init();
    assert.equal(next.store.state.projects.length, 1);
  } finally {
    await service.codex.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
