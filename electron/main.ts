import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell, Menu, Notification } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, stat } from 'node:fs/promises';
import { DeskService } from './service';
import { openTerminal, type TerminalCommand } from './terminal';
import { importImages } from './images';
import { CompletionTracker } from '../src/shared/completion';

let window: BrowserWindow | null = null;
let service: DeskService;
const devURL = !app.isPackaged ? process.env.CODEX_DESK_DEV_URL : undefined;
const rendererFile = path.join(__dirname, '../dist/index.html');
const allowedURL = devURL ?? pathToFileURL(rendererFile).href;
const t = (zh: string, en: string) => (service?.store.state.settings.locale === 'zh' ? zh : en);

function trusted(event: Electron.IpcMainInvokeEvent) {
  const frameURL = event.senderFrame?.url;
  if (
    !window ||
    event.sender.id !== window.webContents.id ||
    event.senderFrame !== window.webContents.mainFrame ||
    !frameURL
  )
    throw new Error('Untrusted renderer.');
  const actual = new URL(frameURL),
    allowed = new URL(allowedURL);
  if (
    actual.protocol !== allowed.protocol ||
    actual.host !== allowed.host ||
    actual.pathname !== allowed.pathname
  )
    throw new Error('Untrusted frame URL.');
}
async function openURL(url: string) {
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol))
    throw new Error('Only HTTP and HTTPS links may be opened.');
  await shell.openExternal(parsed.href);
}

app.setName('Codex Desk');
if (process.env.CODEX_DESK_USER_DATA) app.setPath('userData', path.resolve(process.env.CODEX_DESK_USER_DATA));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      service = new DeskService(app.getPath('userData'));
      await service.init();
      // Permit headless integration tests to select a fake CLI without touching user preferences.
      if (!app.isPackaged && process.env.CODEX_DESK_TEST_BINARY)
        service.store.state.settings.binaryPath = process.env.CODEX_DESK_TEST_BINARY;
      Menu.setApplicationMenu(null);
      window = new BrowserWindow({
        width: 1460,
        height: 980,
        minWidth: 880,
        minHeight: 640,
        title: 'Codex Desk',
        backgroundColor: '#151719',
        frame: false,
        show: false,
        icon: path.join(__dirname, '../assets/icon.png'),
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          spellcheck: false,
        },
      });
      const session = window.webContents.session;
      session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      session.setPermissionCheckHandler(() => false);
      window.webContents.setWindowOpenHandler(({ url }) => {
        void openURL(url).catch(() => {});
        return { action: 'deny' };
      });
      window.webContents.on('will-navigate', (event, url) => {
        if (url !== allowedURL) event.preventDefault();
      });
      window.webContents.on('will-attach-webview', (event) => event.preventDefault());
      const completions = new CompletionTracker();
      const notifications = new Set<Notification>();
      service.on('event', (event) => {
        if (window && !window.isDestroyed()) window.webContents.send('desk:event', event);
        const done = completions.receive(event);
        if (!done || !window || window.isFocused() || !Notification.isSupported()) return;
        const notification = new Notification({
          title: done.failed
            ? t('Codex Desk · 任务失败', 'Codex Desk · Task failed')
            : t('Codex Desk · 任务完成', 'Codex Desk · Task completed'),
          body: t('点击查看对应会话。', 'Click to view the conversation.'),
          icon: path.join(__dirname, '../assets/icon.png'),
        });
        notifications.add(notification);
        notification.on('click', () => {
          if (!window || window.isDestroyed()) return;
          if (window.isMinimized()) window.restore();
          window.show();
          window.focus();
          window.webContents.send('desk:event', { kind: 'navigate', threadId: done.threadId });
        });
        notification.on('close', () => notifications.delete(notification));
        notification.on('failed', () => notifications.delete(notification));
        notification.show();
      });

      ipcMain.handle('desk:request', async (event, method: unknown, params: unknown) => {
        trusted(event);
        if (typeof method !== 'string') throw new Error('Invalid operation.');
        try {
          return { ok: true, value: await service.handle(method, params ?? {}) };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      });
      ipcMain.handle('desk:open-terminal', async (event, threadId: unknown) => {
        trusted(event);
        const command = (await service.handle('thread.terminalCommand', { threadId })) as TerminalCommand;
        await openTerminal(command);
      });
      ipcMain.handle('desk:pick-directory', async (event) => {
        trusted(event);
        const result = await dialog.showOpenDialog(window!, {
          properties: ['openDirectory'],
          title: t('打开项目', 'Open a project'),
        });
        return result.canceled ? null : (result.filePaths[0] ?? null);
      });
      ipcMain.handle('desk:pick-images', async (event) => {
        trusted(event);
        const result = await dialog.showOpenDialog(window!, {
          properties: ['openFile', 'multiSelections'],
          title: t('添加图片', 'Attach images'),
          filters: [{ name: t('图片', 'Images'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
        });
        if (result.canceled) return [];
        if (result.filePaths.length > 8) throw new Error(t('最多选择 8 张图片。', 'Choose up to 8 images.'));
        const images = await Promise.all(
          result.filePaths.map(async (file) => {
            if ((await stat(file)).size > 20 * 1024 * 1024)
              throw new Error(t('每张图片须小于 20 MiB。', 'Images must be under 20 MiB.'));
            const image = nativeImage.createFromBuffer(await readFile(file));
            if (image.isEmpty())
              throw new Error(t('无法读取此图片格式。', 'This image format could not be read.'));
            return {
              path: file,
              name: path.basename(file),
              preview: image.resize({ width: 120 }).toDataURL(),
            };
          }),
        );
        service.authorizeImages(images.map((image) => image.path));
        return images;
      });
      ipcMain.handle('desk:import-images', async (event, uploads: unknown) => {
        trusted(event);
        try {
          const images = await importImages(path.join(app.getPath('userData'), 'attachments'), uploads, t);
          service.authorizeImages(images.map((image) => image.path));
          return { ok: true, value: images };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      });
      ipcMain.handle('desk:open-url', async (event, url: unknown) => {
        trusted(event);
        if (typeof url !== 'string' || url.length > 16_384) throw new Error('Invalid URL.');
        await openURL(url);
      });
      ipcMain.handle('desk:window', (event, action: unknown) => {
        trusted(event);
        if (action === 'minimize') window?.minimize();
        else if (action === 'maximize') {
          if (window?.isMaximized()) window.unmaximize();
          else window?.maximize();
        } else if (action === 'close') window?.close();
      });
      window.once('ready-to-show', () => window?.show());
      // Closing Desk disconnects its clients. The shared server keeps running.
      window.on('closed', () => {
        service.terminal.close();
        window = null;
      });
      if (devURL) await window.loadURL(devURL);
      else await window.loadFile(rendererFile);
    })
    .catch((error) => {
      dialog.showErrorBox('Codex Desk could not start', String(error));
      app.quit();
    });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (!service || service.codex.connection.phase === 'stopped') return;
    event.preventDefault();
    void service.codex.stop().then(() => app.quit());
  });
}
