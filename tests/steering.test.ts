import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readPendingSteers,
  reconcileSteerEvent,
  reconcileSteerHistory,
  setSteerPhase,
  type PendingSteer,
} from '../src/shared/steering';
import type { CodexEvent, Thread } from '../src/shared/types';

const entry = (clientId: string): PendingSteer => ({
  clientId,
  threadId: 'thread',
  turnId: 'turn',
  text: 'Same text',
  images: ['/private/image.png'],
  phase: 'submitted',
});
const receive = (clientId: string | null): CodexEvent => ({
  kind: 'notification',
  method: 'item/completed',
  params: {
    threadId: 'thread',
    turnId: 'turn',
    item: {
      type: 'userMessage',
      id: 'official-item',
      clientId,
      content: [{ type: 'text', text: 'Same text' }],
    },
  },
});

test('steering receipts match client IDs, including repeated identical text and acknowledgements after delivery', () => {
  const pending = [entry('one'), entry('two')];
  assert.equal(reconcileSteerEvent(pending, receive(null)), pending);
  const wrongThread = receive('one');
  wrongThread.params!.threadId = 'another-thread';
  assert.equal(reconcileSteerEvent(pending, wrongThread), pending);
  const remaining = reconcileSteerEvent(pending, receive('one'));
  assert.deepEqual(remaining, [entry('two')]);
  assert.equal(
    setSteerPhase(remaining, 'one', 'submitted'),
    remaining,
    'late acknowledgement must not recreate a receipt',
  );
  assert.deepEqual(pending, [entry('one'), entry('two')]);
  const reopened = {
    id: 'thread',
    turns: [{ id: 'turn', status: 'completed', items: [receive('two').params!.item] }],
  } as Thread;
  assert.deepEqual(reconcileSteerHistory(remaining, reopened), []);
});

test('unconsumed steering stays visible across interruption and reload without implying delivery', () => {
  const pending = [entry('one')];
  const stopped = reconcileSteerEvent(pending, {
    kind: 'notification',
    method: 'turn/completed',
    params: { threadId: 'thread', turn: { id: 'turn', status: 'interrupted', items: [] } },
  });
  assert.equal(stopped[0].phase, 'unconfirmed');
  assert.equal(setSteerPhase(stopped, 'one', 'submitted'), stopped);
  assert.deepEqual(readPendingSteers(JSON.stringify(stopped)), stopped);
  assert.equal(
    readPendingSteers(JSON.stringify([{ ...entry('one'), phase: 'sending' }]))[0].phase,
    'unconfirmed',
  );
  assert.deepEqual(
    reconcileSteerEvent(stopped, receive('one')),
    [],
    'a late official receipt remains authoritative',
  );
  assert.deepEqual(readPendingSteers('{corrupt'), []);
  assert.deepEqual(readPendingSteers('[{}]'), []);
});
