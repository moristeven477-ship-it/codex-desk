import { test, expect, type Page } from '@playwright/test';
import { remoteFixture } from '../fixtures/remote';
import type { Thread, Bootstrap } from '../../src/shared/types';

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
  await expect(page.getByRole('heading', { name: 'What shall we build today?' })).toBeVisible();
  await expect(page.locator('.remote-offline')).toHaveCount(0);
}
test('phone pairs, sends, chooses settings, browses history and opens the real CLI panel', async ({
  page,
}) => {
  await pair(page);
  const composer = page.getByRole('textbox', { name: 'Message Codex' });
  await expect(composer).toBeInViewport();
  await page.getByRole('radio', { name: /YOLO/ }).check();
  await composer.fill('Hello from Android.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.user-text')).toHaveText('Hello from Android.');
  await expect(page.locator('.markdown')).toContainText('Your local Codex conversation is working.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/remote/phone-chat.png' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Language' }).selectOption('zh');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  expect(f.service.store.state.settings.locale).toBe('en');
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await page.getByRole('button', { name: /Understand the project/ }).click();
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect(page.locator('.markdown')).toContainText('This is Atlas');
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
  await expect(page.locator('.goal-badge')).toContainText('Pursuing goal');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  expect(
    JSON.stringify(await f.service.handle('goal.get', { threadId: boot.settings.lastThreadId })),
  ).toContain('Finish the phone workflow');
  await f.gateway.revoke(f.gateway.status.devices[0].id);
  await expect(page.getByRole('button', { name: 'Pair and connect' })).toBeVisible();
});
