import test from 'node:test';
import assert from 'node:assert/strict';
import { remoteFixture } from './fixtures/remote';
import { RpcError } from '../electron/codex';
import type { Thread, Turn } from '../src/shared/types';

test('recent history is bounded and read-only; legacy pagination keeps working without item support', async () => {
  const f = await remoteFixture();
  const original = f.service.codex.request.bind(f.service.codex);
  const calls: { method: string; params: any }[] = [];
  let supportsItems = true;
  f.service.codex.request = (async (method, params) => {
    calls.push({ method, params });
    if (!supportsItems && method === 'thread/items/list') throw new RpcError('Unsupported items', -32601);
    return original(method, params);
  }) as typeof f.service.codex.request;
  try {
    await f.shared.request('test.history', {
      threadId: 'fixture-history',
      turns: Array.from({ length: 40 }, (_, t) => ({
        id: `turn-${t}`,
        status: 'completed',
        items: Array.from({ length: 50 }, (_, i) => ({
          id: `item-${t}-${i}`,
          type: 'agentMessage',
          text: `Message ${t}-${i}`,
        })),
      })),
    });
    const recent = (await f.service.handle('thread.read', {
      threadId: 'fixture-history',
      recent: true,
    })) as Thread;
    assert.equal(recent.historyPaging, 'items');
    assert.deepEqual(
      recent.turns.map((turn) => turn.id),
      ['turn-38', 'turn-39'],
    );
    assert.ok(recent.turns.every((turn) => turn.items.length === 20 && turn.nextItemsCursor));
    assert.equal(recent.turns[1].items.at(-1)?.id, 'item-39-49');
    assert.ok(
      calls.every((call) => ['thread/read', 'thread/turns/list', 'thread/items/list'].includes(call.method)),
    );
    assert.ok(
      calls
        .filter((call) => call.method === 'thread/turns/list')
        .every((call) => call.params.limit === 2 && call.params.itemsView === 'notLoaded'),
    );
    assert.ok(
      calls
        .filter((call) => call.method === 'thread/items/list')
        .every((call) => call.params.limit === 20 && call.params.sortDirection === 'desc'),
    );
    supportsItems = false;
    const legacy = (await f.service.handle('thread.read', {
      threadId: 'fixture-history',
      recent: true,
    })) as Thread;
    assert.equal(legacy.historyPaging, undefined);
    assert.equal(legacy.turns.length, 30);
    assert.equal(legacy.turns.at(-1)?.items.length, 50);
    assert.ok(legacy.nextTurnsCursor);
    const older = (await f.service.handle('thread.older', {
      threadId: legacy.id,
      cursor: legacy.nextTurnsCursor,
    })) as { data: Turn[]; nextCursor: string | null };
    assert.equal(older.data.length, 10);
    assert.equal(older.nextCursor, null);
  } finally {
    await f.close();
  }
});
