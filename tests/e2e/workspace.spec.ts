import { test as base, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DeskService } from '../../electron/service';
import { CodexProcess } from '../../electron/codex';
// @ts-expect-error The fixture is also used by native JavaScript smoke checks.
import { sharedFixture } from '../fixtures/shared-server.mjs';
import type { CodexEvent, JsonObject, Thread, ImageAttachment } from '../../src/shared/types';
import { slashCommands } from '../../src/shared/commands';

const test = base.extend<{ setup: DeskService }>({
  setup: [
    async ({ page }, use) => {
      const root = await mkdtemp(path.join(tmpdir(), 'desk-e2e-'));
      const project = path.join(root, 'atlas-workspace');
      await mkdir(path.join(project, 'src'), { recursive: true });
      await writeFile(path.join(project, 'README.md'), '# Atlas\nA thoughtful space for your next idea.\n');
      await writeFile(
        path.join(project, 'src/App.tsx'),
        'export function App() {\n  return <main>Hello, Atlas.</main>;\n}\n',
      );
      await writeFile(path.join(project, 'package.json'), '{"name":"atlas-workspace","version":"1.0.0"}\n');
      const binary = path.resolve('tests/fixtures/fake-codex.mjs');
      await chmod(binary, 0o755);
      const shared = await sharedFixture(root, project);
      const service = new DeskService(path.join(root, 'data'));
      await service.init();
      await service.handle('settings.update', {
        binaryPath: binary,
        codexHome: shared.home,
        defaultWorkspace: path.join(root, 'default-workspace'),
      });
      await service.connect();
      const p = (await service.handle('project.add', { path: project })) as { id: string };
      await service.handle('settings.update', { lastProjectId: p.id });
      await page.exposeBinding('__deskRequest', (_source, method, params) => service.handle(method, params));
      await page.exposeBinding('__deskPick', () => project);
      let imageCounter = 0;
      await page.exposeBinding(
        '__deskImport',
        async (_source, uploads: { name: string; bytes: number[] }[]) => {
          const attachments = await Promise.all(
            uploads.map(async (upload) => {
              const file = path.join(root, `clipboard-${++imageCounter}.png`);
              const bytes = Buffer.from(upload.bytes);
              await writeFile(file, bytes);
              return {
                path: file,
                name: upload.name,
                preview: `data:image/png;base64,${bytes.toString('base64')}`,
              };
            }),
          );
          service.authorizeImages(attachments.map((image) => image.path));
          return attachments;
        },
      );
      await page.addInitScript(() => {
        const w = window as unknown as {
          __deskRequest: (method: string, params?: JsonObject) => Promise<unknown>;
          __deskPick: () => Promise<string>;
          __deskImport: (images: { name: string; bytes: number[] }[]) => Promise<ImageAttachment[]>;
        };
        window.codexDesk = {
          request: (method, params) => w.__deskRequest(method, params) as Promise<never>,
          subscribe(listener) {
            const handle = (e: Event) => listener((e as CustomEvent).detail);
            window.addEventListener('test:desk:event', handle);
            return () => window.removeEventListener('test:desk:event', handle);
          },
          pickDirectory: () => w.__deskPick(),
          pickImages: async () => [],
          importImages: (images) =>
            w.__deskImport(images.map((image) => ({ ...image, bytes: Array.from(image.bytes) }))),
          openExternal: async () => {},
          openTerminal: async () => {},
          windowAction: async () => {},
        };
      });
      const forward = (event: CodexEvent) =>
        void page
          .evaluate((e) => window.dispatchEvent(new CustomEvent('test:desk:event', { detail: e })), event)
          .catch(() => {});
      service.on('event', forward);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('/');
      await expect(page.getByText('Codex 已连接', { exact: true })).toBeVisible();
      await use(service);
      service.off('event', forward);
      service.terminal.close();
      await service.codex.stop();
      await shared.close();
      await rm(root, { recursive: true, force: true });
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});

test('Ubuntu workspace, language and theme controls, file browsing', async ({ page }) => {
  await expect(page.getByRole('heading', { name: '今天，我们做点什么？' })).toBeVisible();
  await page.screenshot({ path: 'test-results/workspace-zh.png', animations: 'disabled' });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('界面语言', { exact: true }).selectOption('en');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What shall we build today?' })).toBeVisible();
  await page.screenshot({ path: 'test-results/workspace-en-light.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'README.md', exact: true }).click();
  await expect(page.locator('.code-preview')).toContainText('A thoughtful space');
  await page.getByTitle('Mention in prompt').click();
  await expect(page.getByRole('textbox', { name: 'Message Codex' })).toHaveValue('@README.md ');
});

test('existing CLI history, new streamed turn, rename and archive', async ({ page }) => {
  await page.getByRole('button', { name: /Understand the project/ }).click();
  await expect(page.locator('.markdown')).toContainText('Atlas');
  const composer = page.getByRole('textbox', { name: '发送给 Codex 的消息' });
  await composer.fill('Hello Codex');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.markdown')).toContainText([
    'Atlas',
    'Your local Codex conversation is working.',
  ]);
  await page.screenshot({ path: 'test-results/conversation-zh.png', animations: 'disabled' });
  await page.getByRole('button', { name: '会话操作' }).click();
  await page.getByRole('button', { name: '重命名', exact: true }).click();
  await page.getByRole('textbox', { name: '会话名称' }).fill('A renamed conversation');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.conversation-breadcrumb')).toContainText('A renamed conversation');
  await page.getByRole('button', { name: '会话操作' }).click();
  await page.getByRole('button', { name: '归档会话', exact: true }).click();
  await expect(page.locator('.thread-list')).not.toContainText('A renamed conversation');
  await page.getByRole('button', { name: '切换归档会话' }).click();
  await expect(page.locator('.thread-list')).toContainText('A renamed conversation');
});

test('create thread, make an explicit approval decision, interrupt a running turn', async ({ page }) => {
  const composer = page.getByRole('textbox', { name: '发送给 Codex 的消息' });
  await composer.fill('approval please');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.approval-card')).toContainText('npm test');
  await page.screenshot({ path: 'test-results/approval-zh.png', animations: 'disabled' });
  await page.getByRole('button', { name: '允许一次', exact: true }).click();
  await expect(page.locator('.approval-card')).toHaveCount(0);
  await expect(page.locator('.markdown')).toContainText('Decision: accept');
  await composer.fill('wait for interruption');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('button', { name: '停止任务', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '停止任务', exact: true }).click();
  await expect(page.getByText('任务已停止', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeVisible();
});

test('connection failure is actionable and preserves the workspace', async ({ page, setup }) => {
  await setup.codex.stop();
  await expect(page.getByText('Codex 未连接', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: 'Codex CLI', exact: true }).click();
  await page.getByRole('button', { name: '保存并连接', exact: true }).click();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByText('Codex 已连接', { exact: true })).toBeVisible();
});

test('a small Ubuntu window keeps the composer and inspector usable', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.getByRole('complementary', { name: '项目面板' })).toHaveCount(0);
  await page.getByRole('button', { name: '打开项目面板' }).click();
  await page.getByRole('button', { name: 'README.md', exact: true }).click();
  await expect(page.locator('.code-preview')).toContainText('A thoughtful space');
  await page.getByRole('button', { name: '关闭项目面板' }).click();
  await page.getByRole('textbox', { name: '发送给 Codex 的消息' }).fill('Hello from a small window');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.markdown')).toContainText('Your local Codex conversation is working.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('first message starts in the default workspace and drafts survive reload', async ({ page, setup }) => {
  await setup.handle('settings.update', { lastProjectId: '', lastThreadId: '' });
  await page.reload();
  const composer = page.getByRole('textbox', { name: '发送给 Codex 的消息' });
  await composer.fill('A draft in the default workspace');
  await page.reload();
  await expect(composer).toHaveValue('A draft in the default workspace');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.markdown')).toContainText('Your local Codex conversation is working.');
  const params = await setup.codex.request<{ threadId: string }>('test.lastTurn');
  const thread = (await setup.handle('thread.read', { threadId: params.threadId })) as Thread;
  expect(thread.cwd).toBe(setup.defaultWorkspace);
  await expect(composer).toHaveValue('');
});

test('model popup has descriptions, effort tabs and keyboard selection', async ({ page }) => {
  await page.getByRole('combobox', { name: '模型', exact: true }).click();
  await expect(page.getByRole('option', { name: /Codex · Fast fixture/ })).toContainText('Quick answers');
  await page.screenshot({ path: 'test-results/model-picker-dark.png', animations: 'disabled' });
  await page.getByRole('listbox', { name: '模型', exact: true }).press('ArrowDown');
  await page.getByRole('listbox', { name: '模型', exact: true }).press('Enter');
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toContainText('Fast fixture');
  await page.getByRole('combobox', { name: '模型', exact: true }).click();
  await page.getByRole('tab', { name: '推理强度' }).click();
  await page.getByRole('option', { name: /medium/ }).click();
  await expect(page.getByRole('combobox', { name: '推理强度', exact: true })).toContainText('medium');
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await page.getByRole('combobox', { name: '模型', exact: true }).click();
  await page.screenshot({ path: 'test-results/model-picker-light.png', animations: 'disabled' });
});

test('all slash commands, plan mode, goal controls and CLI goal notifications', async ({ page, setup }) => {
  await page.getByRole('button', { name: 'Codex 命令', exact: true }).click();
  await expect(page.getByRole('listbox', { name: '命令列表' }).getByRole('option')).toHaveCount(
    slashCommands.length,
  );
  await page.screenshot({ path: 'test-results/commands-zh.png', animations: 'disabled' });
  await page.getByRole('textbox', { name: '搜索命令' }).fill('goal');
  await page.getByRole('option', { name: /\/goal/ }).click();
  await page.getByRole('textbox', { name: '目标内容' }).fill('Deliver the Atlas workspace');
  await page.getByRole('spinbutton', { name: 'Token 预算（可选）' }).fill('12000');
  await page.getByRole('button', { name: '开始目标', exact: true }).click();
  await expect(page.locator('.goal-badge')).toContainText('正在追求目标');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(page.locator('.goal-badge')).toContainText('目标已暂停');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  const id = setup.store.state.settings.lastThreadId;
  await setup.codex.request('thread/goal/set', {
    threadId: id,
    status: 'active',
    objective: 'Goal updated from CLI',
  });
  await expect(page.locator('.goal-badge')).toContainText('正在追求目标');
  await page.locator('.goal-badge').click();
  await expect(page.locator('.goal-objective')).toHaveText('Goal updated from CLI');
  await page.screenshot({ path: 'test-results/goal-panel.png', animations: 'disabled' });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  const composer = page.getByRole('textbox', { name: '发送给 Codex 的消息' });
  await composer.fill('/plan Draft the plan');
  await composer.press('Enter');
  await expect(page.locator('.markdown')).toContainText('Your local Codex conversation is working.');
  expect(
    (await setup.codex.request<{ collaborationMode: { mode: string } }>('test.lastTurn')).collaborationMode
      .mode,
  ).toBe('plan');
  await composer.fill('/status');
  await composer.press('Enter');
  await expect(page.getByRole('dialog', { name: '会话状态' })).toContainText(id);
});

test('legacy writer banner preserves drafts and reconnects automatically', async ({ page, setup }) => {
  await setup.codex.request('test.lock', { threadId: 'fixture-history', locked: true });
  await page.getByRole('button', { name: /Understand the project/ }).click();
  await expect(page.locator('.sync-banner')).toContainText('独立 CLI');
  const composer = page.getByRole('textbox', { name: '发送给 Codex 的消息' });
  await composer.fill('Keep this unsent draft');
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  await setup.codex.request('test.lock', { threadId: 'fixture-history', locked: false });
  await expect(page.locator('.sync-banner')).toHaveCount(0, { timeout: 6000 });
  await expect(composer).toHaveValue('Keep this unsent draft');
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
});

test('CLI-only commands open an interactive embedded terminal', async ({ page }) => {
  await page.getByRole('button', { name: /Understand the project/ }).click();
  await page.getByRole('button', { name: 'Codex 命令', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索命令' }).fill('plugins');
  await page.getByRole('option', { name: /\/plugins/ }).click();
  await expect(page.getByRole('dialog', { name: 'Codex CLI · 同一会话' })).toBeVisible();
  await expect(page.locator('.xterm-screen')).toContainText('CODEX_CLI_FIXTURE_READY');
  await page.getByRole('button', { name: '填入命令' }).click();
  await page.locator('.xterm-helper-textarea').press('Enter');
  await expect(page.locator('.xterm-screen')).toContainText('CLI executed: /plugins');
  await page.locator('.xterm-helper-textarea').press('Escape');
  await expect(page.getByRole('dialog', { name: 'Codex CLI · 同一会话' })).toBeVisible();
});

const clipboardPng =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAL0lEQVR4nO3OIQEAAAgDMKJSG0UUiHEzMb+a3ksqAQEBAQEBAQEBAQEBAQGBdOABxQdctdynpFgAAAAASUVORK5CYII=';
async function pasteFixture(page: import('@playwright/test').Page, count = 1, oversized = false) {
  await page.locator('.composer textarea').evaluate(
    (element, { png, count, oversized }) => {
      const data = new DataTransfer();
      const bytes = oversized
        ? new Uint8Array(20 * 1024 * 1024 + 1)
        : Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      for (let i = 0; i < count; i++)
        data.items.add(new File([bytes], `screenshot-${i}.png`, { type: 'image/png' }));
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    },
    { png: clipboardPng, count, oversized },
  );
}

test('pasted images preview, preserve drafts through startup mode changes, remove, and send as localImage', async ({
  page,
  setup,
}) => {
  const composer = page.getByRole('textbox', { name: '发送给 Codex 的消息' });
  await composer.fill('Explain this screenshot');
  await pasteFixture(page);
  await expect(page.locator('.image-attachments img')).toHaveCount(1);
  await expect(composer).toHaveValue('Explain this screenshot');
  await page.getByRole('radio', { name: /YOLO/ }).check();
  await expect(page.locator('.image-attachments img')).toHaveCount(1);
  await page.getByRole('button', { name: '移除图片' }).click();
  await expect(page.locator('.image-attachments img')).toHaveCount(0);
  await pasteFixture(page);
  await composer.fill('');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.markdown')).toContainText('Your local Codex conversation is working.');
  const params = await setup.codex.request<{ threadId: string; input: { type: string; path: string }[] }>(
    'test.lastTurn',
  );
  expect(params.input).toHaveLength(1);
  expect(params.input[0].type).toBe('localImage');
  expect(await readFile(params.input[0].path)).toEqual(Buffer.from(clipboardPng, 'base64'));
  const actual = await setup.codex.request<{ approvalPolicy: string; sandboxPolicy: { type: string } }>(
    'test.settings',
    { threadId: params.threadId },
  );
  expect(actual.approvalPolicy).toBe('never');
  expect(actual.sandboxPolicy.type).toBe('dangerFullAccess');
  await expect(page.locator('.image-attachments')).toHaveCount(0);
  await expect(page.locator('.completion-toast')).toContainText('任务已完成');
});

test('clipboard limits keep existing draft and attachments; pending imports cannot leak into another conversation', async ({
  page,
}) => {
  const composer = page.getByRole('textbox', { name: '发送给 Codex 的消息' });
  await composer.fill('Keep my draft');
  await pasteFixture(page, 1, true);
  await expect(page.getByRole('alert')).toContainText('20 MiB');
  await pasteFixture(page, 9);
  await expect(page.getByRole('alert')).toContainText('8 张图片');
  await expect(page.locator('.image-attachments img')).toHaveCount(0);
  await pasteFixture(page, 8);
  await expect(page.locator('.image-attachments img')).toHaveCount(8);
  await pasteFixture(page);
  await expect(page.locator('.image-attachments img')).toHaveCount(8);
  await expect(composer).toHaveValue('Keep my draft');
  await page.getByRole('button', { name: '移除图片' }).first().click();
  await page.evaluate(() => {
    const original = window.codexDesk!.importImages;
    window.codexDesk!.importImages = async (images) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return original(images);
    };
  });
  await pasteFixture(page);
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /Understand the project/ }).click();
  await expect(page.locator('.markdown')).toContainText('Atlas');
  await page.waitForTimeout(500);
  await expect(page.locator('.image-attachments img')).toHaveCount(0);
});

test('CLI permission changes are inherited until an explicit Desk change; completion notices navigate and dismiss', async ({
  page,
  setup,
}) => {
  await setup.codex.request('thread/settings/update', {
    threadId: 'fixture-history',
    sandboxPolicy: { type: 'dangerFullAccess' },
    approvalPolicy: 'never',
    model: 'test-fast',
    effort: 'low',
  });
  await page.getByRole('button', { name: /Understand the project/ }).click();
  const permissions = page.getByRole('combobox', { name: '权限模式', exact: true });
  await expect(permissions).toContainText('YOLO');
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toContainText('Fast fixture');
  const composer = page.getByRole('textbox', { name: '发送给 Codex 的消息' });
  await composer.fill('Preserve the CLI configuration');
  await composer.press('Enter');
  await expect(page.locator('.completion-toast')).toContainText('任务已完成');
  let params = await setup.codex.request<Record<string, unknown>>('test.lastTurn');
  for (const key of ['sandboxPolicy', 'approvalPolicy', 'model', 'effort', 'collaborationMode'])
    expect(params).not.toHaveProperty(key);
  await permissions.click();
  await page.getByRole('option', { name: /只读/ }).click();
  await composer.fill('Use the mode I selected in Desk');
  await composer.press('Enter');
  await expect(page.locator('.markdown')).toHaveCount(3);
  params = await setup.codex.request('test.lastTurn');
  expect(params.sandboxPolicy).toEqual({ type: 'readOnly', networkAccess: false });
  expect(params.approvalPolicy).toBe('on-request');
  await setup.codex.request('thread/settings/update', {
    threadId: 'fixture-history',
    sandboxPolicy: { type: 'dangerFullAccess' },
    approvalPolicy: 'never',
  });
  await expect(permissions).toContainText('YOLO');
  await page.getByRole('button', { name: /^新会话/ }).click();
  await page.getByRole('button', { name: '查看会话', exact: true }).click();
  await expect(page.locator('.conversation-breadcrumb')).toContainText('Understand the project');
  await expect(page.locator('.completion-toast')).toHaveCount(0);
  await setup.codex.request('turn/start', {
    threadId: 'fixture-history',
    input: [{ type: 'text', text: 'One more completion notice' }],
  });
  await expect(page.locator('.completion-toast')).toBeVisible();
  await expect(page.locator('.completion-toast')).toHaveCount(0, { timeout: 10_000 });
});
