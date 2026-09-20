import test from 'node:test';
import assert from 'node:assert/strict';
import { reduceThread } from '../src/lib/events';
import { compactionFailure } from '../src/shared/errors';
import type { Thread, CodexEvent } from '../src/shared/types';
const empty = (): Thread => ({
  id: 'a',
  preview: '',
  cwd: '/test',
  createdAt: 0,
  updatedAt: 0,
  status: { type: 'idle' },
  turns: [],
});
test('streaming deltas accumulate and authoritative completion does not duplicate output', () => {
  const events: CodexEvent[] = [
    {
      kind: 'notification',
      method: 'turn/started',
      params: { threadId: 'a', turn: { id: 'turn', status: 'inProgress', items: [] } },
    },
    ...['Hello ', 'world'].map((delta) => ({
      kind: 'notification' as const,
      method: 'item/agentMessage/delta',
      params: { threadId: 'a', turnId: 'turn', itemId: 'm', delta },
    })),
    {
      kind: 'notification',
      method: 'item/completed',
      params: { threadId: 'a', turnId: 'turn', item: { id: 'm', type: 'agentMessage', text: 'Hello world' } },
    },
    {
      kind: 'notification',
      method: 'turn/completed',
      params: { threadId: 'a', turn: { id: 'turn', status: 'completed', items: [] } },
    },
  ];
  const result = events.reduce(reduceThread, empty());
  assert.equal(result.turns[0].items.length, 1);
  assert.equal(result.turns[0].items[0].text, 'Hello world');
  assert.equal(result.status.type, 'idle');
  assert.equal(
    reduceThread(result, { kind: 'notification', method: 'turn/started', params: { threadId: 'b' } }),
    result,
  );
});
test('real Codex outputDelta and summaryTextDelta event names stream correctly', () => {
  let state = empty();
  state = reduceThread(state, {
    kind: 'notification',
    method: 'item/commandExecution/outputDelta',
    params: { threadId: 'a', turnId: 't', itemId: 'cmd', delta: 'passed' },
  });
  state = reduceThread(state, {
    kind: 'notification',
    method: 'item/reasoning/summaryTextDelta',
    params: { threadId: 'a', turnId: 't', itemId: 'r', delta: 'Checking', summaryIndex: 0 },
  });
  assert.equal(state.turns[0].items[0].aggregatedOutput, 'passed');
  assert.deepEqual(state.turns[0].items[1].summary, ['Checking']);
});

test('summary completion preserves user messages, steers and tools without duplicating the final answer', () => {
  const user = { id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'Original question' }] };
  const tool = { id: 'tool', type: 'commandExecution', command: 'pwd', status: 'completed' };
  const steer = {
    id: 'steer',
    type: 'userMessage',
    content: [{ type: 'text', text: 'Additional direction' }],
  };
  const answer = { id: 'answer', type: 'agentMessage', text: 'Finished' };
  const before: Thread = {
    ...empty(),
    turns: [{ id: 't', status: 'inProgress', items: [user, tool, steer, answer] }],
  };
  const event: CodexEvent = {
    kind: 'notification',
    method: 'turn/completed',
    params: { threadId: 'a', turn: { id: 't', status: 'completed', items: [answer], itemsView: 'summary' } },
  };
  const after = reduceThread(before, event);
  assert.deepEqual(after.turns[0].items, [user, tool, steer, answer]);
  assert.equal(after.turns[0].status, 'completed');
  assert.deepEqual(reduceThread(after, event).turns[0].items, after.turns[0].items);
  assert.equal(before.turns[0].status, 'inProgress');
  // An explicitly full snapshot remains authoritative (e.g. history after rollback).
  const full = reduceThread(after, {
    ...event,
    params: {
      threadId: 'a',
      turn: { id: 't', status: 'completed', items: [user, answer], itemsView: 'full' },
    },
  });
  assert.deepEqual(full.turns[0].items, [user, answer]);
});

test('compaction lifecycle uses notifications and terminal turn errors without inventing success', () => {
  const item = { id: 'c', type: 'contextCompaction' };
  const started = reduceThread(empty(), {
    kind: 'notification',
    method: 'item/started',
    params: { threadId: 'a', turnId: 't', item },
  });
  assert.equal(started.turns[0].items[0].status, 'inProgress');
  const failed = reduceThread(started, {
    kind: 'notification',
    method: 'turn/completed',
    params: {
      threadId: 'a',
      turn: {
        id: 't',
        status: 'failed',
        items: [],
        error: { message: 'Error running remote compact task: content_filter' },
      },
    },
  });
  assert.equal(failed.turns[0].items[0].status, 'failed');
  assert.equal(compactionFailure(failed.turns[0].error!.message), 'filtered');
  assert.equal(compactionFailure('Error during compaction: connection reset'), 'failed');
  assert.equal(compactionFailure('ordinary response: content_filter'), undefined);
  const compacted = reduceThread(started, {
    kind: 'notification',
    method: 'item/completed',
    params: { threadId: 'a', turnId: 't', item },
  });
  assert.equal(compacted.turns[0].items[0].status, 'completed');
  const laterFailure = reduceThread(compacted, {
    kind: 'notification',
    method: 'turn/completed',
    params: {
      threadId: 'a',
      turn: { id: 't', status: 'failed', items: [item], error: { message: 'An unrelated tool failed' } },
    },
  });
  assert.equal(laterFailure.turns[0].items[0].status, 'completed');
  assert.equal(started.turns[0].items[0].status, 'inProgress', 'previous state must stay immutable');
});
