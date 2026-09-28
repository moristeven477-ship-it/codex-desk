import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod, mkdtemp, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { PhoneSetup } from '../src/shared/remote';

export const tailscaleArtifact = {
  version: '1.102.4',
  checksum: '50748df1045e60b5b695f19f4c56b0da36c019948b440fb456b6584a50f0d8b9',
  directory: 'tailscale_1.102.4_amd64',
  url: 'https://pkgs.tailscale.com/stable/tailscale_1.102.4_amd64.tgz',
};
export type Run = (
  file: string,
  args: string[],
  options: { signal: AbortSignal; timeout?: number; output?: (text: string) => void },
) => Promise<string>;

export async function downloadTailscale(url: string, signal: AbortSignal, progress: (value: number) => void) {
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]) });
  if (!response.ok || !response.body) throw new Error(`Tailscale download: HTTP ${response.status}`);
  const size = Number(response.headers.get('content-length'));
  const chunks: Uint8Array[] = [];
  let received = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    received += chunk.length;
    if (received > 100 * 1024 * 1024) throw new Error('Tailscale download exceeded the size limit.');
    chunks.push(chunk);
    if (size > 0) progress(Math.min(100, Math.round((received / size) * 100)));
  }
  return Buffer.concat(chunks);
}

// Shared by desktop setup and the optional source-install helper. No shell or sudo.
export async function installManagedTailscale(options: {
  home: string;
  run: Run;
  signal: AbortSignal;
  update: (state: Partial<PhoneSetup>) => void;
  artifact?: typeof tailscaleArtifact;
  download?: typeof downloadTailscale;
}) {
  const { home, run, signal, update } = options;
  const artifact = options.artifact ?? tailscaleArtifact;
  const directory = path.join(home, '.local/share/codex-desk/tailscale');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const archive = path.join(directory, 'tailscale.tgz');
  const verified = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex') === artifact.checksum;
  let bytes = await readFile(archive).catch(() => null);
  if (!bytes || !verified(bytes)) {
    update({ stage: 'downloading', progress: 0 });
    bytes = await (options.download ?? downloadTailscale)(artifact.url, signal, (progress) =>
      update({ progress }),
    );
  }
  signal.throwIfAborted();
  if (!verified(bytes))
    throw new Error(
      'Tailscale download verification failed. Please retry. / Tailscale 下载校验失败，请重试。',
    );
  update({ stage: 'installing', progress: undefined });
  const staging = await mkdtemp(path.join(directory, '.install-'));
  try {
    await writeFile(path.join(staging, 'archive.tgz'), bytes, { mode: 0o600 });
    await run(
      'tar',
      [
        '-xzf',
        path.join(staging, 'archive.tgz'),
        '--strip-components=1',
        '-C',
        staging,
        `${artifact.directory}/tailscale`,
        `${artifact.directory}/tailscaled`,
      ],
      { signal },
    );
    signal.throwIfAborted();
    for (const name of ['tailscale', 'tailscaled']) {
      await chmod(path.join(staging, name), 0o755);
      await rename(path.join(staging, name), path.join(directory, name));
    }
    await rename(path.join(staging, 'archive.tgz'), archive);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  const unitDirectory = path.join(home, '.config/systemd/user');
  await mkdir(unitDirectory, { recursive: true });
  const quote = (value: string) => JSON.stringify(value.replaceAll('%', '%%').replaceAll('$', '$$'));
  const unit = `[Unit]\nDescription=Codex Desk private Tailscale endpoint\nAfter=network.target\n\n[Service]\nExecStart=${quote(path.join(directory, 'tailscaled'))} --tun=userspace-networking --state=${quote(path.join(directory, 'tailscaled.state'))} --socket=${quote(path.join(directory, 'tailscaled.sock'))}\nRestart=on-failure\nRestartSec=5\nUMask=0077\n\n[Install]\nWantedBy=default.target\n`;
  await writeFile(path.join(unitDirectory, 'codex-desk-tailscale.service'), unit, { mode: 0o600 });
  signal.throwIfAborted();
  update({ stage: 'starting' });
  await run('systemctl', ['--user', 'daemon-reload'], { signal });
  await run('systemctl', ['--user', 'enable', '--now', 'codex-desk-tailscale.service'], { signal });
}
