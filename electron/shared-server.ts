import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { mkdir, open, lstat, unlink, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function socketReady(socket: string): Promise<boolean> {
  return new Promise((resolve) => {
    const connection = createConnection(socket);
    const finish = (ready: boolean) => {
      connection.destroy();
      resolve(ready);
    };
    connection.once('connect', () => finish(true));
    connection.once('error', () => finish(false));
    connection.setTimeout(500, () => finish(false));
  });
}

// npm installations lack the standalone installer required by `daemon start`.
// Use the same official Unix listener, detached from Desk's lifetime.
export async function startSharedListener(binary: string, env: NodeJS.ProcessEnv, socket: string) {
  if (await socketReady(socket)) return;
  const directory = path.dirname(socket);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const pidFile = path.join(directory, 'codex-desk-server.json');
  const metadata = await lstat(socket).catch(() => null);
  if (metadata) {
    if (!metadata.isSocket() || metadata.uid !== process.getuid?.())
      throw new Error('The Codex control socket has an unexpected owner or type.');
    const previous = JSON.parse(await readFile(pidFile, 'utf8').catch(() => '{}')) as { pid?: number };
    let alive = false;
    if (previous.pid) {
      try {
        process.kill(previous.pid, 0);
        alive = true;
      } catch {
        /* exited */
      }
    }
    // Only clean up a stale listener previously started by Desk.
    if (!previous.pid || alive)
      throw new Error(
        'The Codex control socket is unavailable. Reconnect after its current server finishes starting.',
      );
    if (await socketReady(socket)) return;
    await unlink(socket);
  }
  const log = await open(path.join(directory, 'codex-desk-server.log'), 'a', 0o600);
  const child = spawn(binary, ['app-server', '--listen', `unix://${socket}`], {
    env,
    detached: true,
    stdio: ['ignore', log.fd, log.fd],
  });
  let startupError: Error | undefined;
  child.once('error', (error) => {
    startupError = error;
  });
  child.unref();
  await log.close();
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await socketReady(socket)) {
      if (child.exitCode === null && child.pid)
        await writeFile(pidFile, JSON.stringify({ pid: child.pid }), { mode: 0o600 });
      return;
    }
    if (startupError) throw startupError;
    if (child.exitCode !== null)
      throw new Error(
        'Codex could not start its shared Unix listener. Check app-server-control/codex-desk-server.log under CODEX_HOME.',
      );
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the shared Codex listener.');
}
