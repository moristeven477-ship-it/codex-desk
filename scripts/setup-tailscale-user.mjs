// Optional Ubuntu x86-64 setup when a system Tailscale installation is unavailable.
import { mkdir, readFile, writeFile, chmod, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const version = '1.102.4';
const checksum = '50748df1045e60b5b695f19f4c56b0da36c019948b440fb456b6584a50f0d8b9';
if (process.platform !== 'linux' || process.arch !== 'x64')
  throw new Error(
    'This helper supports Ubuntu x86-64. Use the official Tailscale installer on other systems.',
  );
const directory = path.join(homedir(), '.local/share/codex-desk/tailscale');
await mkdir(directory, { recursive: true, mode: 0o700 });
const binary = path.join(directory, 'tailscale');
try {
  await access(binary);
} catch {
  const archive = path.join(directory, 'tailscale.tgz');
  let bytes = await readFile(archive).catch(() => null);
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== checksum) {
    console.log('Downloading the official Tailscale static distribution…');
    const response = await fetch(`https://pkgs.tailscale.com/stable/tailscale_${version}_amd64.tgz`);
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(bytes).digest('hex') !== checksum)
    throw new Error('Tailscale checksum mismatch.');
  await writeFile(archive, bytes, { mode: 0o600 });
  execFileSync('tar', [
    '-xzf',
    archive,
    '--strip-components=1',
    '-C',
    directory,
    `tailscale_${version}_amd64/tailscale`,
    `tailscale_${version}_amd64/tailscaled`,
  ]);
  await chmod(binary, 0o755);
  await chmod(path.join(directory, 'tailscaled'), 0o755);
}
const unitDirectory = path.join(homedir(), '.config/systemd/user');
await mkdir(unitDirectory, { recursive: true });
const quote = (value) => JSON.stringify(value.replaceAll('%', '%%'));
const unit = `[Unit]\nDescription=Codex Desk private Tailscale endpoint\nAfter=network.target\n\n[Service]\nExecStart=${quote(path.join(directory, 'tailscaled'))} --tun=userspace-networking --state=${quote(path.join(directory, 'tailscaled.state'))} --socket=${quote(path.join(directory, 'tailscaled.sock'))}\nRestart=on-failure\nRestartSec=5\nUMask=0077\n\n[Install]\nWantedBy=default.target\n`;
await writeFile(path.join(unitDirectory, 'codex-desk-tailscale.service'), unit);
execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
execFileSync('systemctl', ['--user', 'enable', '--now', 'codex-desk-tailscale.service'], {
  stdio: 'inherit',
});
console.log('Private userspace Tailscale is installed. Sign in with the same account as your phone:');
try {
  execFileSync(
    binary,
    [
      `--socket=${path.join(directory, 'tailscaled.sock')}`,
      'up',
      '--accept-dns=false',
      '--hostname=codex-desk',
      '--timeout=30s',
    ],
    { stdio: 'inherit' },
  );
} catch (error) {
  process.exitCode = error.status || 1;
}
