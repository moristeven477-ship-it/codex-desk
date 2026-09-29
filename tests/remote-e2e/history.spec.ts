import { test, expect, type Page } from '@playwright/test';
import { remoteFixture } from '../fixtures/remote';
import type { Bootstrap, Thread } from '../../src/shared/types';

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
async function selectHistory(page: Page, title = 'Understand the project') {
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  await page.locator('.thread-row').filter({ hasText: title }).click();
}
async function saved(page: Page, id: string) {
  await expect
    .poll(() =>
      page.evaluate(
        async (id) => !!(await window.codexDesk?.historyStorage?.read<Thread>(`thread:${id}`))?.turns.length,
        id,
      ),
    )
    .toBe(true);
}
async function settings(page: Page) {
  await page.getByRole('button', { name: 'Conversation actions', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test('persistent phone history appears before session, bootstrap and history requests finish; CLI updates replace it', async ({
  page,
}) => {
  await pair(page);
  await selectHistory(page);
  await expect(page.locator('.user-text')).toHaveText('Explain this project.');
  await saved(page, 'fixture-history');
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await window.codexDesk?.historyStorage?.read<Bootstrap>('bootstrap'))?.settings.lastThreadId,
      ),
    )
    .toBe('fixture-history');
  await page.goto('about:blank');
  await f.service.handle('turn.start', {
    threadId: 'fixture-history',
    text: 'A newer message from the computer.',
  });
  await expect
    .poll(
      async () =>
        ((await f.service.handle('thread.open', { threadId: 'fixture-history' })) as Thread).turns.at(-1)
          ?.status,
    )
    .toBe('completed');
  const network = gate(),
    goal = gate();
  const requests: string[] = [];
  await page.route('**/v1/session', async (route) => {
    await network.promise;
    await route.continue();
  });
  await page.route('**/v1/rpc', async (route) => {
    const { method } = route.request().postDataJSON();
    requests.push(method);
    if (['bootstrap', 'thread.open', 'threads.list'].includes(method)) await network.promise;
    if (method === 'goal.get') await goal.promise;
    await route.continue();
  });
  try {
    const start = Date.now();
    await page.goto(f.gateway.status.localOrigin);
    await expect(page.locator('.user-text')).toHaveText('Explain this project.', { timeout: 3000 });
    console.log(
      `Cached conversation visible in ${Date.now() - start} ms with session/bootstrap/history held.`,
    );
    await expect(page.locator('.history-sync-status')).toBeVisible();
    await page.screenshot({ path: 'test-results/remote/history-from-phone.png', animations: 'disabled' });
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    await expect(page.locator('.thread-row').filter({ hasText: 'Understand the project' })).toBeVisible();
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
    network.release();
    await expect(page.locator('.user-text')).toHaveText([
      'Explain this project.',
      'A newer message from the computer.',
    ]);
    await expect(page.locator('.history-sync-status')).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Message Codex' }).fill('Ready after authoritative history.');
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
    expect(requests.filter((method) => method === 'bootstrap')).toHaveLength(1);
    expect(requests.filter((method) => method === 'thread.open')).toHaveLength(1);
    expect(requests).toContain('goal.get'); // The slow goal did not hold up the chat.
  } finally {
    network.release();
    goal.release();
  }
});

test('switching back shows cached messages while a slow read runs and late reads cannot change the selected conversation', async ({
  page,
}) => {
  await pair(page);
  const input = page.getByRole('textbox', { name: 'Message Codex' });
  await input.fill('Second cached conversation.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.user-text')).toHaveText('Second cached conversation.');
  const id = await page.evaluate(
    async () => (await window.codexDesk!.request<Bootstrap>('bootstrap')).settings.lastThreadId,
  );
  await f.service.handle('thread.rename', { threadId: id, name: 'Second conversation' });
  await saved(page, id);
  await selectHistory(page);
  await expect(page.locator('.user-text')).toHaveText('Explain this project.');
  await saved(page, 'fixture-history');
  const slow = gate();
  await page.route('**/v1/rpc', async (route) => {
    const { method, params } = route.request().postDataJSON();
    if (method === 'thread.open' && params.threadId === id) await slow.promise;
    await route.continue();
  });
  try {
    await selectHistory(page, 'Second conversation');
    await expect(page.locator('.user-text')).toHaveText('Second cached conversation.', { timeout: 1500 });
    await expect(page.locator('.history-sync-status')).toBeVisible();
    await selectHistory(page);
    await expect(page.locator('.user-text')).toHaveText('Explain this project.');
    slow.release();
    await expect(page.locator('.history-sync-status')).toHaveCount(0);
    await expect(page.locator('.mobile-header-title')).toContainText('Understand the project');
    await expect(page.locator('.user-text')).toHaveText('Explain this project.');
  } finally {
    slow.release();
  }
});

