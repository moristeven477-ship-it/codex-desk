import type { CodexEvent } from './types';

export interface CompletionNotice {
  threadId: string;
  turnId: string;
  failed: boolean;
}

export class CompletionTracker {
  private seen = new Set<string>();
  receive(event: CodexEvent): CompletionNotice | undefined {
    if (event.kind !== 'notification' || event.method !== 'turn/completed') return;
    const threadId = event.params?.threadId;
    const turn = event.params?.turn as { id?: string; status?: string } | undefined;
    if (typeof threadId !== 'string' || !turn?.id || !['completed', 'failed'].includes(turn.status || ''))
      return;
    const key = `${threadId}:${turn.id}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value!);
    return { threadId, turnId: turn.id, failed: turn.status === 'failed' };
  }
}
