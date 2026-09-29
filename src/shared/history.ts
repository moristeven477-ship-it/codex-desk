import type { Thread, Turn } from './types';

export const RECENT_TURNS = 2;
export const RECENT_ITEMS = 20;

export function mergeRecentTurn(previous: Turn | undefined, incoming: Turn): Turn {
  if (!previous || !incoming.nextItemsCursor || !incoming.items.length) return incoming;
  const boundary = previous.items.findIndex((item) => item.id === incoming.items[0].id);
  if (boundary <= 0) return incoming;
  const freshIds = new Set(incoming.items.map((item) => item.id));
  return {
    ...incoming,
    items: [...previous.items.slice(0, boundary).filter((item) => !freshIds.has(item.id)), ...incoming.items],
    nextItemsCursor: previous.nextItemsCursor,
    itemsView: previous.nextItemsCursor ? 'summary' : 'full',
  };
}

export interface HistoryStorage {
  read<T>(key: string): Promise<T | undefined>;
  write(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  stats(): Promise<{ available: boolean; bytes: number; conversations: number; limit: number }>;
}

/** A new CLI page replaces the overlapping range, including edits and removals.
 * Keep previously downloaded older pages only when their boundary still exists. */
export function mergeHistory(previous: Thread | undefined, incoming: Thread): Thread {
  if (!previous || previous.id !== incoming.id) return incoming;
  const turns = incoming.turns.map((turn) =>
    mergeRecentTurn(
      previous.turns.find((old) => old.id === turn.id),
      turn,
    ),
  );
  const hydrated = turns.every((turn, index) => turn === incoming.turns[index])
    ? incoming
    : { ...incoming, turns };
  if (!incoming.nextTurnsCursor || !turns.length) return hydrated;
  const boundary = previous.turns.findIndex((turn) => turn.id === incoming.turns[0].id);
  if (boundary <= 0) return hydrated;
  const freshIds = new Set(incoming.turns.map((turn) => turn.id));
  return {
    ...incoming,
    turns: [...previous.turns.slice(0, boundary).filter((turn) => !freshIds.has(turn.id)), ...turns],
    nextTurnsCursor: previous.nextTurnsCursor,
  };
}
