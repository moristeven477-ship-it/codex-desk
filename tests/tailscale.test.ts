import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  TailscaleSetup,
  createTailscaleDriver,
  checkDeskServe,
  tailscaleActionURL,
  runTailscaleCommand,
  type TailscaleDriver,
  type TailscaleNode,
} from '../electron/tailscale';
import { installManagedTailscale, type Run } from '../electron/tailscale-install';
const running: TailscaleNode = {
  state: 'Running',
  dns: 'desk.tailtest.ts.net',
  url: 'https://desk.tailtest.ts.net:8443',
};
const login: TailscaleNode = {
  state: 'NeedsLogin',
  dns: '',
  url: '',
  authUrl: 'https://login.tailscale.com/a/synthetic',
};
const signal = () => new AbortController().signal;
const route = {
  TCP: { '8443': { HTTPS: true } },
  Web: { 'desk.tailtest.ts.net:8443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:43125' } } } },
};
async function until(condition: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await delay(10);
  }
  assert.ok(condition(), 'Expected setup transition');
}
function fixture() {
  const state = {
    managed: null as TailscaleNode | null,
    system: null as TailscaleNode | null,
    installs: 0,
    connects: 0,
    serves: [] as string[],
    https: false,
    denied: false,
  };
  const driver: TailscaleDriver = {
    async status(source) {
      return state[source];
    },
    async install(_signal, update) {
      state.installs++;
      update({ stage: 'downloading', progress: 50 });
      state.managed = login;
    },
    async connect(_signal, action) {
      state.connects++;
      action(login.authUrl!);
    },
    async serve(source, _node, _port, _signal, action) {
      state.serves.push(source);
      if (source === 'system' && state.denied) throw new Error('Access denied: use sudo');
      if (!state.https) action('https://login.tailscale.com/f/serve?node=synthetic');
      return state.https;
    },
    async wait(signal) {
      await delay(10, undefined, { signal });
    },
  };
  return { state, driver, setup: new TailscaleSetup(driver) };
}

test('setup installs once, exposes login/HTTPS actions, and continues automatically to a verified address', async () => {
  const f = fixture(),
    origins: string[] = [];
  const start = () =>
    f.setup.start(43125, '', async (url) => {
      origins.push(url);
    });
  assert.equal(start().stage, 'checking');
  start();
  await until(() => f.setup.state.stage === 'login');
  assert.equal(f.setup.state.actionUrl, login.authUrl);
  assert.equal(f.state.installs, 1);
  assert.equal(f.state.connects, 1);
  f.state.managed = running;
  await until(() => f.setup.state.stage === 'https');
  assert.equal(origins.length, 0);
  assert.match(f.setup.state.actionUrl!, /login\.tailscale\.com\/f\/serve/);
  f.state.https = true;
  await until(() => !f.setup.state.active);
  assert.equal(f.setup.state.stage, 'ready');
  assert.equal(f.setup.state.actionUrl, undefined);
  assert.deepEqual(origins, [running.url]);
});

test('existing system login is reused without changing its preferences; permission failures use a private endpoint', async () => {
  const f = fixture();
  f.state.system = running;
  f.state.https = true;
  f.setup.start(43125, running.url, async () => {});
  await until(() => !f.setup.state.active);
  assert.equal(f.state.installs, 0);
  assert.equal(f.state.connects, 0);
  assert.equal(f.setup.state.source, 'system');
  f.state.denied = true;
  f.setup.start(43125, running.url, async () => {});
  await until(() => f.setup.state.stage === 'login');
  assert.equal(f.setup.state.source, 'managed');
  assert.equal(f.state.installs, 1);
  f.state.managed = running;
  await until(() => !f.setup.state.active);
  assert.equal(f.setup.state.stage, 'ready');
  assert.equal(f.state.system, running);
});

test('cancel ends pending setup without publishing an address; retry reuses the installed connection', async () => {
  const f = fixture();
  let ready = 0;
  f.setup.start(43125, '', async () => {
    ready++;
  });
  await until(() => f.setup.state.stage === 'login');
  await f.setup.cancel();
  f.state.managed = running;
  f.state.https = true;
  await delay(30);
  assert.equal(ready, 0);
  assert.equal(f.setup.state.stage, 'idle');
  f.setup.start(43125, '', async () => {
    ready++;
  });
  await until(() => !f.setup.state.active);
  assert.equal(ready, 1);
  assert.equal(f.state.installs, 1);
});

test('machine approval and setup failures are visible and retryable without retaining authorization links in errors', async () => {
  const f = fixture();
  f.state.managed = { ...login, state: 'NeedsMachineAuth' };
  f.setup.start(43125, '', async () => {});
  await until(() => f.setup.state.stage === 'approval');
  assert.equal(f.setup.state.actionUrl, 'https://login.tailscale.com/admin/machines');
  await f.setup.cancel();
  f.state.managed = null;
  f.driver.install = async () => {
    throw new Error('Download failed https://login.tailscale.com/a/private');
  };
  f.setup.start(43125, '', async () => {});
  await until(() => !f.setup.state.active);
  assert.equal(f.setup.state.stage, 'error');
  assert.doesNotMatch(f.setup.state.error!, /private/);
  f.state.managed = running;
  f.state.https = true;
  f.setup.start(43125, '', async () => {});
  await until(() => !f.setup.state.active);
  assert.equal(f.setup.state.stage, 'ready');
});

