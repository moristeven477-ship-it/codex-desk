import type { NativeBridge, CodexEvent, ImageUpload, ImageAttachment, JsonObject } from '../shared/types';
import { PhoneHistoryStorage, type PhoneSession } from './historyStorage';

export class RemoteBridge implements NativeBridge {
  readonly remote = true;
  readonly historyStorage?: PhoneHistoryStorage;
  private reads = new Map<string, Promise<unknown>>();
  private readControllers = new Set<AbortController>();
  private listeners = new Set<(event: CodexEvent) => void>();
  private socket?: WebSocket;
  private timer?: ReturnType<typeof setTimeout>;
  private online = false;
  private closed = false;
  private retry = 0;
  constructor(session?: PhoneSession) {
    if (session) this.historyStorage = new PhoneHistoryStorage(session);
    this.connect();
    window.addEventListener('online', this.wake);
    window.addEventListener('offline', this.lost);
    document.addEventListener('visibilitychange', this.visible);
  }
  private visible = () => {
    if (document.visibilityState === 'visible') this.wake();
  };
  private lost = () => {
    this.cancelReads();
    clearTimeout(this.timer);
    const old = this.socket;
    this.socket = undefined;
    old?.close();
    this.online = false;
    this.emit({ kind: 'remote', online: false });
  };
  private wake = () => {
    this.lost();
    this.connect();
  };
  private cancelReads() {
    for (const controller of this.readControllers) controller.abort();
    this.readControllers.clear();
    this.reads.clear();
  }
  private emit(event: CodexEvent) {
    for (const listener of this.listeners) listener(event);
  }
  private connect() {
    if (this.closed) return;
    const socket = new WebSocket(
      `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/v1/events`,
    );
    this.socket = socket;
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      const data = JSON.parse(String(event.data)) as CodexEvent;
      if (data.kind === 'remote') {
        this.online = !!data.online;
        this.retry = 0;
      }
      this.emit(data);
    };
    socket.onclose = () => {
      if (this.closed || this.socket !== socket) return;
      this.cancelReads();
      this.online = false;
      this.emit({ kind: 'remote', online: false });
      void fetch('/v1/session', { signal: AbortSignal.timeout(5000) })
        .then((response) => {
          if (!this.closed && response.status === 401) window.dispatchEvent(new Event('desk:pair-required'));
        })
        .catch(() => {});
      this.timer = setTimeout(() => this.connect(), Math.min(15_000, 700 * 2 ** this.retry++));
    };
    socket.onerror = () => socket.close();
  }
  dispose() {
    this.closed = true;
    this.cancelReads();
    clearTimeout(this.timer);
    this.socket?.close();
    window.removeEventListener('online', this.wake);
    window.removeEventListener('offline', this.lost);
    document.removeEventListener('visibilitychange', this.visible);
  }
  subscribe(listener: (event: CodexEvent) => void) {
    this.listeners.add(listener);
    queueMicrotask(() => {
      if (this.listeners.has(listener)) listener({ kind: 'remote', online: this.online });
    });
    return () => {
      this.listeners.delete(listener);
    };
  }
  private async post(url: string, body: unknown, signal?: AbortSignal) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
          : AbortSignal.timeout(120_000),
      });
    } catch {
      if (signal?.aborted) throw new DOMException('Read superseded by reconnect', 'AbortError');
      throw new Error(
        '连接中断，请查看会话确认是否已接收；未自动重发。 / Connection lost. Check the conversation before sending again; input was not automatically resent.',
      );
    }
    if (response.status === 401) {
      if (!this.closed) window.dispatchEvent(new Event('desk:pair-required'));
      throw new Error('请重新配对 / Pair this device again.');
    }
    const result = await response.json();
    if (signal?.aborted) throw new DOMException('Read superseded by reconnect', 'AbortError');
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    return result;
  }
  async request<T = unknown>(method: string, params: JsonObject = {}): Promise<T> {
    const coalesce = [
      'bootstrap',
      'threads.list',
      'thread.open',
      'thread.read',
      'thread.older',
      'thread.items',
      'goal.get',
    ].includes(method);
    const key = JSON.stringify([method, params]);
    const pending = coalesce && this.reads.get(key);
    if (pending) return pending as Promise<T>;
    const controller = coalesce ? new AbortController() : undefined;
    if (controller) this.readControllers.add(controller);
    const operation = this.post(
      '/v1/rpc',
      { id: crypto.randomUUID(), method, params },
      controller?.signal,
    ).then((result) => {
      if (!result.ok) throw new Error(result.error);
      return result.value as T;
    });
    if (coalesce) this.reads.set(key, operation);
    try {
      return await operation;
    } finally {
      if (controller) this.readControllers.delete(controller);
      if (this.reads.get(key) === operation) this.reads.delete(key);
    }
  }
  async pickDirectory() {
    return window.prompt('电脑上的项目绝对路径 / Absolute project path on the computer', '')?.trim() || null;
  }
  async pickImages(): Promise<ImageAttachment[]> {
    const files = await new Promise<File[]>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.onchange = () => resolve([...(input.files ?? [])]);
      input.oncancel = () => resolve([]);
      input.click();
    });
    return this.importImages(
      await Promise.all(
        files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })),
      ),
    );
  }
  async importImages(images: ImageUpload[]) {
    if (images.length > 8 || images.some((i) => i.bytes.length > 20 * 1024 * 1024))
      throw new Error('最多 8 张图片，每张 20 MiB / Up to 8 images, 20 MiB each.');
    const result: ImageAttachment[] = [];
    for (const image of images) {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Could not read image.'));
        reader.readAsDataURL(new Blob([new Uint8Array(image.bytes)]));
      });
      result.push(...(await this.post('/v1/images', { name: image.name, base64 })));
    }
    return result;
  }
  async copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Android WebView versions differ in async clipboard support.
      const input = document.createElement('textarea');
      input.value = text;
      input.style.cssText = 'position:fixed;top:0;left:-10000px';
      document.body.append(input);
      const focused = document.activeElement as HTMLElement | null;
      input.select();
      const copied = document.execCommand('copy');
      input.remove();
      focused?.focus();
      if (!copied) throw new Error('无法复制，请长按选择文字 / Could not copy. Long press to select text.');
    }
  }
  async openExternal(value: string) {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Only web links can be opened.');
    window.open(url.href, '_blank', 'noopener,noreferrer');
  }
  async openTerminal(threadId: string) {
    window.dispatchEvent(new CustomEvent('desk:terminal', { detail: threadId }));
  }
  async prepareTerminal(): Promise<{ state: 'waiting' }> {
    return { state: 'waiting' };
  }
  async windowAction() {}
}
