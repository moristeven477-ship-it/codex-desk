import { test as base, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DeskService } from '../../electron/service';
import type { CodexEvent, JsonObject } from '../../src/shared/types';

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
      process.env.CODEX_DESK_FIXTURE_ROOT = project;
      const service = new DeskService(path.join(root, 'data'));
      await service.init();
      await service.handle('settings.update', { binaryPath: binary });
      await service.connect();
      const p = (await service.handle('project.add', { path: project })) as { id: string };
      await service.handle('settings.update', { lastProjectId: p.id });
      await page.exposeBinding('__deskRequest', (_source, method, params) => service.handle(method, params));
      await page.exposeBinding('__deskPick', () => project);
      await page.addInitScript(() => {
        const w = window as unknown as {
          __deskRequest: (method: string, params?: JsonObject) => Promise<unknown>;
          __deskPick: () => Promise<string>;
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
          openExternal: async () => {},
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
      await service.codex.stop();
      await rm(root, { recursive: true, force: true });
      delete process.env.CODEX_DESK_FIXTURE_ROOT;
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
