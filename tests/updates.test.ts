import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AppUpdater, latestReleaseURL, releaseRepository, selectRelease } from '../electron/app-update';
import { ownedSharedListener, stopOwnedSharedListener, startSharedListener } from '../electron/shared-server';
import { DeskService } from '../electron/service';
import { newerVersion, serverVersion } from '../src/shared/versions';
import type { Bootstrap } from '../src/shared/types';

test('version comparison is numeric, rejects previews and reads the actual initialized runtime', () => {
  assert.ok(newerVersion('codex-cli 0.159.2', 'codex-cli 0.154.0'));
  assert.ok(newerVersion('v0.10.0', '0.9.9'));
  assert.equal(newerVersion('0.159.2-alpha.1', '0.154.0'), false);
  assert.equal(newerVersion('0.154.0', '0.159.2'), false);
  assert.equal(
    serverVersion('codex_desk/0.154.0 (Ubuntu 24.4.0; x86_64) unknown (codex_desk; 0.7.0)'),
    '0.154.0',
  );
});

const bytes = Buffer.from('\x7fELF\0\0\0\0AI\x02\0' + 'synthetic AppImage '.repeat(100));
const digest = createHash('sha256').update(bytes).digest('hex');
function release(version = '1.1.0') {
  const name = `codex-desk-${version}-x86_64.AppImage`;
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    assets: [
      {
        name,
        size: bytes.length,
        digest: `sha256:${digest}`,
        browser_download_url: `https://github.com/${releaseRepository}/releases/download/v${version}/${name}`,
      },
    ],
  };
}
async function updaterFixture(options: { data?: unknown; download?: Buffer; redirect?: string } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'desk-updater-'));
  const image = path.join(root, 'Desk.AppImage');
  await writeFile(image, 'previous installation', { mode: 0o755 });
  const events: string[] = [];
  let idle = false;
  const updater = new AppUpdater({
    currentVersion: '1.0.0',
    appImage: image,
    architecture: 'x64',
    fetcher: (async (url) => {
      if (String(url) === latestReleaseURL) return new Response(JSON.stringify(options.data ?? release()));
      if (options.redirect)
        return new Response(null, { status: 302, headers: { location: options.redirect } });
      return new Response(new Uint8Array(options.download ?? bytes));
    }) as typeof fetch,
    idle: async () => idle,
    relaunch: (file) => events.push(file),
  });
  return {
    root,
    image,
    updater,
    events,
    setIdle: () => {
      idle = true;
    },
    close: async () => {
      await updater.dispose();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('automatic AppImage update verifies, waits for idle, atomically installs and retains the previous version', async () => {
  const f = await updaterFixture();
  try {
    await Promise.all([f.updater.check(), f.updater.check()]);
    assert.equal(f.updater.state.phase, 'ready');
    assert.equal(await f.updater.apply(), false);
    assert.equal(await readFile(f.image, 'utf8'), 'previous installation');
    f.setIdle();
    assert.deepEqual(await Promise.all([f.updater.apply(), f.updater.apply()]), [true, true]);
    assert.deepEqual(await readFile(f.image), bytes);
    assert.equal(await readFile(`${f.image}.previous`, 'utf8'), 'previous installation');
    assert.equal((await stat(f.image)).mode & 0o777, 0o755);
    assert.deepEqual(f.events, [f.image]);
  } finally {
    await f.close();
  }
});

test('corrupt, truncated and redirected downloads leave the installed executable unchanged', async () => {
  for (const options of [
    { download: Buffer.alloc(bytes.length) },
    { download: bytes.subarray(0, 20) },
    { redirect: 'http://github.com/untrusted' },
    { redirect: 'https://unrelated.example/update' },
  ]) {
    const f = await updaterFixture(options);
    try {
      await f.updater.check();
      f.setIdle();
      assert.equal(f.updater.state.phase, 'error');
      assert.equal(await f.updater.apply(), false);
      assert.equal(await readFile(f.image, 'utf8'), 'previous installation');
      assert.deepEqual(await readdir(f.root), ['Desk.AppImage']);
    } finally {
      await f.close();
    }
  }
});

test('release selection refuses downgrades, previews, wrong repositories and unverified assets', () => {
  assert.equal(selectRelease(release('0.9.0'), '1.0.0', 'x64'), null);
  assert.equal(selectRelease({ ...release(), prerelease: true }, '1.0.0', 'x64'), null);
  assert.equal(selectRelease({ ...release(), draft: true }, '1.0.0', 'x64'), null);
  const wrong = release();
  wrong.assets[0].browser_download_url = 'https://github.com/someone/else/file';
  assert.throws(() => selectRelease(wrong, '1.0.0', 'x64'), /verified/);
  const missing = release();
  missing.assets[0].digest = '';
  assert.throws(() => selectRelease(missing, '1.0.0', 'x64'), /verified/);
});

test('a manual installation or staged-file change cancels replacement', async () => {
  for (const tamper of ['installed', 'staged']) {
    const f = await updaterFixture();
    try {
      await f.updater.check();
      const file =
        tamper === 'installed'
          ? f.image
          : path.join(
              f.root,
              (await readdir(f.root)).find((x) => x.startsWith('.codex-desk-update-'))!,
            );
      await writeFile(file, 'manual change');
      f.setIdle();
      assert.equal(await f.updater.apply(), false);
      assert.equal(f.updater.state.phase, 'error');
      assert.equal(
        await readFile(f.image, 'utf8'),
        tamper === 'installed' ? 'manual change' : 'previous installation',
      );
      assert.deepEqual(f.events, []);
    } finally {
      await f.close();
    }
  }
});

async function runtimeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'desk-runtime-update-'));
  const home = path.join(root, 'home');
  await mkdir(home);
  const binary = path.resolve('tests/fixtures/update-codex.mjs');
  await chmod(binary, 0o755);
  const writeThreads = (second: string, goal: string | null = null) =>
    writeFile(
      path.join(home, 'threads.json'),
      JSON.stringify({
        pageSize: 1,
        threads: [
          { id: 'first', status: { type: 'idle' } },
          { id: 'other-cli', status: { type: second }, goal: goal ? { status: goal } : null },
        ],
      }),
    );
  await writeThreads('idle');
  await writeFile(path.join(home, 'installed-version'), '1.0.0');
  const socket = path.join(home, 'app-server-control/app-server-control.sock');
  await startSharedListener(binary, { ...process.env, CODEX_HOME: home }, socket);
  const service = new DeskService(path.join(root, 'desk'));
  await service.init();
  await service.handle('settings.update', { binaryPath: binary, codexHome: home });
  await service.connect();
  return {
    root,
    home,
    socket,
    service,
    writeThreads,
    upgrade: () => writeFile(path.join(home, 'installed-version'), '1.1.0'),
    close: async () => {
      await service.codex.stop();
      const owned = await ownedSharedListener(socket);
      if (owned) await stopOwnedSharedListener(socket, owned);
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('runtime upgrade waits for other CLI turns and goals, then refreshes version and models exactly once', async () => {
  const f = await runtimeFixture();
  try {
    const original = await ownedSharedListener(f.socket);
    await f.service.codex.request('thread/resume', {
      threadId: 'first',
      model: 'chosen-model',
      approvalPolicy: 'never',
      serviceTier: 'fast',
    });
    await f.service.codex.request('thread/settings/update', {
      threadId: 'first',
      effort: 'high',
      sandboxPolicy: { type: 'workspaceWrite', writableRoots: [f.root], networkAccess: false },
    });
    await f.upgrade();
    await f.writeThreads('active');
    await f.service.maintain();
    assert.equal(f.service.codex.connection.version, 'codex-cli 1.0.0');
    assert.equal(f.service.codex.connection.installedVersion, 'codex-cli 1.1.0');
    assert.equal(f.service.codex.connection.updatePending, 'busy');
    assert.deepEqual(await ownedSharedListener(f.socket), original);
    await f.writeThreads('idle', 'active');
    await f.service.maintain();
    assert.deepEqual(await ownedSharedListener(f.socket), original);
    await f.writeThreads('idle', 'paused');
    await Promise.all([f.service.maintain(), f.service.maintain()]);
    const boot = (await f.service.handle('bootstrap')) as Bootstrap;
    assert.equal(boot.connection.version, 'codex-cli 1.1.0');
    assert.equal(boot.models[0].model, 'model-1.1.0');
    const settings = await f.service.codex.request<Record<string, unknown>>('thread/resume', {
      threadId: 'first',
    });
    assert.equal(settings.model, 'chosen-model');
    assert.equal(settings.approvalPolicy, 'never');
    assert.equal(settings.serviceTier, 'fast');
    assert.equal(settings.reasoningEffort, 'high');
    assert.deepEqual(settings.sandbox, {
      type: 'workspaceWrite',
      writableRoots: [f.root],
      networkAccess: false,
    });
    assert.notEqual((await ownedSharedListener(f.socket))?.pid, original?.pid);
    assert.equal(await readFile(path.join(f.home, 'stopped.log'), 'utf8'), '1.0.0\n');
  } finally {
    await f.close();
  }
});

test('disabling automatic updates leaves an idle old runtime running', async () => {
  const f = await runtimeFixture();
  try {
    const original = await ownedSharedListener(f.socket);
    await f.upgrade();
    await f.service.handle('settings.update', { autoUpdate: false });
    await f.service.maintain();
    assert.deepEqual(await ownedSharedListener(f.socket), original);
    assert.equal(f.service.codex.connection.version, 'codex-cli 1.0.0');
  } finally {
    await f.close();
  }
});

test('cancelled downloads remove partial files and keep the previous installation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'desk-update-cancel-'));
  const image = path.join(root, 'Desk.AppImage');
  await writeFile(image, 'previous installation');
  let downloading!: () => void;
  const started = new Promise<void>((resolve) => {
    downloading = resolve;
  });
  const updater = new AppUpdater({
    currentVersion: '1.0.0',
    appImage: image,
    idle: async () => true,
    relaunch: () => assert.fail('Cancelled update relaunched'),
    fetcher: (async (url, options) => {
      if (String(url) === latestReleaseURL) return new Response(JSON.stringify(release()));
      downloading();
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(bytes.subarray(0, 20)));
            options!.signal!.addEventListener('abort', () => controller.error(new Error('cancelled')), {
              once: true,
            });
          },
        }),
      );
    }) as typeof fetch,
  });
  try {
    const checking = updater.check();
    await started;
    await updater.dispose();
    await checking;
    assert.equal(await readFile(image, 'utf8'), 'previous installation');
    assert.deepEqual(await readdir(root), ['Desk.AppImage']);
  } finally {
    await updater.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('startup upgrades an idle Desk backend; a stale PID identity is never terminated', async () => {
  const f = await runtimeFixture();
  const pidFile = path.join(path.dirname(f.socket), 'codex-desk-server.json');
  const original = await readFile(pidFile, 'utf8');
  try {
    await f.upgrade();
    await writeFile(pidFile, JSON.stringify({ ...JSON.parse(original), startTime: 'invalid' }));
    await f.service.maintain();
    assert.equal(f.service.codex.connection.version, 'codex-cli 1.0.0');
    assert.equal(f.service.codex.connection.updatePending, 'external');
    await writeFile(pidFile, original);
    await f.service.codex.stop();
    await f.service.connect();
    assert.equal(f.service.codex.connection.version, 'codex-cli 1.1.0');
  } finally {
    await f.close();
  }
});
