import { _electron as electron, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdtemp, mkdir, copyFile, chmod, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { sharedFixture } from '../tests/fixtures/shared-server.mjs';

// Run under an isolated X display and D-Bus session. Never use a real Codex home.
const root = await mkdtemp(path.join(tmpdir(), 'desk-native-update-'));
const data = path.join(root, 'data');
await mkdir(data);
const source = path.resolve(process.argv[2] || 'release/codex-desk-0.7.1-x86_64.AppImage');
const image = path.join(root, 'Desk.AppImage');
await copyFile(source, image);
await chmod(image, 0o755);
const shared = await sharedFixture(root, root);
await writeFile(
  path.join(data, 'state.json'),
  JSON.stringify({
    settings: {
      binaryPath: path.resolve('tests/fixtures/fake-codex.mjs'),
      codexHome: shared.home,
      locale: 'en',
      lastThreadId: 'fixture-history',
      defaultWorkspace: root,
    },
  }),
);
let desktop;
let stderr = '';
const download = createServer((_request, response) => {
  response.setHeader('Content-Type', 'application/octet-stream');
  createReadStream(source).pipe(response);
});
await new Promise((resolve) => download.listen(0, '127.0.0.1', resolve));
const processes = async () => {
  const result = [];
  for (const pid of await readdir('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const args = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
      if (args[0] === image) result.push(Number(pid));
    } catch {
      /* process exited */
    }
  }
  return result;
};
try {
  desktop = await electron.launch({
    executablePath: image,
    timeout: 30_000,
    env: {
      ...process.env,
      APPIMAGE_EXTRACT_AND_RUN: '1',
      CODEX_DESK_USER_DATA: data,
      CODEX_DESK_REMOTE_PORT: '0',
      CODEX_DESK_FIXTURE_ROOT: root,
    },
  });
  desktop.process().stderr?.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-6000);
  });
  const page = await desktop.firstWindow();
  await expect(page.getByText('Codex connected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Automatic updates' })).toBeChecked();
  const state = await page.evaluate(() => window.codexDesk.request('updates.status'));
  if (state.phase === 'unsupported') throw new Error('Extract-and-run AppImage was not detected.');
  const before = await processes();
  if (!before.length) throw new Error('Test AppImage runtime was not found.');
  const bytes = await readFile(source);
  const nextVersion = '99.0.0';
  const asset = `codex-desk-${nextVersion}-x86_64.AppImage`;
  await desktop.evaluate(
    ({ powerMonitor }, options) => {
      powerMonitor.getSystemIdleTime = () => 120;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url) => {
        if (String(url).endsWith('/releases/latest')) return new Response(JSON.stringify(options.release));
        return originalFetch(options.download);
      };
    },
    {
      download: `http://127.0.0.1:${download.address().port}/asset`,
      release: {
        tag_name: `v${nextVersion}`,
        draft: false,
        prerelease: false,
        assets: [
          {
            name: asset,
            size: bytes.length,
            digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
            browser_download_url: `https://github.com/moristeven477-ship-it/codex-desk/releases/download/v${nextVersion}/${asset}`,
          },
        ],
      },
    },
  );
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await expect(page.locator('.update-settings [role="status"]'))
    .toContainText('99.0.0 is ready', {
      timeout: 30_000,
    })
    .catch(async (error) => {
      console.log(
        'Native update state:',
        await page.evaluate(() => window.codexDesk.request('updates.status')),
      );
      throw error;
    });
  console.log('Packaged AppImage detected, verified download staged, waiting for automatic installation.');
  // Playwright's inspector holds Node open on exit; production launches have no
  // debugger. Detach it before exercising Electron's real relaunch lifecycle.
  await desktop.evaluate(() => {
    setTimeout(() => process.getBuiltinModule('inspector').close(), 100);
  });
  let relaunched = false;
  for (let attempt = 0; attempt < 180; attempt++) {
    const current = await processes();
    if (current.length && current.every((pid) => !before.includes(pid))) {
      relaunched = true;
      break;
    }
    await delay(500);
  }
  if (!relaunched) {
    console.log('Relaunch diagnostics:', { before, current: await processes(), stderr });
    console.log(
      'Update state:',
      await page.evaluate(() => window.codexDesk.request('updates.status')).catch(String),
    );
    console.log(
      'Idle clock:',
      await desktop.evaluate(({ powerMonitor }) => powerMonitor.getSystemIdleTime()).catch(String),
    );
    throw new Error('The automatic update did not relaunch the AppImage.');
  }
  if (!(await readFile(`${image}.previous`)).equals(bytes))
    throw new Error('Previous AppImage was not retained.');
  console.log(
    'PASS: packaged AppImage automatically installed and relaunched; previous executable retained.',
  );
} finally {
  for (const pid of await processes()) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* exited */
    }
  }
  await desktop?.close().catch(() => {});
  await shared.close();
  download.closeAllConnections();
  await new Promise((resolve) => download.close(resolve));
  await delay(500);
  await rm(root, { recursive: true, force: true });
}
