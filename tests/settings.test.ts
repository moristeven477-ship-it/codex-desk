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
    await service.handle('settings.update', { fontSize: 18.37 });
    await assert.rejects(service.handle('settings.update', { fontSize: 0 }));
    await assert.rejects(service.handle('settings.update', { fontSize: 99 }));
    await assert.rejects(service.handle('settings.update', { fontSize: Number.NaN }));
    await service.handle('settings.update', { lastThreadId: 'thread' });
    const reloaded = new DeskService(root);
    await reloaded.init();
    assert.deepEqual(reloaded.store.state.settings, {
      locale: 'en',
      theme: 'light',
      fontSize: 18.37,
      binaryPath: '/custom/bin/codex',
      codexHome: '',
      defaultWorkspace: '',
      lastProjectId: 'project',
      lastThreadId: 'thread',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
