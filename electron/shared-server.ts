import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { mkdir, open, lstat, unlink, readFile, writeFile, readlink } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

type ProcessIdentity = { pid: number; startTime: string };

async function ownedSocketPath(socket: string, allowStaleTarget = false): Promise<boolean> {
  const endpoint = await lstat(socket);
  const uid = process.getuid?.();
  if (endpoint.uid !== uid) return false;
  if (endpoint.isSocket()) return true;
  if (!endpoint.isSymbolicLink()) return false;
  // Recent CLI versions publish a symlink into their private runtime directory.
  // Validate both ends; never follow a link to an arbitrary file or shared directory.
  const target = path.resolve(path.dirname(socket), await readlink(socket));
  const directory = await lstat(path.dirname(target));
  if (!directory.isDirectory() || directory.uid !== uid || (directory.mode & 0o022) !== 0) return false;
  const resolved = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  return resolved ? resolved.isSocket() && resolved.uid === uid : allowStaleTarget;
}

async function processIdentity(pid: number): Promise<ProcessIdentity | undefined> {
  if (!Number.isSafeInteger(pid) || pid < 2) return;
  try {
    const metadata = await lstat(`/proc/${pid}`);
    if (metadata.uid !== process.getuid?.()) return;
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (fields[0] === 'Z' || !fields[19]) return;
    return { pid, startTime: fields[19] };
  } catch {
    return;
  }
}

// A PID alone is not ownership: it may have been reused since Desk last ran.
// Check the owner's UID, process start time, and exact listener arguments.
export async function ownedSharedListener(socket: string): Promise<ProcessIdentity | undefined> {
  try {
    const file = path.join(path.dirname(socket), 'codex-desk-server.json');
    const metadata = await lstat(file);
    if (!metadata.isFile() || metadata.uid !== process.getuid?.() || !(await ownedSocketPath(socket))) return;
    const saved = JSON.parse(await readFile(file, 'utf8')) as Partial<ProcessIdentity>;
    const live = await processIdentity(saved.pid!);
    if (!live || (saved.startTime && saved.startTime !== live.startTime)) return;
    const args = (await readFile(`/proc/${live.pid}/cmdline`, 'utf8')).split('\0');
    const listen = args.indexOf('--listen');
    if (!args.includes('app-server') || listen < 0 || args[listen + 1] !== `unix://${socket}`) return;
    return live;
  } catch {
    return;
  }
}

export async function stopOwnedSharedListener(socket: string, expected: ProcessIdentity): Promise<void> {
  const live = await ownedSharedListener(socket);
  if (!live || live.pid !== expected.pid || live.startTime !== expected.startTime)
    throw new Error('The Codex listener changed before the update. / Codex 后台已变化，请重试。');
  process.kill(live.pid, 'SIGTERM');
  for (let attempt = 0; attempt < 200; attempt++) {
    const current = await processIdentity(live.pid);
    if (!current || current.startTime !== live.startTime) {
      if (!(await socketReady(socket))) return;
      throw new Error('Another Codex listener started during the update.');
    }
    await delay(100);
  }
  // Do not escalate to SIGKILL: another client may have started work meanwhile.
  throw new Error('Codex is still shutting down; reconnect shortly. / Codex 正在退出，请稍后重连。');
}

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
    if (!(await ownedSocketPath(socket, true)))
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
        await writeFile(pidFile, JSON.stringify((await processIdentity(child.pid)) ?? { pid: child.pid }), {
          mode: 0o600,
        });
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
