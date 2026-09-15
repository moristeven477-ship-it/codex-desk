import { contextBridge, ipcRenderer } from 'electron';
import type { NativeBridge, CodexEvent } from '../src/shared/types';

const bridge: NativeBridge = {
  async request(method, params) {
    const response = await ipcRenderer.invoke('desk:request', method, params);
    if (!response.ok) throw new Error(response.error);
    return response.value;
  },
  subscribe(listener) {
    const handler = (_event: Electron.IpcRendererEvent, data: CodexEvent) => listener(data);
    ipcRenderer.on('desk:event', handler);
    return () => {
      ipcRenderer.removeListener('desk:event', handler);
    };
  },
  pickDirectory: () => ipcRenderer.invoke('desk:pick-directory'),
  pickImages: () => ipcRenderer.invoke('desk:pick-images'),
  openExternal: (url) => ipcRenderer.invoke('desk:open-url', url),
  openTerminal: (threadId) => ipcRenderer.invoke('desk:open-terminal', threadId),
  windowAction: (action) => ipcRenderer.invoke('desk:window', action),
};
contextBridge.exposeInMainWorld('codexDesk', bridge);
