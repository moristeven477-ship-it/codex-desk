import { test, expect, type Page } from '@playwright/test';
import { remoteFixture } from '../fixtures/remote';
import type { Thread, Bootstrap } from '../../src/shared/types';
import { slashCommands } from '../../src/shared/commands';

let f: Awaited<ReturnType<typeof remoteFixture>>;
test.beforeEach(async () => {
  f = await remoteFixture();
});
test.afterEach(async () => {
  await f.close();
});
async function pair(page: Page) {
  await page.goto(f.gateway.status.localOrigin);
  await page.getByRole('textbox', { name: 'Pairing code', exact: true }).fill(f.gateway.createPairing().code);
  await page.getByRole('button', { name: 'Pair and connect' }).click();
  await expect(page.getByRole('heading', { name: 'What’s on your mind?' })).toBeVisible();
  await expect(page.locator('.remote-offline')).toHaveCount(0);
}
async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Conversation actions', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
}

test('compact phone layout keeps a growing draft and send controls visible with a short viewport', async ({
  page,
}) => {
  await pair(page);
  await expect(page.locator('.mobile-header')).toBeVisible();
  await expect(page.locator('.titlebar')).toBeHidden();
  await expect(page.locator('.main-statusbar')).toBeHidden();
  const composer = page.getByRole('textbox', { name: 'Message Codex' });
  const height = await page
    .locator('.composer')
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(height).toBeLessThanOrEqual(105);
  await page.screenshot({ path: 'test-results/remote/mobile-home-dark.png', animations: 'disabled' });
  await composer.fill('First line');
  await composer.press('Enter');
  await composer.pressSequentially('Second line');
  await expect(composer).toHaveValue('First line\nSecond line');
  await expect(page.locator('.user-text')).toHaveCount(0);
  const draft = Array.from({ length: 30 }, (_, i) => `Line ${i}: keep this complete draft.`).join('\n');
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 360, height: 430 },
    { width: 851, height: 393 },
  ]) {
    await page.setViewportSize(viewport);
    await composer.fill(draft);
    await expect(composer).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeInViewport({
      ratio: 1,
    });
    expect(await composer.evaluate((element) => element.clientHeight)).toBeLessThanOrEqual(
      Math.ceil(Math.min(128, viewport.height * 0.24)),
    );
    expect(await composer.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 393, height: 851 });
  await composer.fill('');
  await openSettings(page);
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('zh');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.screenshot({ path: 'test-results/remote/mobile-home-light-zh.png', animations: 'disabled' });
  await expect(page.getByRole('heading', { name: '今天想做点什么？' })).toBeVisible();
  await page.getByRole('button', { name: '会话操作', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const slider = page.getByRole('slider');
  await slider.fill('22');
  await expect
    .poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)))
    .toBeGreaterThan(26);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 460 });
  await page.getByRole('textbox', { name: '发送给 Codex 的消息' }).fill('在小屏上继续写消息');
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(f.service.store.state.settings.locale).toBe('en');
});