test('clearing phone storage preserves drafts and computer history; unpairing erases the old pairing cache', async ({
  page,
}) => {
  await pair(page);
  await selectHistory(page);
  await saved(page, 'fixture-history');
  await page.getByRole('textbox', { name: 'Message Codex' }).fill('Keep this local draft.');
  await settings(page);
  await page.screenshot({ path: 'test-results/remote/phone-storage-settings.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Clear history cache', exact: true }).click();
  await expect
    .poll(() => page.evaluate(async () => (await window.codexDesk?.historyStorage?.stats())?.bytes))
    .toBe(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.user-text')).toHaveText('Explain this project.');
  await expect(page.getByRole('textbox', { name: 'Message Codex' })).toHaveValue('Keep this local draft.');
  expect(
    ((await f.service.handle('thread.open', { threadId: 'fixture-history' })) as Thread).turns,
  ).toHaveLength(1);
  await page.reload();
  await expect(page.locator('.user-text')).toHaveText('Explain this project.');
  await saved(page, 'fixture-history');
  const oldSession = await page.evaluate(
    () => JSON.parse(localStorage.getItem('codex-desk:phone-session')!).id as string,
  );
  await settings(page);
  await page.getByRole('button', { name: 'Sign out and unpair this device', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pair and connect' })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        async (id) =>
          new Promise<number>((resolve, reject) => {
            const request = indexedDB.open(`codex-desk-history-${id}`);
            request.onsuccess = () => {
              const db = request.result;
              const count = db.transaction('meta').objectStore('meta').count();
              count.onsuccess = () => {
                resolve(count.result);
                db.close();
              };
              count.onerror = () => reject(count.error);
            };
          }),
        oldSession,
      ),
    )
    .toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('codex-desk:phone-session'))).toBeNull();
  await page.getByRole('textbox', { name: 'Pairing code', exact: true }).fill(f.gateway.createPairing().code);
  await page.getByRole('button', { name: 'Pair and connect' }).click();
  await expect(page.getByRole('heading', { name: 'What’s on your mind?' })).toBeVisible();
  const newSession = await page.evaluate(
    () => JSON.parse(localStorage.getItem('codex-desk:phone-session')!).id as string,
  );
  expect(newSession).not.toBe(oldSession);
  await expect(page.locator('.user-text')).toHaveCount(0);
});

test('storage limits evict least-recently-used histories and malformed snapshots fall back safely', async ({
  page,
}) => {
  await pair(page);
  const counts = await page.evaluate(async () => {
    const store = window.codexDesk!.historyStorage!;
    await store.clear();
    const thread = (id: string, preview = ''): Thread => ({
      id,
      preview,
      cwd: '/synthetic',
      turns: [],
      createdAt: 0,
      updatedAt: 0,
      status: { type: 'idle' },
    });
    for (let i = 0; i < 80; i++) await store.write(`thread:cache-${i}`, thread(`cache-${i}`));
    await store.read('thread:cache-0');
    await store.write('thread:cache-80', thread('cache-80'));
    const limited = await store.stats();
    const recent = !!(await store.read('thread:cache-0'));
    const evicted = await store.read('thread:cache-1');
    for (let i = 0; i < 3; i++)
      await store.write(`thread:large-${i}`, thread(`large-${i}`, 'x'.repeat(18 * 1024 * 1024)));
    const bounded = await store.stats();
    const oldestLarge = await store.read('thread:large-0');
    await store.write('thread:broken', { wrong: true });
    const broken = await store.read('thread:broken');
    return {
      count: limited.conversations,
      recent,
      evicted: evicted === undefined,
      bytes: bounded.bytes,
      limit: bounded.limit,
      oldestLarge: oldestLarge === undefined,
      broken: broken === undefined,
    };
  });
  expect(counts.count).toBe(80);
  expect(counts.recent).toBe(true);
  expect(counts.evicted).toBe(true);
  expect(counts.bytes).toBeLessThanOrEqual(counts.limit);
  expect(counts.oldestLarge).toBe(true);
  expect(counts.broken).toBe(true);
});

test('unavailable persistent storage does not block online conversations', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      get() {
        throw new DOMException('Storage disabled', 'SecurityError');
      },
    });
  });
  await pair(page);
  await selectHistory(page);
  await expect(page.locator('.user-text')).toHaveText('Explain this project.');
  await settings(page);
  await expect(
    page.getByText('Local storage is unavailable. Conversations still load from the computer.'),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('a cached empty conversation keeps its welcome screen and startup controls after reopening', async ({
  page,
}) => {
  await pair(page);
  let id = '';
  await expect
    .poll(async () => {
      id = await page.evaluate(
        async () =>
          (await window.codexDesk?.historyStorage?.read<Bootstrap>('bootstrap'))?.settings.lastThreadId || '',
      );
      return id;
    })
    .not.toBe('');
  await expect
    .poll(() =>
      page.evaluate(
        async (id) => (await window.codexDesk?.historyStorage?.read<Thread>(`thread:${id}`))?.turns.length,
        id,
      ),
    )
    .toBe(0);
  const bootstrap = gate();
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().method === 'bootstrap') await bootstrap.promise;
    await route.continue();
  });
  try {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'What’s on your mind?' })).toBeVisible();
    bootstrap.release();
    await expect(page.locator('.mobile-header-title .status-dot')).not.toHaveClass(/offline/);
    expect(
      await page.evaluate(
        async () => (await window.codexDesk!.request<Bootstrap>('bootstrap')).settings.lastThreadId,
      ),
    ).toBe(id);
    await page
      .getByRole('textbox', { name: 'Message Codex' })
      .fill('First message in the restored empty conversation.');
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator('.user-text')).toHaveText('First message in the restored empty conversation.');
  } finally {
    bootstrap.release();
  }
});