test('Serve requires the actual HTTPS route, preserves unrelated services, and never accepts Funnel', () => {
  assert.equal(checkDeskServe({}, running.dns, 43125), false);
  assert.equal(checkDeskServe(route, running.dns, 43125), true);
  assert.throws(() => checkDeskServe(route, running.dns, 43126), /another service/);
  assert.throws(() =>
    checkDeskServe({ ...route, AllowFunnel: { 'other.tailtest.ts.net:8443': true } }, running.dns, 43125),
  );
  assert.throws(() => checkDeskServe({ TCP: { '8443': {} } }, running.dns, 43125));
  assert.throws(() =>
    checkDeskServe({ Web: { 'other.tailtest.ts.net:8443': { Handlers: {} } } }, running.dns, 43125),
  );
  assert.equal(
    checkDeskServe({ ...route, TCP: { ...route.TCP, '443': { HTTPS: true } } }, running.dns, 43125),
    true,
  );
});

test('driver recognizes split HTTPS activation output and does not mistake exit 0 for configured Serve', async () => {
  let enabled = false,
    calls = 0;
  const run: Run = async (file, args, options) => {
    assert.equal(file, 'tailscale');
    assert.ok(!args.includes('reset') && !args.includes('funnel') && !args.includes('up'));
    if (args.includes('status')) return JSON.stringify(enabled ? route : {});
    calls++;
    options.output?.('Enable HTTPS: https://login.tail');
    options.output?.('scale.com/f/serve?node=test\n');
    return '';
  };
  const driver = createTailscaleDriver('/tmp/unused', run);
  const links: string[] = [];
  assert.equal(await driver.serve('system', running, 43125, signal(), (url) => links.push(url)), false);
  assert.deepEqual(links, ['https://login.tailscale.com/f/serve?node=test']);
  enabled = true;
  assert.equal(await driver.serve('system', running, 43125, signal(), () => {}), true);
  assert.equal(calls, 1);
  for (const url of [
    'http://login.tailscale.com/a/test',
    'https://login.tailscale.com.evil/a/test',
    'file:///etc/passwd',
    'https://x@login.tailscale.com/a/test',
    'https://login.tailscale.com:99/a/test',
  ])
    assert.equal(tailscaleActionURL(url), undefined);
});

test('managed installer rejects tampering before executing, checks cached archives, and installs with private modes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'desk-install-'));
  const home = path.join(root, 'home %u with spaces');
  const commands: [string, string[]][] = [];
  const stages: string[] = [];
  try {
    const source = path.join(root, 'test-tailscale');
    await mkdir(source);
    await writeFile(path.join(source, 'tailscale'), 'fake cli');
    await writeFile(path.join(source, 'tailscaled'), 'fake daemon');
    const archive = path.join(root, 'fixture.tgz');
    await runTailscaleCommand('tar', ['-czf', archive, '-C', root, 'test-tailscale'], { signal: signal() });
    const bytes = await readFile(archive);
    const artifact = {
      version: 'fixture',
      directory: 'test-tailscale',
      checksum: createHash('sha256').update(bytes).digest('hex'),
      url: 'https://example.invalid/fixture',
    };
    const run: Run = async (file, args, options) => {
      commands.push([file, args]);
      if (file === 'tar') return runTailscaleCommand(file, args, options);
      assert.equal(file, 'systemctl');
      assert.equal(args[0], '--user');
      return '';
    };
    const options = {
      home,
      run,
      artifact,
      signal: signal(),
      update: (state: { stage?: string }) => {
        if (state.stage) stages.push(state.stage);
      },
    };
    await assert.rejects(
      installManagedTailscale({ ...options, download: async () => Buffer.from('tampered') }),
      /verification failed/,
    );
    assert.equal(commands.length, 0);
    await installManagedTailscale({ ...options, download: async () => bytes });
    const directory = path.join(home, '.local/share/codex-desk/tailscale');
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal((await stat(path.join(directory, 'tailscale'))).mode & 0o777, 0o755);
    assert.equal((await stat(path.join(directory, 'tailscale.tgz'))).mode & 0o777, 0o600);
    assert.equal(await readFile(path.join(directory, 'tailscaled'), 'utf8'), 'fake daemon');
    const unit = await readFile(path.join(home, '.config/systemd/user/codex-desk-tailscale.service'), 'utf8');
    assert.match(unit, /home %%u with spaces/);
    assert.match(unit, /--tun=userspace-networking/);
    assert.match(unit, /UMask=0077/);
    await installManagedTailscale({
      ...options,
      download: async () => {
        throw Error('Cache should be reused');
      },
    });
    await writeFile(path.join(directory, 'tailscale.tgz'), 'corrupted cache');
    let downloads = 0;
    await installManagedTailscale({
      ...options,
      download: async () => {
        downloads++;
        return bytes;
      },
    });
    assert.equal(downloads, 1);
    assert.ok(stages.includes('downloading') && stages.includes('installing') && stages.includes('starting'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
