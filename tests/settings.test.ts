import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DeskService } from '../electron/service';
test('independent preference edits and thread selection preserve language and CLI paths', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'desk-settings-'));
  try {
    const service = new DeskService(root);
    await service.init();
    await service.handle('settings.update', {
      locale: 'en',
      binaryPath: '/custom/bin/codex',
      lastProjectId: 'project',
    });
    await service.handle('settings.update', { theme: 'light' });
    await service.handle('settings.update', { lastThreadId: 'thread' });
    const reloaded = new DeskService(root);
    await reloaded.init();
    assert.deepEqual(reloaded.store.state.settings, {
      locale: 'en',
      theme: 'light',
      binaryPath: '/custom/bin/codex',
      codexHome: '',
      lastProjectId: 'project',
      lastThreadId: 'thread',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
