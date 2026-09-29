import type { HistoryStorage } from '../shared/history';

export const HISTORY_LIMIT = 300 * 1024 * 1024;
const SNAPSHOT_LIMIT = 25 * 1024 * 1024;
const SESSION_KEY = 'codex-desk:phone-session';
export interface PhoneSession {
  id: string;
  name: string;
  expiresAt: number;
}
export function phoneSession(value: unknown): PhoneSession | undefined {
  const session = value as PhoneSession | undefined;
  if (
    session &&
    typeof session.id === 'string' &&
    /^[a-zA-Z0-9-]{1,100}$/.test(session.id) &&
    typeof session.name === 'string' &&
    typeof session.expiresAt === 'number' &&
    session.expiresAt > Date.now()
  )
    return session;
}
export function savedPhoneSession(): PhoneSession | undefined {
  try {
    return phoneSession(JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'));
  } catch {
    return undefined;
  }
}
export function rememberPhoneSession(session: PhoneSession) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* Optional storage. */
  }
}
export function forgetPhoneSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('codex-desk:drafts');
    localStorage.removeItem('codex-desk:pending-steers');
  } catch {
    /* Optional storage. */
  }
}

interface EntryMeta {
  key: string;
  bytes: number;
  usedAt: number;
}
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error);
  });
}
function validSnapshot(key: string, value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, any>;
  if (key === 'bootstrap')
    return (
      !!entry.settings &&
      typeof entry.settings.lastThreadId === 'string' &&
      typeof entry.settings.lastProjectId === 'string' &&
      ['zh', 'en'].includes(entry.settings.locale) &&
      ['light', 'dark'].includes(entry.settings.theme) &&
      typeof entry.settings.fontSize === 'number' &&
      Array.isArray(entry.projects) &&
      Array.isArray(entry.models)
    );
  if (key.startsWith('thread:'))
    return (
      entry.id === key.slice(7) &&
      typeof entry.cwd === 'string' &&
      typeof entry.status?.type === 'string' &&
      Array.isArray(entry.turns) &&
      entry.turns.every(
        (turn: Record<string, unknown>) => turn && typeof turn.id === 'string' && Array.isArray(turn.items),
      )
    );
  if (key.startsWith('list:'))
    return (
      Array.isArray(entry.data) &&
      entry.data.every(
        (thread: Record<string, unknown>) =>
          thread &&
          typeof thread.id === 'string' &&
          typeof thread.cwd === 'string' &&
          typeof (thread.status as { type?: unknown } | undefined)?.type === 'string',
      )
    );
  return false;
}

/** Phone-only, origin- and pairing-scoped storage. Never contains auth tokens,
 * queued sends or instructions to modify CLI state. Failures fall back to live reads. */
export class PhoneHistoryStorage implements HistoryStorage {
  private database?: Promise<IDBDatabase>;
  private writes = Promise.resolve();
  private generation = 0;
  private available = true;
  private invalidated = false;
  constructor(private session: PhoneSession) {}
  private db() {
    return (this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`codex-desk-history-${this.session.id}`, 1);
      let expired = false;
      const timer = setTimeout(() => {
        expired = true;
        reject(new Error('Storage unavailable'));
      }, 1500);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('data');
        request.result.createObjectStore('meta', { keyPath: 'key' });
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        if (expired) {
          request.result.close();
          return;
        }
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => {
        clearTimeout(timer);
        reject(request.error);
      };
    }));
  }
  async read<T>(key: string): Promise<T | undefined> {
    const generation = this.generation;
    if (this.invalidated || this.session.expiresAt <= Date.now()) return;
    try {
      const db = await this.db();
      const transaction = db.transaction(['data', 'meta'], 'readwrite');
      const done = complete(transaction);
      const request = transaction.objectStore('data').get(key);
      const meta = transaction.objectStore('meta').get(key);
      meta.onsuccess = () => {
        if (meta.result) transaction.objectStore('meta').put({ ...meta.result, usedAt: Date.now() });
      };
      const [value] = await Promise.all([result<string | undefined>(request), done]);
      if (generation === this.generation && !this.invalidated && value) {
        const parsed = JSON.parse(value);
        if (validSnapshot(key, parsed)) return parsed as T;
      }
    } catch {
      this.available = false;
    }
  }
  write(key: string, value: unknown): Promise<void> {
    const generation = this.generation;
    const operation = this.writes.then(async () => {
      if (this.invalidated || generation !== this.generation || this.session.expiresAt <= Date.now()) return;
      try {
        const json = JSON.stringify(value);
        const bytes = new Blob([json]).size;
        if (bytes > SNAPSHOT_LIMIT) return; // Bound individual JSON parsing work on the phone.
        const db = await this.db();
        if (generation !== this.generation || this.invalidated) return;
        const transaction = db.transaction(['data', 'meta'], 'readwrite');
        const done = complete(transaction);
        const meta = transaction.objectStore('meta'),
          data = transaction.objectStore('data');
        const all = meta.getAll();
        all.onsuccess = () => {
          const entries = (all.result as EntryMeta[])
            .filter((entry) => entry.key !== key)
            // Keep the tiny startup index until all ordinary snapshots are gone;
            // otherwise eviction would force a network bootstrap before any cache can show.
            .sort(
              (a, b) => Number(a.key === 'bootstrap') - Number(b.key === 'bootstrap') || a.usedAt - b.usedAt,
            );
          let total = entries.reduce((sum, entry) => sum + entry.bytes, bytes);
          let count =
            entries.filter((entry) => entry.key.startsWith('thread:')).length +
            Number(key.startsWith('thread:'));
          while (entries.length && (total > HISTORY_LIMIT || count > 80 || entries.length >= 120)) {
            const oldest = entries.shift()!;
            data.delete(oldest.key);
            meta.delete(oldest.key);
            total -= oldest.bytes;
            count -= Number(oldest.key.startsWith('thread:'));
          }
          data.put(json, key);
          meta.put({ key, bytes, usedAt: Date.now() } satisfies EntryMeta);
        };
        await done;
        this.available = true;
      } catch {
        this.available = false;
      }
    });
    this.writes = operation.catch(() => {});
    return this.writes;
  }
  async remove(key: string) {
    try {
      await this.writes;
      const db = await this.db();
      const transaction = db.transaction(['data', 'meta'], 'readwrite');
      const done = complete(transaction);
      transaction.objectStore('data').delete(key);
      transaction.objectStore('meta').delete(key);
      await done;
    } catch {
      this.available = false;
    }
  }
  async clear() {
    ++this.generation;
    window.dispatchEvent(new Event('desk:history-cleared'));
    try {
      await this.writes;
      const db = await this.db();
      const transaction = db.transaction(['data', 'meta'], 'readwrite');
      const done = complete(transaction);
      transaction.objectStore('data').clear();
      transaction.objectStore('meta').clear();
      await done;
    } catch {
      this.available = false;
    }
  }
  async invalidate() {
    this.invalidated = true;
    await this.clear();
  }
  async stats() {
    try {
      await this.writes;
      const db = await this.db();
      const entries: EntryMeta[] = await result(db.transaction('meta').objectStore('meta').getAll());
      return {
        available: this.available,
        bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
        conversations: entries.filter((entry) => entry.key.startsWith('thread:')).length,
        limit: HISTORY_LIMIT,
      };
    } catch {
      return { available: false, bytes: 0, conversations: 0, limit: HISTORY_LIMIT };
    }
  }
}
