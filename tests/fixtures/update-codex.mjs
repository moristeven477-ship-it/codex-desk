#!/usr/bin/env node
import { readFile, appendFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';

const home = process.env.CODEX_HOME;
const version = (await readFile(path.join(home, 'installed-version'), 'utf8')).trim();
if (process.argv.includes('--version')) {
  console.log(`codex-cli ${version}`);
  process.exit(0);
}
if (process.argv.includes('daemon')) process.exit(1);
const socket = process.argv[process.argv.indexOf('--listen') + 1].slice('unix://'.length);
const server = createServer();
const clients = new WebSocketServer({ server, perMessageDeflate: false });
const liveSettings = new Map();
clients.on('connection', (client) => {
  client.on('message', async (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.id === undefined) return;
    const state = JSON.parse(await readFile(path.join(home, 'threads.json'), 'utf8'));
    const p = message.params || {};
    const thread = state.threads.find((t) => t.id === p.threadId);
    let result;
    switch (message.method) {
      case 'initialize':
        result = { userAgent: `codex_desk/${version} (Linux)`, codexHome: home };
        break;
      case 'thread/loaded/list': {
        const start = Number(p.cursor || 0);
        const end = start + (state.pageSize || p.limit || 100);
        result = {
          data: state.threads.slice(start, end).map((t) => t.id),
          nextCursor: end < state.threads.length ? String(end) : null,
        };
        break;
      }
      case 'thread/read':
        result = { thread };
        break;
      case 'thread/resume': {
        const previous = liveSettings.get(p.threadId) || thread.settings || {};
        const next = { ...previous };
        for (const key of ['model', 'cwd', 'approvalPolicy', 'approvalsReviewer', 'serviceTier'])
          if (p[key] !== undefined) next[key] = p[key];
        if (p.config?.model_reasoning_effort) next.reasoningEffort = p.config.model_reasoning_effort;
        liveSettings.set(p.threadId, next);
        result = { thread, ...next };
        break;
      }
      case 'thread/settings/update': {
        const settings = liveSettings.get(p.threadId) || {};
        for (const key of ['collaborationMode', 'multiAgentMode', 'disabledPluginIds', 'serviceTier'])
          if (p[key] !== undefined) settings[key] = p[key];
        if (p.sandboxPolicy) settings.sandbox = p.sandboxPolicy;
        if (p.effort) settings.reasoningEffort = p.effort;
        liveSettings.set(p.threadId, settings);
        result = {};
        break;
      }
      case 'thread/goal/get':
        result = { goal: thread?.goal ?? null };
        break;
      case 'model/list':
        result = { data: [{ id: `model-${version}`, model: `model-${version}` }], nextCursor: null };
        break;
      case 'account/read':
        result = { account: null };
        break;
      default:
        client.send(
          JSON.stringify({ id: message.id, error: { code: -32601, message: 'Unknown fixture method' } }),
        );
        return;
    }
    client.send(JSON.stringify({ id: message.id, result }));
  });
});
server.listen(socket);
process.on('SIGTERM', () => {
  void appendFile(path.join(home, 'stopped.log'), `${version}\n`).finally(() => {
    for (const client of clients.clients) client.terminate();
    server.close(() => process.exit(0));
  });
});
