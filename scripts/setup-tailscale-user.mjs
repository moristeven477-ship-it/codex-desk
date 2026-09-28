// Optional source-install helper. Desktop users can use Settings → Phone access.
// Reuse the same verified installer as the app; source builds already include tsx.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const child = spawn(
  process.execPath,
  ['--import', 'tsx', fileURLToPath(new URL('./setup-tailscale-user.ts', import.meta.url))],
  { stdio: 'inherit' },
);
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