test('session sheet preserves CLI defaults and applies only explicit thinking, Fast and model choices', async ({
  page,
}) => {
  await pair(page);
  await page.getByRole('combobox', { name: 'Session settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Session settings' })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('tab', { name: 'Model', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.screenshot({ path: 'test-results/remote/mobile-session-sheet.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const composer = page.getByRole('textbox', { name: 'Message Codex' });
  await composer.fill('Keep my CLI settings.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.markdown')).toContainText('working');
  const inherited = await f.shared.request('test.lastTurn');
  for (const name of ['model', 'effort', 'sandboxPolicy', 'approvalPolicy', 'serviceTier'])
    expect(inherited).not.toHaveProperty(name);
  await page.getByRole('combobox', { name: 'Session settings' }).click();
  await page.getByRole('tab', { name: 'Thinking', exact: true }).click();
  await page.getByRole('option', { name: /high/ }).click();
  await page.getByRole('combobox', { name: 'Session settings' }).click();
  await page.getByRole('button', { name: /Fast/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await composer.fill('Use deeper thinking.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.markdown')).toHaveCount(2);
  const sent = await f.shared.request('test.lastTurn');
  expect(sent.effort).toBe('high');
  expect(sent).not.toHaveProperty('sandboxPolicy');
  const boot = await page.evaluate(() => window.codexDesk!.request<Bootstrap>('bootstrap'));
  const settings = await f.shared.request('test.settings', { threadId: boot.settings.lastThreadId });
  expect(settings.serviceTier).toBe('priority');
  await page.getByRole('combobox', { name: 'Session settings' }).click();
  await page.getByRole('tab', { name: 'Model', exact: true }).click();
  await page.getByRole('option', { name: /Codex · Fast fixture/ }).click();
  await expect(page.getByRole('combobox', { name: 'Session settings' })).toContainText('Fast fixture');
});

test('all slash commands remain reachable through the tools sheet without opening the keyboard', async ({
  page,
}) => {
  await pair(page);
  await page.getByRole('button', { name: 'Add and tools', exact: true }).click();
  await page.getByRole('button', { name: 'All / commands', exact: true }).click();
  const commands = page.getByRole('dialog', { name: 'Codex commands' });
  await expect(commands).toBeInViewport({ ratio: 1 });
  await expect(commands.getByRole('option')).toHaveCount(slashCommands.length);
  await expect(page.getByRole('textbox', { name: 'Search commands', exact: true })).not.toBeFocused();
  await page.screenshot({ path: 'test-results/remote/mobile-commands.png', animations: 'disabled' });
  await page.getByRole('textbox', { name: 'Search commands', exact: true }).fill('status');
  await commands.getByRole('option', { name: '/status Session status', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Session status' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('phone pairs, reselects existing CLI YOLO, sends, browses history and opens the real CLI panel', async ({
  page,
}) => {
  await pair(page);
  const composer = page.getByRole('textbox', { name: 'Message Codex' });
  await expect(composer).toBeInViewport();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.codexDesk!.request<Bootstrap>('bootstrap'))).settings.lastThreadId,
    )
    .not.toBe('');
  const { settings } = await page.evaluate(() => window.codexDesk!.request<Bootstrap>('bootstrap'));
  // The CLI already has this mode. Re-selecting it on the phone returns an ACK
  // without a settings notification, just like the production app-server.
  await f.shared.request('thread/settings/update', {
    threadId: settings.lastThreadId,
    sandboxPolicy: { type: 'dangerFullAccess' },
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
  });
  await page.getByRole('button', { name: 'Permission mode', exact: true }).click();
  await page.getByRole('option', { name: /Full access · YOLO/ }).click();
  await composer.fill('Hello from Android.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.user-text')).toHaveText('Hello from Android.');
  await expect(page.locator('.markdown')).toContainText('Your local Codex conversation is working.');
  await expect(page.getByRole('alert')).toHaveCount(0);
  const actual = await f.shared.request('test.settings', { threadId: settings.lastThreadId });
  expect(actual.approvalPolicy).toBe('never');
  expect(actual.sandboxPolicy).toEqual({ type: 'dangerFullAccess' });
  const sent = await f.shared.request('test.lastTurn');
  expect(sent).not.toHaveProperty('sandboxPolicy');
  expect(sent).not.toHaveProperty('approvalPolicy');
  expect(
    ((await f.service.handle('thread.read', { threadId: settings.lastThreadId })) as Thread).turns,
  ).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/remote/phone-chat.png' });
  await page.getByRole('button', { name: 'Conversation actions', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Language' }).selectOption('zh');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  expect(f.service.store.state.settings.locale).toBe('en');
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await page.getByRole('button', { name: /Understand the project/ }).click();
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect(page.locator('.markdown')).toContainText('This is Atlas');
  await page.getByRole('button', { name: '会话操作', exact: true }).click();
  await page.getByRole('button', { name: 'CLI 同步', exact: true }).click();
  await expect(page.locator('.xterm-screen')).toContainText('CODEX_CLI_FIXTURE_READY');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.setViewportSize({ width: 360, height: 460 });
  await expect(page.locator('.composer textarea')).toBeInViewport();
  await expect(page.locator('.send-button')).toBeInViewport({ ratio: 1 });
});
test('phone steering is visible and reconnect recovers CLI messages without resending input', async ({
  page,
  context,
}) => {
  await pair(page);
  const composer = page.getByRole('textbox', { name: 'Message Codex' });
  await composer.fill('wait for the phone');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Steer', exact: true })).toBeVisible();
  await f.shared.request('test.deferSteers', { enabled: true });
  await composer.fill('Keep this visible on my phone.');
  await page.getByRole('button', { name: 'Steer', exact: true }).click();
  await expect(page.locator('.steering-text')).toHaveText('Keep this visible on my phone.');
  await expect(page.getByRole('region', { name: 'Submitted steering' })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: 'test-results/remote/phone-steering.png' });
  const boot = await page.evaluate(() => window.codexDesk!.request<Bootstrap>('bootstrap'));
  const threadId = boot.settings.lastThreadId;
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.locator('.remote-offline')).toBeVisible();
  await f.shared.request('test.deliverSteers', { threadId });
  await f.shared.request('test.finishTurn', { threadId });
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('.remote-offline')).toHaveCount(0);
  await expect(page.locator('.steering-queue')).toHaveCount(0);
  await expect(page.locator('.user-text').last()).toHaveText('Keep this visible on my phone.');
  await expect(page.locator('.markdown').last()).toContainText('deferred steering test completed');
  const history = (await f.service.handle('thread.read', { threadId })) as Thread;
  expect(history.turns).toHaveLength(1);
  expect(history.turns[0].items.filter((i) => i.type === 'userMessage')).toHaveLength(2);
  await page.reload();
  await expect(page.locator('.user-text').last()).toHaveText('Keep this visible on my phone.');
});

