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
          copyText: (text) => navigator.clipboard.writeText(text),
          importImages: (images) =>
            w.__deskImport(images.map((image) => ({ ...image, bytes: Array.from(image.bytes) }))),
          openExternal: async () => {},
          openTerminal: async () => {},
          prepareTerminal: async (threadId) => {
            const state = window as unknown as { preparedTerminals?: string[] };
            (state.preparedTerminals ??= []).push(threadId);
            return { state: 'ready' };
          },
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

test('font slider previews, persists, resets and stays usable in English at the minimum window width', async ({
  page,
  setup,
}) => {
  await page.getByRole('button', { name: /Understand the project/ }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const slider = page.getByRole('slider', { name: '字体大小', exact: true });
  await expect(slider).toHaveValue('13');
  await slider.press('Home');
  await expect.poll(() => setup.store.state.settings.fontSize).toBe(12);
  const originalHandle = setup.handle.bind(setup);
  let fontWrites = 0;
  setup.handle = async (method, params) => {
    if (method === 'settings.update' && params && typeof params === 'object' && 'fontSize' in params)
      fontWrites++;
    return originalHandle(method, params);
  };
  const track = (await slider.boundingBox())!;
  await page.mouse.move(track.x + 8, track.y + track.height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width * 0.437, track.y + track.height / 2, { steps: 30 });
  const dragged = Number(await slider.inputValue());
  expect(dragged).toBeGreaterThan(15);
  expect(dragged).toBeLessThan(18);
  expect(Number.isInteger(dragged)).toBe(false);
  await expect
    .poll(() =>
      page.locator('.markdown').evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
    )
    .toBeCloseTo(dragged, 2);
  expect(fontWrites).toBe(0);
  await page.mouse.up();
  await expect.poll(() => setup.store.state.settings.fontSize).toBe(dragged);
  expect(fontWrites).toBe(1);
  await slider.press('End');
  await expect(page.locator('.markdown')).toHaveCSS('font-size', '22px');
  await expect(page.locator('.composer textarea')).toHaveCSS('font-size', '22px');
  await expect(page.locator('.user-text')).toHaveCSS('font-size', '22px');
  await slider.press('ArrowLeft');
  await slider.press('ArrowLeft');
  await slider.press('ArrowLeft');
  await expect.poll(() => setup.store.state.settings.fontSize).toBe(21.7);
  await page.reload();
  await expect(page.locator('.markdown')).toHaveCSS('font-size', '21.7px');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(slider).toHaveValue('21.7');
  await page.getByRole('combobox', { name: '界面语言' }).selectOption('en');
  await page.setViewportSize({ width: 880, height: 680 });
  const englishSlider = page.getByRole('slider', { name: 'Font size', exact: true });
  await englishSlider.press('End');
  await expect(page.getByRole('button', { name: 'Reset', exact: true })).toBeVisible();
  await expect(page.locator('.font-size-preview')).toHaveCSS('font-size', '22px');
  const overflow = await page
    .getByRole('dialog')
    .evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: 'test-results/font-size-english.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(englishSlider).toHaveValue('13');
  await expect(page.locator('.markdown')).toHaveCSS('font-size', '13px');
  await englishSlider.fill('16.37');
  await page.keyboard.press('Escape');
  await expect.poll(() => setup.store.state.settings.fontSize).toBe(16.37);
  await expect(page.locator('.markdown')).toHaveCSS('font-size', '16.37px');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveCSS('transition-property', 'none');
});

test('user and assistant messages copy their exact text, with success and retry feedback', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: /Understand the project/ }).click();
  const reply = page.locator('.assistant-message');
  await reply.getByRole('button', { name: '复制消息', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'This is **Atlas**, a small React workspace.',
  );
  await expect(reply.getByRole('button', { name: '已复制', exact: true })).toBeVisible();
  const text = '原样复制 Unicode\n\n**literal markdown**\n`echo $HOME`';
  const composer = page.getByRole('textbox', { name: '发送给 Codex 的消息' });
  await composer.fill(text);
  await composer.press('Enter');
  const message = page.locator('.user-message').last();
  await message.getByRole('button', { name: '复制消息', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
  await expect(message.getByRole('button', { name: '已复制', exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.codexDesk!.copyText = async () => {
      throw new Error('Clipboard unavailable');
    };
  });
  await page
    .locator('.assistant-message')
    .last()
    .getByRole('button', { name: '复制消息', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('复制失败');
  await page.evaluate(() => {
    window.codexDesk!.copyText = (text) => navigator.clipboard.writeText(text);
  });
  await page
    .locator('.assistant-message')
    .last()
    .getByRole('button', { name: '复制消息', exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'Done. Your local Codex conversation is working.',
  );
});

test('running CLI tasks accept repeated text and image steering from Desk and preserve drafts on rejection', async ({
  page,
  setup,
}) => {
  await page.getByRole('button', { name: /Understand the project/ }).click();
  const threadId = 'fixture-history';
  const { turn } = await setup.codex.request<{ turn: { id: string } }>('turn/start', {
    threadId,
    input: [{ type: 'text', text: 'wait for Desk to steer' }],
  });
  const composer = page.getByRole('textbox', { name: '发送给 Codex 的消息' });
  const steer = page.getByRole('button', { name: '插话', exact: true });
  await expect(steer).toBeDisabled();
  await composer.fill('先检查这个截图');
  await pasteFixture(page);
  await steer.click();
  await expect(page.locator('.steer-status')).toContainText('插话已发送');
  await expect(composer).toHaveValue('');
  await expect(page.locator('.image-attachments img')).toHaveCount(0);
  await expect(page.locator('.user-text').last()).toHaveText('先检查这个截图');
  let sent = await setup.codex.request<{ expectedTurnId: string; input: { type: string }[] }>(
    'test.lastSteer',
  );
  expect(sent.expectedTurnId).toBe(turn.id);
  expect(sent.input.map((part) => part.type)).toEqual(['text', 'localImage']);
  await expect(page.getByRole('button', { name: '停止任务', exact: true })).toBeVisible();
  const originalHandle = setup.handle.bind(setup);
  setup.handle = async (method, params) => {
    if (method === 'turn.steer') await new Promise((resolve) => setTimeout(resolve, 300));
    return originalHandle(method, params);
  };
  await composer.fill('再补充一句');
  await composer.press('Shift+Enter');
  await expect(composer).toHaveValue('再补充一句\n');
  await composer.press('Enter');
  await composer.fill('确认前继续输入的新草稿');
  await expect(page.locator('.user-text').last()).toHaveText('再补充一句');
  await expect(steer).toBeEnabled();
  await expect(composer).toHaveValue('确认前继续输入的新草稿');
  expect(((await setup.handle('thread.read', { threadId })) as Thread).turns).toHaveLength(2);
  await page.screenshot({ path: 'test-results/steer-zh.png', animations: 'disabled' });
  const handle = setup.handle.bind(setup);
  setup.handle = async (method, params) => {
    if (method === 'turn.steer') {
      await setup.codex.request('turn/interrupt', { threadId, turnId: turn.id });
    }
    return handle(method, params);
  };
  await composer.fill('这句必须保留');
  await pasteFixture(page);
  await steer.click();
  await expect(page.getByRole('alert')).toContainText('插话未发送，输入已保留');
  await expect(composer).toHaveValue('这句必须保留');
  await expect(page.locator('.image-attachments img')).toHaveCount(1);
  expect(((await setup.handle('thread.read', { threadId })) as Thread).turns).toHaveLength(2);
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
  await expect(page.locator('.background-terminal-status')).toContainText('终端已在后台打开');
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

test('Fast follows CLI changes, uses confirmed shared settings and supports slash controls', async ({
  page,
  setup,
}) => {
  await expect(page.locator('.background-terminal-status')).toContainText('终端已在后台打开');
  const threadId = setup.store.state.settings.lastThreadId;
  const fast = page.getByRole('button', { name: 'Fast 模式', exact: true });
  await expect(fast).toHaveAttribute('aria-pressed', 'false');
  await setup.codex.request('thread/settings/update', {
    threadId,
    serviceTier: 'priority',
    sandboxPolicy: { type: 'dangerFullAccess' },
    approvalPolicy: 'never',
  });
  await expect(fast).toHaveAttribute('aria-pressed', 'true');
  await setup.codex.request('test.settingsDelay', { milliseconds: 350 });
  const composer = page.getByRole('textbox', { name: '发送给 Codex 的消息' });
  await composer.fill('Keep my draft while changing speed');
  await fast.click();
  await expect(fast).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  await expect(fast).toHaveAttribute('aria-pressed', 'false');
  await expect(fast).toHaveAttribute('aria-busy', 'false');
  await expect(composer).toHaveValue('Keep my draft while changing speed');
  await expect(page.getByRole('combobox', { name: '权限模式', exact: true })).toContainText('YOLO');
  await composer.fill('/fast on');
  await composer.press('Enter');
  await expect(fast).toHaveAttribute('aria-pressed', 'true');
  await expect(composer).toHaveValue('');
  await composer.fill('/fast status');
  await composer.press('Enter');
  await expect(page.locator('.session-status')).toContainText('已开启');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await composer.fill('Fast preserves the CLI configuration');
  await composer.press('Enter');
  await expect(page.locator('.completion-toast')).toBeVisible();
  expect(await setup.codex.request('test.lastTurn')).not.toHaveProperty('serviceTier');
  await page.reload();
  await expect(fast).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.user-message')).toContainText('Fast preserves the CLI configuration');
  await setup.codex.request('test.settingsError', { message: 'Fast fixture rejected this change' });
  await fast.click();
  await expect(page.getByRole('alert')).toContainText('Fast fixture rejected');
  await expect(fast).toHaveAttribute('aria-pressed', 'true');
  await setup.codex.request('test.settingsError', { message: '' });
  await composer.fill('/fast off');
  await composer.press('Enter');
  await expect(fast).toHaveAttribute('aria-pressed', 'false');
  await setup.codex.request('thread/settings/update', { threadId, model: 'test-fast' });
  await expect(fast).toBeDisabled();
  await expect(fast).toHaveAttribute('title', '当前模型未提供 Fast 模式');
});

test('completed summaries keep messages from Desk and CLI visible after navigation and reload', async ({
  page,
  setup,
}) => {
  await page.getByRole('button', { name: /Understand the project/ }).click();
  const users = page.locator('.user-message .user-text');
  await expect(users).toHaveText(['Explain this project.']);
  const composer = page.getByRole('textbox', { name: '发送给 Codex 的消息' });
  await composer.fill('A previous message from Desk');
  await composer.press('Enter');
  await expect(page.locator('.completion-toast')).toBeVisible();
  await expect(users).toHaveText(['Explain this project.', 'A previous message from Desk']);
  await setup.codex.request('turn/start', {
    threadId: 'fixture-history',
    input: [{ type: 'text', text: 'A previous message from CLI' }],
  });
  await expect(page.locator('.markdown')).toHaveCount(3);
  const expected = ['Explain this project.', 'A previous message from Desk', 'A previous message from CLI'];
  await expect(users).toHaveText(expected);
  await page.reload();
  await expect(users).toHaveText(expected);
  await page.locator('.new-conversation').click();
  await page.getByRole('button', { name: /Understand the project/ }).click();
  await expect(users).toHaveText(expected);
  await expect(page.locator('.assistant-message')).toHaveCount(3);
});

test('opening conversations prepares terminals before the first turn and preserves CLI startup changes', async ({
  page,
  setup,
}) => {
  await expect(page.locator('.background-terminal-status')).toContainText('终端已在后台打开');
  const firstId = setup.store.state.settings.lastThreadId;
  expect(firstId).toBeTruthy();
  expect(((await setup.handle('thread.read', { threadId: firstId })) as Thread).turns).toHaveLength(0);
  await page.getByRole('radio', { name: /YOLO/ }).check();
  await expect
    .poll(async () => ((await setup.handle('thread.open', { threadId: firstId })) as Thread).approvalPolicy)
    .toBe('never');
  await setup.codex.request('thread/settings/update', {
    threadId: firstId,
    sandboxPolicy: { type: 'readOnly', networkAccess: false },
    approvalPolicy: 'on-request',
  });
  await expect(page.getByRole('combobox', { name: '权限模式', exact: true })).toContainText('只读');
  const composer = page.getByRole('textbox', { name: '发送给 Codex 的消息' });
  await composer.fill('Inherit the CLI mode after startup');
  await composer.press('Enter');
  await expect(page.locator('.markdown')).toContainText('Your local Codex conversation is working.');
  const sent = await setup.codex.request<Record<string, unknown>>('test.lastTurn');
  expect(sent.threadId).toBe(firstId);
  expect(sent).not.toHaveProperty('sandboxPolicy');
  expect(sent).not.toHaveProperty('approvalPolicy');
  await page.locator('.new-conversation').click();
  await expect.poll(() => setup.store.state.settings.lastThreadId).not.toBe(firstId);
  await expect(page.getByRole('heading', { name: '今天，我们做点什么？' })).toBeVisible();
  await page.getByRole('button', { name: /Understand the project/ }).click();
  await expect(page.locator('.markdown')).toContainText('Atlas');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { preparedTerminals: string[] }).preparedTerminals))
    .toContain('fixture-history');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('slow new-conversation creation keeps images and text, and cannot replace a later selection', async ({
  page,
  setup,
}) => {
  await expect(page.locator('.background-terminal-status')).toContainText('终端已在后台打开');
  const handle = setup.handle.bind(setup);
  setup.handle = async (method, params) => {
    if (method === 'thread.create') await new Promise((resolve) => setTimeout(resolve, 600));
    return handle(method, params);
  };
  await page.locator('.new-conversation').click();
  const composer = page.getByRole('textbox', { name: '发送给 Codex 的消息' });
  await composer.fill('Keep typing while my terminal is prepared');
  await pasteFixture(page);
  await expect(page.locator('.background-terminal-status')).toContainText('终端已在后台打开');
  await expect(composer).toHaveValue('Keep typing while my terminal is prepared');
  await expect(page.locator('.image-attachments img')).toHaveCount(1);
  await expect(composer).toBeFocused();
  await page.locator('.new-conversation').click();
  await page.getByRole('button', { name: /Understand the project/ }).click();
  await expect(page.locator('.markdown')).toContainText('Atlas');
  await page.waitForTimeout(750);
  await expect(page.locator('.conversation-breadcrumb')).toContainText('Understand the project');
  expect(setup.store.state.settings.lastThreadId).toBe('fixture-history');
  await expect(page.getByRole('alert')).toHaveCount(0);
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

test('compaction shows progress and a recoverable failure, then retries on the same thread', async ({
  page,
  setup,
}) => {
  await page.getByRole('button', { name: /Understand the project/ }).click();
  await setup.codex.request('test.compaction', { mode: 'failed' });
  const composer = page.getByRole('textbox', { name: '发送给 Codex 的消息' });
  await composer.fill('/compact');
  await composer.press('Enter');
  await expect(page.getByText('正在压缩上下文…', { exact: true })).toBeVisible();
  await expect(page.locator('.compaction-error')).toContainText('可稍后重试');
  await expect(page.locator('.compaction-status')).toContainText('上下文压缩失败');
  await expect(page.locator('.completion-toast')).toContainText('任务执行失败');
  await setup.codex.request('test.compaction', { mode: 'success' });
  await page.getByRole('button', { name: '重试压缩', exact: true }).click();
  await expect(page.locator('.compaction-status').last()).toContainText('上下文已压缩');
  await expect(page.locator('.completion-toast')).toContainText('任务已完成');
  await expect(page.locator('.error-banner')).toHaveCount(0);
  await expect(page.locator('.markdown')).toContainText('Atlas');
  expect(setup.store.state.settings.lastThreadId).toBe('fixture-history');
  await page.reload();
  await expect(page.locator('.compaction-status').last()).toContainText('上下文已压缩');
});

test('filtered pre-sampling compaction errors remain actionable after reload in both languages', async ({
  page,
  setup,
}) => {
  await page.getByRole('button', { name: /Understand the project/ }).click();
  await setup.codex.request('test.compaction', { mode: 'filtered', item: false });
  await setup.codex.request('thread/compact/start', { threadId: 'fixture-history' });
  await expect(page.locator('.compaction-error')).toContainText('content_filter');
  await expect(page.getByRole('button', { name: '重试压缩', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.compaction-error')).toContainText('原会话已保留');
  await page.locator('.compaction-error summary').click();
  await expect(page.locator('.compaction-error pre')).toContainText('Incomplete response returned');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('界面语言', { exact: true }).selectOption('en');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.compaction-error')).toContainText('This conversation is preserved');
  await page.screenshot({ path: 'test-results/compaction-error-en.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Start a new conversation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What shall we build today?' })).toBeVisible();
  const original = (await setup.handle('thread.read', { threadId: 'fixture-history' })) as Thread;
  expect(original.turns[0].items[1].text).toContain('Atlas');
  expect(original.turns.at(-1)!.error!.message).toContain('content_filter');
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
  await page.locator('.new-conversation').click();
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
