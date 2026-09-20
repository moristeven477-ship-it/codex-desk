import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, chmod, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { sharedFixture } from '../tests/fixtures/shared-server.mjs';

const directory = await mkdtemp(path.join(tmpdir(), 'codex-desk-native-'));
const project = path.join(directory, 'atlas-workspace');
await mkdir(project);
await writeFile(path.join(project, 'README.md'), '# Atlas\nSynthetic desktop smoke-test workspace.\n');
const binary = path.resolve('tests/fixtures/fake-codex.mjs');
await chmod(binary, 0o755);
const shared = await sharedFixture(directory, project);
await writeFile(
  path.join(directory, 'state.json'),
  JSON.stringify({
    projects: [{ id: 'atlas', name: 'atlas-workspace', path: project, createdAt: Date.now() }],
    settings: {
      locale: 'en',
      theme: 'dark',
      binaryPath: binary,
      codexHome: shared.home,
      lastProjectId: 'atlas',
      lastThreadId: '',
    },
  }),
);
let desktop;
try {
  desktop = await electron.launch({
    executablePath: process.env.DESK_EXECUTABLE || path.resolve('release/linux-unpacked/codex-desk'),
    args: process.env.DESK_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : [],
    timeout: 20_000,
    env: { ...process.env, CODEX_DESK_USER_DATA: directory, CODEX_DESK_FIXTURE_ROOT: project },
  });
  const page = await desktop.firstWindow();
  // Capture notifications in this test process without notifying the user's desktop.
  await desktop.evaluate(({ Notification }) => {
    globalThis.__deskNotifications = [];
    Notification.isSupported = () => true;
    Notification.prototype.show = function () {
      globalThis.__deskNotifications.push(this);
    };
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByText('Codex connected', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What shall we build today?' })).toBeVisible();
  await expect(page.locator('.background-terminal-status')).toContainText('Terminal ready in background', {
    timeout: 20_000,
  });
  const nativeState = JSON.parse(
    await readFile(path.join(directory, 'terminals/native-terminals.json'), 'utf8'),
  );
  expect(Object.keys(nativeState)).toHaveLength(1);
  const firstMarkerFile = (await readdir(path.join(directory, 'terminals'))).find((name) =>
    /^terminal-.*\.json$/.test(name),
  );
  const firstMarker = JSON.parse(await readFile(path.join(directory, 'terminals', firstMarkerFile), 'utf8'));
  await page.evaluate(async () => {
    const boot = await window.codexDesk.request('bootstrap');
    await window.codexDesk.prepareTerminal(boot.settings.lastThreadId);
  });
  expect(JSON.parse(await readFile(path.join(directory, 'terminals', firstMarkerFile), 'utf8')).pid).toBe(
    firstMarker.pid,
  );
  const preferences = await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  );
  if (preferences.nodeIntegration || !preferences.contextIsolation || !preferences.sandbox)
    throw new Error('Unsafe renderer preferences');
  const composer = page.getByRole('textbox', { name: 'Message Codex' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('slider', { name: 'Font size', exact: true }).fill('17.35');
  await expect(composer).toHaveCSS('font-size', '17.35px');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await expect(composer).toHaveCSS('font-size', '17.35px');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(composer).toHaveCSS('font-size', '13px');
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAL0lEQVR4nO3OIQEAAAgDMKJSG0UUiHEzMb+a3ksqAQEBAQEBAQEBAQEBAQGBdOABxQdctdynpFgAAAAASUVORK5CYII=';
  await composer.fill('Native IPC smoke test');
  if (process.env.DESK_TEST_CLIPBOARD === '1') {
    // Run this option on an isolated Xvfb display: it changes that display's clipboard.
    await desktop.evaluate(async ({ clipboard, ClipboardItem }, png) => {
      await clipboard.write([
        new ClipboardItem({ 'image/png': new Blob([Buffer.from(png, 'base64')], { type: 'image/png' }) }),
      ]);
    }, png);
    await composer.press('Control+v');
  } else {
    await composer.evaluate((element, png) => {
      const data = new DataTransfer();
      data.items.add(
        new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], 'screenshot.png', {
          type: 'image/png',
        }),
      );
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, png);
  }
  await expect(page.locator('.image-attachments img')).toHaveCount(1);
  await expect(composer).toHaveValue('Native IPC smoke test');
  await page.getByRole('radio', { name: /YOLO/ }).check();
  await expect(page.locator('.image-attachments img')).toHaveCount(1);
  const fast = page.getByRole('button', { name: 'Fast mode', exact: true });
  await fast.click();
  await expect(fast).toHaveAttribute('aria-pressed', 'true');
  if (process.env.DESK_TEST_CLIPBOARD === '1') {
    await desktop.evaluate(async ({ clipboard }) => {
      await clipboard.writeText(' + pasted text');
    });
    await composer.press('End');
    await composer.press('Control+v');
    await expect(composer).toHaveValue('Native IPC smoke test + pasted text');
  }
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.markdown')).toContainText('Your local Codex conversation is working.');
  await expect(page.locator('.completion-toast')).toContainText('Task completed');
  await expect(fast).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: 'Permission mode', exact: true })).toContainText('YOLO');
  await page.locator('.user-message').getByRole('button', { name: 'Copy message', exact: true }).click();
  expect(await desktop.evaluate(({ clipboard }) => clipboard.readText())).toBe(
    process.env.DESK_TEST_CLIPBOARD === '1' ? 'Native IPC smoke test + pasted text' : 'Native IPC smoke test',
  );
  await page.locator('.assistant-message').getByRole('button', { name: 'Copy message', exact: true }).click();
  expect(await desktop.evaluate(({ clipboard }) => clipboard.readText())).toBe(
    'Done. Your local Codex conversation is working.',
  );
  const history = await page.evaluate(async () => {
    const boot = await window.codexDesk.request('bootstrap');
    return window.codexDesk.request('thread.read', { threadId: boot.settings.lastThreadId });
  });
  const imagePath = history.turns[0].items
    .find((item) => item.type === 'userMessage')
    .content.find((input) => input.type === 'localImage').path;
  expect(path.dirname(imagePath)).toBe(path.join(directory, 'attachments'));
  expect((await readFile(imagePath)).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect((await stat(imagePath)).mode & 0o777).toBe(0o600);
  const before = await readdir(path.join(directory, 'attachments'));
  const errorsFromImport = await page.evaluate(async (png) => {
    const good = { name: 'valid.png', bytes: Uint8Array.from(atob(png), (c) => c.charCodeAt(0)) };
    const results = [];
    for (const uploads of [
      [good, { name: 'bad.png', bytes: new Uint8Array([1, 2, 3]) }],
      Array(9).fill(good),
      [{ name: 'too-big.png', bytes: new Uint8Array(20 * 1024 * 1024 + 1) }],
      [{ name: 'path.png', path: '/etc/passwd' }],
    ]) {
      try {
        await window.codexDesk.importImages(uploads);
        results.push('unexpected success');
      } catch (error) {
        results.push(error.message);
      }
    }
    return results;
  }, png);
  expect(errorsFromImport[0]).toContain('image format');
  expect(errorsFromImport[1]).toContain('8 images');
  expect(errorsFromImport[2]).toContain('20 MiB');
  expect(errorsFromImport[3]).toContain('clipboard image');
  expect(await readdir(path.join(directory, 'attachments'))).toEqual(before);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/native-ubuntu.png', animations: 'disabled' });
  await composer.fill('wait for native steering');
  await composer.press('Enter');
  await expect(page.getByRole('button', { name: 'Steer', exact: true })).toBeVisible();
  await composer.fill('Change direction from the real desktop UI');
  await page.getByRole('button', { name: 'Steer', exact: true }).click();
  await expect(page.locator('.steer-status')).toContainText('Steer sent');
  await expect(page.locator('.user-text').last()).toHaveText('Change direction from the real desktop UI');
  const steered = await page.evaluate(async () => {
    const boot = await window.codexDesk.request('bootstrap');
    return window.codexDesk.request('thread.read', { threadId: boot.settings.lastThreadId });
  });
  expect(steered.turns).toHaveLength(2);
  expect(steered.turns[1].status).toBe('inProgress');
  expect(steered.turns[1].items.filter((item) => item.type === 'userMessage')).toHaveLength(2);
  await page.getByRole('button', { name: 'Stop task', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Message Codex' }).fill('/goal');
  await page.getByRole('textbox', { name: 'Message Codex' }).press('Enter');
  await page
    .getByRole('textbox', { name: 'Objective', exact: true })
    .fill('Deliver a polished Atlas workspace');
  await page.getByRole('button', { name: 'Start goal', exact: true }).click();
  await expect(page.locator('.goal-badge')).toContainText('Pursuing goal');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await composer.fill('/compact');
  await composer.press('Enter');
  await expect(page.locator('.compaction-status').last()).toContainText('Context compacted');
  await page.getByRole('textbox', { name: 'Message Codex' }).fill('/mcp verbose');
  await page.getByRole('textbox', { name: 'Message Codex' }).press('Enter');
  await expect(page.locator('.xterm-screen')).toContainText('CODEX_CLI_FIXTURE_READY');
  await page.getByRole('button', { name: 'Insert command' }).click();
  await page.locator('.xterm-helper-textarea').press('Enter');
  await expect(page.locator('.xterm-screen')).toContainText('CLI executed: /mcp verbose');
  await page.screenshot({ path: 'test-results/native-cli-terminal.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await composer.fill('Notify when this background task completes');
  const previousNotices = await desktop.evaluate(() => globalThis.__deskNotifications.length);
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  await page.evaluate(() => document.querySelector('.send-button').click());
  await expect
    .poll(() => desktop.evaluate(() => globalThis.__deskNotifications.length))
    .toBe(previousNotices + 1);
  const nativeNotice = await desktop.evaluate(() => {
    const notice = globalThis.__deskNotifications.at(-1);
    const title = notice.title;
    notice.emit('click');
    return title;
  });
  expect(nativeNotice).toContain('Task completed');
  await expect(page.locator('.conversation-breadcrumb')).not.toContainText('New conversation');
  expect(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(
    true,
  );
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    JSON.stringify({
      native: 'passed',
      transport: 'Electron IPC + shared Unix WebSocket',
      embeddedCliPty: 'passed',
      backgroundTerminal: 'native GNOME tab, same PID reused',
      goals: 'passed',
      images: 'paste, validated IPC, private PNG, localImage send, failed batch cleanup',
      clipboard:
        process.env.DESK_TEST_CLIPBOARD === '1'
          ? 'real Ctrl+V image and text on isolated display'
          : 'synthetic paste event',
      yoloStartup: 'passed',
      messageCopy: 'user and assistant text verified against native clipboard',
      fontSize: 'live preview, persistence after reload and reset',
      steer: 'running turn accepts a second user message through native IPC',
      compaction: 'official lifecycle events through native IPC',
      completionNotices: 'in-app toast + captured native notification click',
      rendererSandbox: preferences.sandbox,
      chromiumSandboxDisabledForTest: process.env.DESK_TEST_NO_SANDBOX === '1',
    }),
  );
} catch (error) {
  if (desktop) {
    const page = await desktop.firstWindow();
    console.error('Native UI errors:', await page.locator('.error-banner').allTextContents());
    await page.screenshot({ path: '/tmp/codex-desk-native-failure.png' }).catch(() => {});
  }
  throw error;
} finally {
  if (desktop) await desktop.close();
  // Only terminate synthetic CLI processes recorded in this test's private data.
  for (const name of await readdir(path.join(directory, 'terminals')).catch(() => [])) {
    if (!/^terminal-.*\.json$/.test(name)) continue;
    const marker = JSON.parse(await readFile(path.join(directory, 'terminals', name), 'utf8'));
    const processStat = await readFile(`/proc/${marker.pid}/stat`, 'utf8').catch(() => '');
    if (
      processStat
        .slice(processStat.lastIndexOf(')') + 1)
        .trim()
        .split(/\s+/)[19] === marker.start
    ) {
      console.log(JSON.stringify({ backgroundCliSurvivedDeskClose: true }));
      process.kill(marker.pid, 'SIGTERM');
    }
  }
  await shared.close();
  await rm(directory, { recursive: true, force: true });
}
