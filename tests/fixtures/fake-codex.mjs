#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
if (process.argv.includes('--version')) {
  console.log('codex-cli 0.154.0-fixture');
  process.exit(0);
}
const write = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const notify = (method, params) => write({ method, params });
const root = process.env.CODEX_DESK_FIXTURE_ROOT || '/workspace/atlas';
const threads = [
  {
    id: 'fixture-history',
    name: 'Understand the project',
    preview: 'Map the project',
    cwd: root,
    model: 'test-codex',
    createdAt: 1700000000,
    updatedAt: 1700000000,
    status: { type: 'idle' },
    turns: [
      {
        id: 'history-turn',
        status: 'completed',
        items: [
          {
            id: 'history-user',
            type: 'userMessage',
            content: [{ type: 'text', text: 'Explain this project.', text_elements: [] }],
          },
          { id: 'history-agent', type: 'agentMessage', text: 'This is **Atlas**, a small React workspace.' },
        ],
      },
    ],
  },
];
let turnCounter = 0;
let pendingApproval;
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line),
    p = message.params || {};
  if (process.env.CODEX_DESK_FIXTURE_LOG) appendFileSync(process.env.CODEX_DESK_FIXTURE_LOG, line + '\n');
  if (!message.method) {
    if (pendingApproval && message.id === 77) {
      const { thread, turn } = pendingApproval;
      notify('test/replied', { decision: message.result?.decision });
      finish(thread, turn, `Decision: ${message.result?.decision}`);
      pendingApproval = null;
    }
    return;
  }
  const reply = (result) => write({ id: message.id, result });
  const thread = threads.find((t) => t.id === p.threadId);
  switch (message.method) {
    case 'initialize':
      reply({ userAgent: 'fixture', codexHome: '/fixture/.codex' });
      break;
    case 'initialized':
      break;
    case 'model/list':
      reply({
        data: [
          {
            id: 'test-codex',
            model: 'test-codex',
            displayName: 'Codex · Test fixture',
            isDefault: true,
            defaultReasoningEffort: 'medium',
            supportedReasoningEfforts: [
              { reasoningEffort: 'medium', description: 'Balanced' },
              { reasoningEffort: 'high', description: 'Thorough' },
            ],
          },
        ],
        nextCursor: null,
      });
      break;
    case 'account/read':
      reply({
        account: { type: 'chatgpt', email: 'demo@example.com', planType: 'demo' },
        requiresOpenaiAuth: true,
      });
      break;
    case 'thread/list':
      reply({
        data: threads
          .filter(
            (t) =>
              !!t.archived === !!p.archived &&
              (!p.cwd || t.cwd === p.cwd) &&
              (!p.searchTerm || t.name.includes(p.searchTerm)),
          )
          .map((t) => ({ ...t, turns: [] })),
        nextCursor: null,
      });
      break;
    case 'thread/read':
      reply({ thread: { ...thread, turns: p.includeTurns ? thread.turns : [] } });
      break;
    case 'thread/turns/list':
      reply({ data: [...thread.turns].reverse(), nextCursor: null });
      break;
    case 'thread/resume':
      reply({ thread });
      break;
    case 'thread/start': {
      const created = {
        ...threads[0],
        id: `fixture-${threads.length + 1}`,
        name: null,
        preview: '',
        cwd: p.cwd,
        turns: [],
        archived: false,
      };
      threads.push(created);
      reply({ thread: created });
      notify('thread/started', { thread: created });
      break;
    }
    case 'thread/name/set':
      thread.name = p.name;
      reply({});
      notify('thread/name/updated', { threadId: thread.id, threadName: p.name });
      break;
    case 'thread/archive':
      thread.archived = true;
      reply({});
      break;
    case 'thread/unarchive':
      thread.archived = false;
      reply({ thread });
      break;
    case 'thread/fork': {
      const fork = structuredClone(thread);
      fork.id = 'fork-' + threads.length;
      fork.name += ' (fork)';
      threads.push(fork);
      reply({ thread: fork });
      break;
    }
    case 'turn/start': {
      const turn = { id: `turn-${++turnCounter}`, status: 'inProgress', items: [] };
      thread.turns.push(turn);
      thread.status = { type: 'active' };
      thread.preview = p.input[0]?.text || '';
      reply({ turn });
      notify('turn/started', { threadId: thread.id, turn: { ...turn, items: [] } });
      const user = { id: 'user-' + turn.id, type: 'userMessage', content: p.input };
      turn.items.push(user);
      notify('item/completed', { threadId: thread.id, turnId: turn.id, item: user });
      const input = p.input[0]?.text || '';
      if (input.includes('approval')) {
        pendingApproval = { thread, turn };
        write({
          id: 77,
          method: 'item/commandExecution/requestApproval',
          params: {
            threadId: thread.id,
            turnId: turn.id,
            itemId: 'command-1',
            command: 'npm test',
            cwd: thread.cwd,
            reason: 'Run project tests',
            availableDecisions: ['accept', 'decline', 'cancel'],
          },
        });
      } else if (!input.includes('wait'))
        setTimeout(() => finish(thread, turn, 'Done. Your local Codex conversation is working.'), 100);
      break;
    }
    case 'turn/interrupt': {
      const turn = thread.turns.find((t) => t.id === p.turnId);
      turn.status = 'interrupted';
      thread.status = { type: 'idle' };
      reply({});
      notify('turn/completed', { threadId: thread.id, turn });
      break;
    }
    case 'test.ping':
      reply(p);
      break;
    case 'test.hang':
      break;
    case 'test.exit':
      process.exit(9);
      break;
    case 'test.malformed':
      process.stdout.write('not-json\n');
      reply({ ok: true });
      break;
    case 'test.unsupported':
      write({ id: 'unsupported', method: 'unknown/client/request', params: {} });
      reply({});
      break;
    default:
      write({
        id: message.id,
        error: { code: -32601, message: 'Unknown fixture method: ' + message.method },
      });
  }
});
function finish(thread, turn, text) {
  if (turn.status !== 'inProgress') return;
  const agent = { id: 'agent-' + turn.id, type: 'agentMessage', text: '' };
  turn.items.push(agent);
  notify('item/started', { threadId: thread.id, turnId: turn.id, item: agent });
  for (const delta of [text.slice(0, 10), text.slice(10)]) {
    agent.text += delta;
    notify('item/agentMessage/delta', { threadId: thread.id, turnId: turn.id, itemId: agent.id, delta });
  }
  notify('item/completed', { threadId: thread.id, turnId: turn.id, item: agent });
  turn.status = 'completed';
  thread.status = { type: 'idle' };
  thread.updatedAt = Date.now() / 1000;
  notify('turn/completed', { threadId: thread.id, turn: { ...turn, items: [] } });
}
