import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = await mkdtemp(path.join(tmpdir(), 'desk-terminal-test-'));
await mkdir(path.join(root, 'runtime'), { mode: 0o700 });
try {
  const child = spawn(
    'xvfb-run',
    [
      '-a',
      'dbus-run-session',
      '--config-file',
      path.resolve('tests/fixtures/terminal-session.conf'),
      '--',
      '/usr/bin/python3',
      path.resolve('scripts/background-terminal-smoke.py'),
      root,
      ...(process.argv.includes('--native') ? ['--native'] : []),
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        XDG_RUNTIME_DIR: path.join(root, 'runtime'),
        XDG_CONFIG_HOME: path.join(root, 'config'),
        GSETTINGS_BACKEND: 'memory',
        NO_AT_BRIDGE: '1',
        GIO_USE_VFS: 'local',
        DESK_TERMINAL_TEST: '1',
      },
    },
  );
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
} finally {
  await rm(root, { recursive: true, force: true });
}
