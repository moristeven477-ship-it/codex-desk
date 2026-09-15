import test from 'node:test';
import assert from 'node:assert/strict';
import { CompletionTracker } from '../src/shared/completion';
import type { CodexEvent } from '../src/shared/types';

test('completion notices distinguish failures, ignore interruptions and deduplicate repeated events', () => {
  const tracker = new CompletionTracker();
  const event = (id: string, status: string): CodexEvent => ({
    kind: 'notification',
    method: 'turn/completed',
    params: { threadId: 'a', turn: { id, status } },
  });
  assert.equal(tracker.receive(event('1', 'interrupted')), undefined);
  assert.equal(tracker.receive({ ...event('2', 'completed'), method: 'turn/started' }), undefined);
  assert.deepEqual(tracker.receive(event('3', 'completed')), { threadId: 'a', turnId: '3', failed: false });
  assert.equal(tracker.receive(event('3', 'completed')), undefined);
  assert.deepEqual(tracker.receive(event('4', 'failed')), { threadId: 'a', turnId: '4', failed: true });
});
