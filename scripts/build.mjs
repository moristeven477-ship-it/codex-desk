import { build } from 'esbuild';
import './notices.mjs';
import { copyFile } from 'node:fs/promises';
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
