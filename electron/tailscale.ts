import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import path from 'node:path';
const run = promisify(execFile);
const localRoot = path.join(homedir(), '.local/share/codex-desk/tailscale');
async function command(args: string[]) {
  try {
    return (await run('tailscale', args, { timeout: 20_000, maxBuffer: 2_000_000 })).stdout;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return (
      await run(
        path.join(localRoot, 'tailscale'),
        ['--socket=' + path.join(localRoot, 'tailscaled.sock'), ...args],
        { timeout: 20_000, maxBuffer: 2_000_000 },
      )
    ).stdout;
  }
}
export async function tailscaleStatus() {
  try {
    const info = JSON.parse(await command(['status', '--json']));
    const dns = String(info.Self?.DNSName ?? '').replace(/\.$/, '');
    return { installed: true, state: String(info.BackendState), dns, url: dns ? `https://${dns}:8443` : '' };
  } catch {
    return { installed: false, state: 'Unavailable', dns: '', url: '' };
  }
}
export async function serveDesk(port: number) {
  const status = await tailscaleStatus();
  if (!status.installed || status.state !== 'Running' || !status.url)
    throw new Error('Sign in to Tailscale on the computer first. / 请先在电脑上登录 Tailscale。');
  const config = JSON.parse(await command(['serve', 'status', '--json']));
  const address = `${status.dns}:8443`,
    proxy = `http://127.0.0.1:${port}`;
  const handlers = config.Web?.[address]?.Handlers;
  if (
    config.AllowFunnel?.[address] ||
    (handlers && (Object.keys(handlers).some((k) => k !== '/') || handlers['/']?.Proxy !== proxy)) ||
    (config.TCP?.['8443'] && !handlers)
  )
    throw new Error(
      'Tailscale port 8443 already serves another application. Its configuration was preserved.',
    );
  await command(['serve', '--bg', '--https=8443', proxy]);
  return status.url;
}
