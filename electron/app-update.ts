import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import {
  access,
  chmod,
  copyFile,
  lstat,
  open,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import { newerVersion, stableVersion } from '../src/shared/versions';
import type { UpdateState } from '../src/shared/updates';

export const releaseRepository = 'moristeven477-ship-it/codex-desk';
export const latestReleaseURL = `https://api.github.com/repos/${releaseRepository}/releases/latest`;
const maxAssetSize = 512 * 1024 * 1024;
export interface ReleaseAsset {
  version: string;
  name: string;
  url: string;
  size: number;
  checksum: string;
}

export function selectRelease(value: unknown, current: string, architecture: string): ReleaseAsset | null {
  const release = value as Record<string, unknown>;
  if (!release || typeof release !== 'object' || release.draft || release.prerelease) return null;
  const version = stableVersion(release.tag_name);
  if (!version || !newerVersion(version, current)) return null;
  const arch = architecture === 'x64' ? 'x86_64' : architecture === 'arm64' ? 'arm64' : undefined;
  if (!arch) throw new Error('Automatic updates are unavailable on this architecture.');
  const name = `codex-desk-${version}-${arch}.AppImage`;
  const asset = (Array.isArray(release.assets) ? release.assets : []).find((a) => a?.name === name);
  const url = `https://github.com/${releaseRepository}/releases/download/v${version}/${name}`;
  if (
    !asset ||
    asset.browser_download_url !== url ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '') ||
    !Number.isSafeInteger(asset.size) ||
    asset.size < 16 ||
    asset.size > maxAssetSize
  )
    throw new Error('This release does not contain a verified AppImage. / 此版本缺少可验证的 AppImage。');
  return { version, name, url, size: asset.size, checksum: asset.digest.slice(7) };
}

// extract-and-run can omit APPIMAGE. Its parent runtime still identifies the
// actual installed file; never overwrite a file inside the temporary extraction.
export async function findAppImage(env = process.env, parent = process.ppid): Promise<string | undefined> {
  let candidate = env.APPIMAGE;
  for (let attempt = 0; !candidate && parent > 1 && attempt < 4; attempt++) {
    try {
      const exe = await readlink(`/proc/${parent}/exe`);
      if (exe.endsWith('.AppImage')) candidate = exe;
      else {
        const status = await readFile(`/proc/${parent}/status`, 'utf8');
        parent = Number(/^PPid:\s+(\d+)/m.exec(status)?.[1] ?? 0);
      }
    } catch {
      break;
    }
  }
  if (!candidate || !path.isAbsolute(candidate) || !candidate.endsWith('.AppImage')) return;
  try {
    const file = await realpath(candidate);
    const metadata = await lstat(file);
    if (!metadata.isFile() || metadata.uid !== process.getuid?.()) return;
    await access(file, constants.W_OK);
    await access(path.dirname(file), constants.W_OK);
    return file;
  } catch {
    return;
  }
}

type Fetch = typeof fetch;
async function githubFetch(url: string, signal: AbortSignal, fetcher: Fetch): Promise<Response> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const target = new URL(url);
    if (
      target.protocol !== 'https:' ||
      target.username ||
      target.password ||
      ![
        'github.com',
        'api.github.com',
        'release-assets.githubusercontent.com',
        'objects.githubusercontent.com',
      ].includes(target.hostname)
    )
      throw new Error('Unexpected release download address.');
    const response = await fetcher(url, {
      signal,
      redirect: 'manual',
      headers: { 'User-Agent': 'Codex-Desk-Updater', Accept: 'application/vnd.github+json' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('Release download redirect is missing its address.');
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`Release download: HTTP ${response.status}`);
    return response;
  }
  throw new Error('Too many release download redirects.');
}