test('phone uploads images, handles approvals and goals, and returns to pairing after revocation', async ({
  page,
}) => {
  await pair(page);
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAL0lEQVR4nO3OIQEAAAgDMKJSG0UUiHEzMb+a3ksqAQEBAQEBAQEBAQEBAQGBdOABxQdctdynpFgAAAAASUVORK5CYII=';
  await page.getByRole('button', { name: 'Add and tools', exact: true }).click();
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Attach images', exact: true }).click();
  await (
    await picker
  ).setFiles({ name: 'phone.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.locator('.image-attachments img')).toHaveCount(1);
  const composer = page.getByRole('textbox', { name: 'Message Codex' });
  await composer.fill('approval from phone');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.approval-card')).toContainText('npm test');
  await page.locator('.approval-card').getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect(page.locator('.approval-card')).toHaveCount(0);
  await expect(page.locator('.markdown')).toContainText('Decision: accept');
  const boot = await page.evaluate(() => window.codexDesk!.request<Bootstrap>('bootstrap'));
  const thread = (await f.service.handle('thread.read', { threadId: boot.settings.lastThreadId })) as Thread;
  expect(JSON.stringify(thread.turns)).toContain('localImage');
  await composer.fill('/goal');
  await composer.press('Enter');
  await page.getByRole('textbox', { name: 'Objective', exact: true }).fill('Finish the phone workflow');
  await page.getByRole('button', { name: 'Start goal', exact: true }).click();
  await expect(page.locator('.mobile-header .goal-badge')).toContainText('Goal');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  expect(
    JSON.stringify(await f.service.handle('goal.get', { threadId: boot.settings.lastThreadId })),
  ).toContain('Finish the phone workflow');
  await f.gateway.revoke(f.gateway.status.devices[0].id);
  await expect(page.getByRole('button', { name: 'Pair and connect' })).toBeVisible();
});
