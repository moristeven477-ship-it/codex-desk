import type { CodexEvent, Item, Thread, Turn } from './types';

export interface PendingSteer {
  clientId: string;
  threadId: string;
  turnId: string;
  text: string;
  images: string[];
  phase: 'sending' | 'submitted' | 'unconfirmed';
}

export const STEERING_STORAGE_KEY = 'codex-desk:pending-steers';

export function readPendingSteers(raw: string | null): PendingSteer[] {
  try {
    const entries: unknown = JSON.parse(raw || '[]');
    if (!Array.isArray(entries)) return [];
    return entries
      .filter(
        (entry): entry is PendingSteer =>
          !!entry &&
          typeof entry === 'object' &&
          ['clientId', 'threadId', 'turnId'].every(
            (key) => typeof entry[key] === 'string' && entry[key].length > 0,
          ) &&
          typeof entry.text === 'string' &&
          Array.isArray(entry.images) &&
          entry.images.every((p: unknown) => typeof p === 'string') &&
          ['sending', 'submitted', 'unconfirmed'].includes(entry.phase),
      )
      .map((entry) => ({ ...entry, phase: entry.phase === 'sending' ? 'unconfirmed' : entry.phase }));
  } catch {
    return [];
  }
}

export function setSteerPhase(entries: PendingSteer[], clientId: string, phase: PendingSteer['phase']) {
  if (
    phase === 'submitted' &&
    entries.some((entry) => entry.clientId === clientId && entry.phase === 'unconfirmed')
  )
    return entries;
  if (!entries.some((entry) => entry.clientId === clientId && entry.phase !== phase)) return entries;
  return entries.map((entry) => (entry.clientId === clientId ? { ...entry, phase } : entry));
}

function reconcile(entries: PendingSteer[], threadId: string, items: Item[], ended: string[]) {
  const received = new Set(
    items.filter((item) => item.type === 'userMessage' && item.clientId).map((item) => item.clientId),
  );
  let changed = false;
  const next: PendingSteer[] = [];
  for (const entry of entries) {
    if (entry.threadId !== threadId) {
      next.push(entry);
      continue;
    }
    if (received.has(entry.clientId)) {
      changed = true;
      continue;
    }
    if (ended.includes(entry.turnId) && entry.phase !== 'unconfirmed') {
      next.push({ ...entry, phase: 'unconfirmed' });
      changed = true;
    } else next.push(entry);
  }
  return changed ? next : entries;
}

export function reconcileSteerHistory(entries: PendingSteer[], thread: Thread) {
  return reconcile(
    entries,
    thread.id,
    thread.turns.flatMap((turn) => turn.items),
    thread.turns.filter((turn) => turn.status !== 'inProgress').map((turn) => turn.id),
  );
}

export function reconcileSteerEvent(entries: PendingSteer[], event: CodexEvent) {
  const p = event.params;
  if (!entries.length || !p?.threadId) return entries;
  if (event.method === 'item/started' || event.method === 'item/completed')
    return reconcile(entries, String(p.threadId), [p.item as Item], []);
  if (event.method === 'turn/completed') {
    const turn = p.turn as Turn;
    return reconcile(entries, String(p.threadId), turn.items ?? [], [turn.id]);
  }
  return entries;
}