async function checksum(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export class AppUpdater {
  state: UpdateState;
  private checking?: Promise<UpdateState>;
  private applying?: Promise<boolean>;
  private controller = new AbortController();
  private staged?: { file: string; asset: ReleaseAsset; originalHash: string };

  constructor(
    private options: {
      currentVersion: string;
      appImage?: string;
      architecture?: string;
      fetcher?: Fetch;
      idle: () => Promise<boolean>;
      relaunch: (image: string) => void;
      changed?: (state: UpdateState) => void;
    },
  ) {
    this.state = { phase: options.appImage ? 'idle' : 'unsupported' };
  }
  private update(state: UpdateState) {
    this.state = state;
    this.options.changed?.(state);
  }
  check(): Promise<UpdateState> {
    if (!this.options.appImage || this.staged || this.controller.signal.aborted)
      return Promise.resolve(this.state);
    this.checking ??= this.download().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }
  private async download(): Promise<UpdateState> {
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(10 * 60_000)]);
    const fetcher = this.options.fetcher ?? fetch;
    let staging: string | undefined;
    this.update({ phase: 'checking' });
    try {
      const response = await githubFetch(latestReleaseURL, signal, fetcher);
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) throw new Error('Release metadata exceeded its size limit.');
        chunks.push(chunk);
      }
      const asset = selectRelease(
        JSON.parse(Buffer.concat(chunks).toString()),
        this.options.currentVersion,
        this.options.architecture ?? process.arch,
      );
      const checkedAt = Date.now();
      if (!asset) {
        this.update({ phase: 'current', checkedAt });
        return this.state;
      }
      const originalHash = await checksum(this.options.appImage!);
      staging = path.join(
        path.dirname(this.options.appImage!),
        `.codex-desk-update-${randomUUID()}.AppImage`,
      );
      const output = await open(staging, 'wx', 0o600);
      this.update({ phase: 'downloading', version: asset.version, progress: 0, checkedAt });
      let received = 0;
      const hash = createHash('sha256');
      try {
        const download = await githubFetch(asset.url, signal, fetcher);
        for await (const chunk of download.body as unknown as AsyncIterable<Uint8Array>) {
          signal.throwIfAborted();
          received += chunk.length;
          if (received > asset.size) throw new Error('Update download exceeded its declared size.');
          hash.update(chunk);
          await output.writeFile(chunk);
          const progress = Math.floor((received * 100) / asset.size);
          if (progress !== this.state.progress) this.update({ ...this.state, progress });
        }
        await output.sync();
      } finally {
        await output.close();
      }
      if (received !== asset.size || hash.digest('hex') !== asset.checksum)
        throw new Error('Update checksum verification failed. / 更新包校验失败。');
      signal.throwIfAborted();
      this.staged = { file: staging, asset, originalHash };
      staging = undefined;
      this.update({ phase: 'ready', version: asset.version, checkedAt });
    } catch (error) {
      if (!this.controller.signal.aborted)
        this.update({ phase: 'error', error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (staging) await rm(staging, { force: true });
    }
    return this.state;
  }
  apply(): Promise<boolean> {
    this.applying ??= this.install().finally(() => {
      this.applying = undefined;
    });
    return this.applying;
  }
  private async install(): Promise<boolean> {
    const staged = this.staged;
    const image = this.options.appImage;
    if (!staged || !image || this.controller.signal.aborted || !(await this.options.idle())) return false;
    try {
      this.controller.signal.throwIfAborted();
      // A different app instance or a manual installer may have changed the
      // target while the update was downloading. Do not overwrite that install.
      if (
        (await checksum(image)) !== staged.originalHash ||
        (await checksum(staged.file)) !== staged.asset.checksum
      )
        throw new Error('The installation changed during the update. / 更新期间安装文件已变化。');
      if (!(await this.options.idle())) return false;
      this.controller.signal.throwIfAborted();
      this.update({ ...this.state, phase: 'installing' });
      await chmod(staged.file, 0o755);
      const backup = `${image}.previous`;
      const temporaryBackup = `${backup}.${randomUUID()}`;
      try {
        await copyFile(image, temporaryBackup, constants.COPYFILE_EXCL);
        await rename(temporaryBackup, backup);
      } finally {
        await rm(temporaryBackup, { force: true });
      }
      this.controller.signal.throwIfAborted();
      await rename(staged.file, image);
      this.staged = undefined;
      try {
        this.options.relaunch(image);
      } catch (error) {
        await copyFile(backup, image);
        throw error;
      }
      return true;
    } catch (error) {
      this.update({ phase: 'error', error: error instanceof Error ? error.message : String(error) });
      this.staged = undefined;
      await rm(staged.file, { force: true });
      return false;
    }
  }
  async dispose() {
    this.controller.abort();
    await this.checking;
    await this.applying;
    if (this.staged) await rm(this.staged.file, { force: true });
    this.staged = undefined;
  }
}
