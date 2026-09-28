import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DeskService } from '../../electron/service';
import { RemoteGateway } from '../../electron/remote';
// @ts-expect-error The shared fixture is a small JavaScript test server.
import { sharedFixture } from './shared-server.mjs';
export async function remoteFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'desk-phone-test-'));
  const project = path.join(root, 'atlas');
  await mkdir(project);
  await writeFile(path.join(project, 'README.md'), '# Atlas\nSynthetic remote workspace.');
  const shared = await sharedFixture(root, project);
  const service = new DeskService(path.join(root, 'desk'));
  await service.init();
  await service.handle('settings.update', {
    binaryPath: path.resolve('tests/fixtures/fake-codex.mjs'),
    codexHome: shared.home,
    defaultWorkspace: project,
    locale: 'en',
  });
  await service.connect();
  const gateway = new RemoteGateway({
    directory: path.join(root, 'remote'),
    assets: path.resolve('dist'),
    service,
    port: 0,
    importImages: async (images) => {
      if (
        images.length !== 1 ||
        Buffer.from(images[0].bytes).subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
      )
        throw new Error('Invalid fixture image.');
      const file = path.join(root, 'image.png');
      await writeFile(file, images[0].bytes, { mode: 0o600 });
      return [
        {
          path: file,
          name: images[0].name,
          preview: 'data:image/png;base64,' + Buffer.from(images[0].bytes).toString('base64'),
        },
      ];
    },
  });
  await gateway.init();
  await gateway.start();
  return {
    root,
    project,
    service,
    gateway,
    shared,
    close: async () => {
      await gateway.stop();
      await service.codex.stop();
      service.terminal.close();
      await shared.close();
      await rm(root, { force: true, recursive: true });
    },
  };
}
