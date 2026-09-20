import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import WebSocket, { WebSocketServer } from 'ws';

// One deterministic backend, multiple independent real Unix WebSocket clients.
export async function sharedFixture(root, project) {
  const home = path.join(root, 'codex-home');
  const socket = path.join(home, 'app-server-control/app-server-control.sock');
  await mkdir(path.dirname(socket), { recursive: true, mode: 0o700 });
  const backend = spawn(process.execPath, [path.resolve('tests/fixtures/fake-codex.mjs')], {
    env: { ...process.env, CODEX_HOME: home, CODEX_DESK_FIXTURE_ROOT: project },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const server = createServer();
  const websocket = new WebSocketServer({ noServer: true });
  const requests = new Map(),
    pendingApprovals = new Set();
  let nextId = 1000;
  const send = (message) => backend.stdin.write(JSON.stringify(message) + '\n');
  const broadcast = (message) => {
    for (const client of websocket.clients)
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
  };
  server.on('upgrade', (request, connection, head) => {
    // Matches the installed Codex Unix listener: no compression extension.
    if (request.headers['sec-websocket-extensions'] || request.headers.origin) {
      connection.destroy();
      return;
    }
    websocket.handleUpgrade(request, connection, head, (client) => websocket.emit('connection', client));
  });
  websocket.on('connection', (client) => {
    client.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.method && message.id !== undefined) {
        const id = nextId++;
        requests.set(id, { client, id: message.id });
        send({ ...message, id });
      } else if (!message.method && message.id !== undefined) {
        if (!pendingApprovals.delete(message.id)) return;
        send(message);
        broadcast({ method: 'serverRequest/resolved', params: { requestId: message.id } });
      } else send(message);
    });
    client.on('error', () => {});
  });
  createInterface({ input: backend.stdout }).on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!message.method && message.id !== undefined) {
      const request = requests.get(message.id);
      requests.delete(message.id);
      if (request?.resolve) {
        clearTimeout(request.timer);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
      }
      if (request?.client?.readyState === WebSocket.OPEN)
        request.client.send(JSON.stringify({ ...message, id: request.id }));
    } else {
      if (message.id !== undefined) pendingApprovals.add(message.id);
      broadcast(message);
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socket, resolve);
  });
  return {
    home,
    // Test control goes straight to this fixture, never through Desk's IPC API.
    request: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          requests.delete(id);
          reject(new Error(`Fixture request timed out: ${method}`));
        }, 5000);
        requests.set(id, { resolve, reject, timer });
        send({ id, method, params });
      }),
    close: async () => {
      for (const client of websocket.clients) client.terminate();
      websocket.close();
      await new Promise((resolve) => server.close(resolve));
      backend.stdin.end();
      backend.kill();
      await new Promise((resolve) => {
        if (backend.exitCode !== null) resolve();
        else backend.once('exit', resolve);
      });
    },
  };
}
