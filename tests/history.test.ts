import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeHistory, mergeRecentTurn } from '../src/shared/history';
import type { Thread } from '../src/shared/types';
const thread = (ids: string[], cursor: string | null = null): Thread => ({
  id: 'history',
  preview: '',
  cwd: '/synthetic',
  createdAt: 0,
  updatedAt: 0,
  status: { type: 'idle' },
  nextTurnsCursor: cursor,
  turns: ids.map((id) => ({
    id,
    status: 'completed',
    items: [{ id: 'message-' + id, type: 'agentMessage', text: id }],
  })),
});
test('fresh CLI pages replace overlapping items while keeping a contiguous older page', () => {
  const previous = thread(['old', 'middle', 'recent'], 'older-page');
  const incoming = thread(['middle', 'recent', 'new'], 'current-page');
  incoming.turns[0].items[0].text = 'Authoritative edit';
  const merged = mergeHistory(previous, incoming);
  assert.deepEqual(
    merged.turns.map((turn) => turn.id),
    ['old', 'middle', 'recent', 'new'],
  );
  assert.equal(merged.turns[1].items[0].text, 'Authoritative edit');
  assert.equal(merged.nextTurnsCursor, 'older-page');
});
test('complete or rolled-back CLI history replaces stale cached turns', () => {
  const incoming = thread(['old']);
  assert.equal(mergeHistory(thread(['old', 'removed']), incoming), incoming);
  const empty = thread([]);
  assert.equal(mergeHistory(incoming, empty), empty);
});
test('a missing overlap or different thread never invents continuous cached history', () => {
  const incoming = thread(['new'], 'older-page');
  assert.equal(mergeHistory(thread(['old']), incoming), incoming);
  assert.equal(mergeHistory({ ...thread(['old', 'new']), id: 'another' }, incoming), incoming);
});

test('recent item pages preserve a contiguous cached prefix and accept CLI edits and deletions', () => {
  const turn = (ids: string[], cursor: string | null) => ({
    id: 'turn',
    status: 'completed' as const,
    nextItemsCursor: cursor,
    items: ids.map((id) => ({ id, type: 'agentMessage', text: id })),
  });
  const previous = turn(['old', 'overlap', 'deleted', 'recent'], 'older-items');
  const incoming = turn(['overlap', 'recent', 'new'], 'recent-items');
  incoming.items[0].text = 'CLI edit';
  const merged = mergeRecentTurn(previous, incoming);
  assert.deepEqual(
    merged.items.map((item) => item.id),
    ['old', 'overlap', 'recent', 'new'],
  );
  assert.equal(merged.items[1].text, 'CLI edit');
  assert.equal(merged.nextItemsCursor, 'older-items');
  assert.equal(mergeRecentTurn(previous, turn(['disjoint'], 'cursor')).items.length, 1);
  assert.equal(mergeRecentTurn(previous, turn(['old'], null)).items.length, 1);
  const full = { ...thread(['turn']), turns: [previous] };
  const recent = { ...thread(['turn']), turns: [incoming] };
  assert.deepEqual(mergeHistory(full, recent).turns[0].items, merged.items);
});
