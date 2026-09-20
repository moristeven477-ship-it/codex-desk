#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
if (process.argv.includes('--version')) {
  console.log('codex-cli 0.154.0-fixture');
  process.exit(0);
}
if (process.argv.includes('daemon')) {
  if (process.env.CODEX_DESK_FIXTURE_LAUNCH_LOG)
    appendFileSync(process.env.CODEX_DESK_FIXTURE_LAUNCH_LOG, process.argv.slice(2).join(' ') + '\n');
  if (!process.argv.includes('start')) process.exit(1);
  process.exit(0);
}
if (process.argv.includes('--remote')) {
  let input = '';
  process.stdin.setRawMode?.(true);
  process.stdout.write('\x1b[2J\x1b[HCODEX_CLI_FIXTURE_READY\r\n› ');
  process.stdin.on('data', (data) => {
    for (const character of data.toString()) {
      if (character === '\x03') process.exit(0);
      else if (character === '\x15') {
        input = '';
        process.stdout.write('\r\x1b[2K› ');
      } else if (character === '\r') {
        if (input === '/exit') process.exit(0);
        process.stdout.write('\r\nCLI executed: ' + input + '\r\n› ');
        input = '';
      } else {
        input += character;
        process.stdout.write(character);
      }
    }
  });
  await new Promise(() => {});
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
const locked = new Set();
const goals = new Map();
const settings = new Map();
const loaded = new Set(['fixture-history']);
let lastTurnParams;
let lastSteerParams;
let settingsDelay = 0;
let settingsError = '';
let compactionMode = 'success';
let compactionItem = true;
const currentSettings = (thread) =>
  settings.get(thread.id) || {
    model: thread.model || 'test-codex',
    serviceTier: null,
    effort: 'medium',
    cwd: thread.cwd,
    sandboxPolicy: { type: 'workspaceWrite' },
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    collaborationMode: {
      mode: 'default',
      settings: { model: 'test-codex', reasoning_effort: 'medium', developer_instructions: null },
    },
  };
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
      reply({ userAgent: 'fixture', codexHome: process.env.CODEX_HOME || '/fixture/.codex' });
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
            description: 'A capable model for everyday coding tasks.',
            isDefault: true,
            serviceTiers: [{ id: 'priority', name: 'Fast', description: 'Faster, increased usage' }],
            additionalSpeedTiers: ['fast'],
            defaultReasoningEffort: 'medium',
            supportedReasoningEfforts: [
              { reasoningEffort: 'medium', description: 'Balanced' },
              { reasoningEffort: 'high', description: 'Thorough' },
            ],
          },
          {
            id: 'test-fast',
            model: 'test-fast',
            displayName: 'Codex · Fast fixture',
            description: 'Quick answers for small coding tasks.',
            isDefault: false,
            serviceTiers: [],
            additionalSpeedTiers: [],
            defaultReasoningEffort: 'low',
            supportedReasoningEfforts: [
              { reasoningEffort: 'low', description: 'Quick' },
              { reasoningEffort: 'medium', description: 'Balanced' },
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
              (!p.searchTerm || (t.name || t.preview).includes(p.searchTerm)),
          )
          .map((t) => ({ ...t, turns: [] })),
        nextCursor: null,
      });
      break;
    case 'thread/loaded/list':
      reply({ data: [...loaded].filter((id) => !locked.has(id)), nextCursor: null });
      break;
    case 'thread/read':
      if (p.includeTurns && thread.materialized === false) {
        if (!thread.metadataReady) {
          write({ id: message.id, error: { code: -32601, message: 'list_turns is not supported yet' } });
          break;
        }
        thread.materialized = true;
      }
      reply({ thread: { ...thread, turns: p.includeTurns ? thread.turns : [] } });
      break;
    case 'thread/metadata/update':
      thread.metadataReady = true;
      reply({ thread });
      break;
    case 'thread/turns/list':
      reply({
        data: [...thread.turns].reverse().map((turn) => ({ ...turn, itemsView: 'full' })),
        nextCursor: null,
      });
      break;
    case 'thread/resume':
      if (thread.materialized === false)
        write({
          id: message.id,
          error: { code: -32600, message: 'no rollout found for thread id ' + thread.id },
        });
      else if (locked.has(thread.id))
        write({
          id: message.id,
          error: { code: -32000, message: `thread ${thread.id} already has an active writer` },
        });
      else {
        if (!loaded.has(thread.id)) {
          const next = { ...currentSettings(thread) };
          if (p.sandbox)
            next.sandboxPolicy = {
              type: {
                'danger-full-access': 'dangerFullAccess',
                'workspace-write': 'workspaceWrite',
                'read-only': 'readOnly',
              }[p.sandbox],
            };
          if (p.approvalPolicy) next.approvalPolicy = p.approvalPolicy;
          if ('serviceTier' in p) next.serviceTier = p.serviceTier;
          settings.set(thread.id, next);
        }
        loaded.add(thread.id);
        reply({
          thread,
          model: currentSettings(thread).model,
          serviceTier: currentSettings(thread).serviceTier,
          reasoningEffort: currentSettings(thread).effort,
          sandbox: currentSettings(thread).sandboxPolicy,
          approvalPolicy: currentSettings(thread).approvalPolicy,
          approvalsReviewer: currentSettings(thread).approvalsReviewer,
        });
        notify('thread/settings/updated', { threadId: thread.id, threadSettings: currentSettings(thread) });
      }
      break;
    case 'thread/settings/update': {
      if (settingsError) {
        write({ id: message.id, error: { code: -32000, message: settingsError } });
        break;
      }
      const next = { ...currentSettings(thread), ...p };
      // Current Codex versions canonicalize an explicit clear to standard speed.
      if (p.serviceTier === null) next.serviceTier = 'default';
      reply({});
      const apply = () => {
        settings.set(thread.id, next);
        notify('thread/settings/updated', { threadId: thread.id, threadSettings: next });
      };
      if (settingsDelay) setTimeout(apply, settingsDelay);
      else apply();
      break;
    }
    case 'thread/goal/get':
      reply({ goal: goals.get(p.threadId) || null });
      break;
    case 'thread/goal/set': {
      const goal = {
        threadId: thread.id,
        objective: '',
        status: 'active',
        tokenBudget: null,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: Date.now() / 1000,
        ...goals.get(thread.id),
        ...p,
        updatedAt: Date.now() / 1000,
      };
      goals.set(thread.id, goal);
      reply({ goal });
      notify('thread/goal/updated', { threadId: thread.id, turnId: null, goal });
      break;
    }
    case 'thread/goal/clear':
      goals.delete(thread.id);
      reply({});
      notify('thread/goal/cleared', { threadId: thread.id });
      break;
    case 'thread/compact/start': {
      if (thread.status.type === 'active') {
        write({ id: message.id, error: { code: -32600, message: 'Thread is already active.' } });
        break;
      }
      const turn = { id: `compact-${++turnCounter}`, status: 'inProgress', items: [], error: null };
      const mode = compactionMode;
      thread.turns.push(turn);
      thread.status = { type: 'active' };
      reply({});
      notify('turn/started', { threadId: thread.id, turn });
      const item = { id: 'compaction-' + turn.id, type: 'contextCompaction' };
      if (compactionItem) {
        turn.items.push(item);
        notify('item/started', { threadId: thread.id, turnId: turn.id, item });
      }
      setTimeout(() => {
        if (turn.status !== 'inProgress') return;
        if (mode !== 'success') {
          turn.status = 'failed';
          turn.error = {
            message:
              'Error running remote compact task: ' +
              (mode === 'filtered'
                ? 'stream disconnected before completion: Incomplete response returned, reason: content_filter'
                : 'stream disconnected before completion: connection reset'),
          };
          notify('error', { threadId: thread.id, turnId: turn.id, error: turn.error, willRetry: false });
        } else {
          turn.status = 'completed';
          if (!turn.items.length) turn.items.push(item);
          notify('item/completed', { threadId: thread.id, turnId: turn.id, item });
        }
        thread.status = { type: 'idle' };
        notify('turn/completed', { threadId: thread.id, turn: { ...turn, items: [] } });
      }, 350);
      break;
    }
    case 'thread/start': {
      const created = {
        ...threads[0],
        id: `fixture-${threads.length + 1}`,
        name: null,
        preview: '',
        cwd: p.cwd,
        turns: [],
        archived: false,
        materialized: false,
        metadataReady: false,
      };
      threads.push(created);
      loaded.add(created.id);
      const initial = currentSettings(created);
      if (p.sandbox)
        initial.sandboxPolicy = {
          type: {
            'danger-full-access': 'dangerFullAccess',
            'workspace-write': 'workspaceWrite',
            'read-only': 'readOnly',
          }[p.sandbox],
        };
      if (p.approvalPolicy) initial.approvalPolicy = p.approvalPolicy;
      if (p.model) initial.model = p.model;
      settings.set(created.id, initial);
      reply({
        thread: created,
        model: initial.model,
        reasoningEffort: initial.effort,
        serviceTier: initial.serviceTier,
        sandbox: initial.sandboxPolicy,
        approvalPolicy: initial.approvalPolicy,
        approvalsReviewer: initial.approvalsReviewer,
      });
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
      lastTurnParams = p;
      const next = {
        ...currentSettings(thread),
        model: p.model || currentSettings(thread).model,
        serviceTier: 'serviceTier' in p ? p.serviceTier : currentSettings(thread).serviceTier,
        effort: p.effort || currentSettings(thread).effort,
        sandboxPolicy: p.sandboxPolicy || currentSettings(thread).sandboxPolicy,
        approvalPolicy: p.approvalPolicy || currentSettings(thread).approvalPolicy,
        approvalsReviewer: p.approvalsReviewer || currentSettings(thread).approvalsReviewer,
        collaborationMode: p.collaborationMode || currentSettings(thread).collaborationMode,
      };
      settings.set(thread.id, next);
      notify('thread/settings/updated', { threadId: thread.id, threadSettings: next });
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
    case 'turn/steer': {
      const turn = thread?.turns.findLast((turn) => turn.status === 'inProgress');
      if (!turn || turn.id !== p.expectedTurnId) {
        write({
          id: message.id,
          error: {
            code: -32600,
            message: turn ? 'Expected turn ID does not match the active turn.' : 'No active turn to steer.',
          },
        });
        break;
      }
      lastSteerParams = p;
      const user = { id: `steer-${turn.id}-${turn.items.length}`, type: 'userMessage', content: p.input };
      turn.items.push(user);
      reply({ turnId: turn.id });
      notify('item/completed', { threadId: thread.id, turnId: turn.id, item: user });
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
    case 'test.settings':
      reply(currentSettings(thread));
      break;
    case 'test.settingsDelay':
      settingsDelay = p.milliseconds;
      reply({});
      break;
    case 'test.settingsError':
      settingsError = p.message || '';
      reply({});
      break;
    case 'test.compaction':
      compactionMode = p.mode;
      compactionItem = p.item !== false;
      reply({});
      break;
    case 'test.lock':
      if (p.locked) locked.add(p.threadId);
      else locked.delete(p.threadId);
      reply({});
      break;
    case 'test.lastTurn':
      reply(lastTurnParams || {});
      break;
    case 'test.lastSteer':
      reply(lastSteerParams || {});
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
  // Real 0.154+ servers send a summary containing only the final answer.
  notify('turn/completed', { threadId: thread.id, turn: { ...turn, items: [agent], itemsView: 'summary' } });
}
