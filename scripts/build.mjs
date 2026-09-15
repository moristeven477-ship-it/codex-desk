import { build } from 'esbuild';
import './notices.mjs';
import { copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
await build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  bundle: true,
  outdir: 'dist-electron',
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outExtension: { '.js': '.cjs' },
  external: ['electron'],
  sourcemap: false,
});
await copyFile('electron/pty-bridge.py', 'dist-electron/pty-bridge.py');
await copyFile('electron/background-terminal.py', 'dist-electron/background-terminal.py');
execFileSync('cc', [
  '-shared',
  '-fPIC',
  '-O2',
  '-Wall',
  '-Wextra',
  '-Werror',
  '-Wl,-z,relro,-z,now',
  '-o',
  'dist-electron/background-window.so',
  'electron/background-window.c',
  '-ldl',
]);
