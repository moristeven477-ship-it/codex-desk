import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

const directory = await mkdtemp(path.join(tmpdir(), 'codex-desk-native-'));
const project = path.join(directory, 'atlas-workspace');
await mkdir(project);
await writeFile(path.join(project, 'README.md'), '# Atlas\nSynthetic desktop smoke-test workspace.\n');
const binary = path.resolve('tests/fixtures/fake-codex.mjs');
await chmod(binary, 0o755);
await writeFile(
  path.join(directory, 'state.json'),
  JSON.stringify({
    projects: [{ id: 'atlas', name: 'atlas-workspace', path: project, createdAt: Date.now() }],
    settings: {
      locale: 'en',
      theme: 'dark',
      binaryPath: binary,
      codexHome: '',
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
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByText('Codex connected', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What shall we build today?' })).toBeVisible();
  const preferences = await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  );
  if (preferences.nodeIntegration || !preferences.contextIsolation || !preferences.sandbox)
    throw new Error('Unsafe renderer preferences');
  await page.getByRole('textbox', { name: 'Message Codex' }).fill('Native IPC smoke test');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.markdown')).toContainText('Your local Codex conversation is working.');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/native-ubuntu.png', animations: 'disabled' });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    JSON.stringify({
      native: 'passed',
      transport: 'Electron IPC + Codex subprocess',
      rendererSandbox: preferences.sandbox,
      chromiumSandboxDisabledForTest: process.env.DESK_TEST_NO_SANDBOX === '1',
    }),
  );
} finally {
  if (desktop) await desktop.close();
  await rm(directory, { recursive: true, force: true });
}
