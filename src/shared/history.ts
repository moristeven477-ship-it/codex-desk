import type { Thread } from './types';

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
  if (!previous || previous.id !== incoming.id || !incoming.nextTurnsCursor || !incoming.turns.length)
    return incoming;
  const boundary = previous.turns.findIndex((turn) => turn.id === incoming.turns[0].id);
  if (boundary <= 0) return incoming;
  const freshIds = new Set(incoming.turns.map((turn) => turn.id));
  return {
    ...incoming,
    turns: [...previous.turns.slice(0, boundary).filter((turn) => !freshIds.has(turn.id)), ...incoming.turns],
    nextTurnsCursor: previous.nextTurnsCursor,
  };
}
