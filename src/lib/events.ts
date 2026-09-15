import type { CodexEvent, Item, Thread, Turn } from '../shared/types';

export function reduceThread(thread: Thread, event: CodexEvent): Thread {
  const p = event.params;
  if (!p || p.threadId !== thread.id) return thread;
  if (event.method === 'thread/status/changed') return { ...thread, status: p.status as Thread['status'] };
  if (event.method === 'thread/name/updated')
    return { ...thread, name: String(p.threadName ?? p.name ?? thread.name ?? '') };
  let turns = [...(thread.turns ?? [])];
  if (event.method === 'turn/started' || event.method === 'turn/completed') {
    const turn = p.turn as Turn;
    const existing = turns.findIndex((t) => t.id === turn.id);
    if (existing < 0) turns.push({ ...turn, items: turn.items ?? [] });
    else
      turns[existing] = {
        ...turns[existing],
        ...turn,
        items: turn.items?.length ? turn.items : turns[existing].items,
      };
    return {
      ...thread,
      turns,
      status: { type: event.method === 'turn/started' ? 'active' : 'idle' },
      updatedAt: Date.now() / 1000,
    };
  }
  const turnId = String(p.turnId ?? '');
  if (!turnId || !event.method?.startsWith('item/')) return thread;
  let turnIndex = turns.findIndex((t) => t.id === turnId);
  if (turnIndex < 0) {
    turns.push({ id: turnId, items: [], status: 'inProgress' });
    turnIndex = turns.length - 1;
  }
  const turn = { ...turns[turnIndex], items: [...turns[turnIndex].items] };
  if (event.method === 'item/started' || event.method === 'item/completed') {
    const item = p.item as Item;
    if (!item?.id) return thread;
    const index = turn.items.findIndex((i) => i.id === item.id);
    if (index < 0) turn.items.push(item);
    else turn.items[index] = { ...turn.items[index], ...item };
  } else if (event.method.endsWith('/delta') || event.method.endsWith('Delta')) {
    const id = String(p.itemId ?? '');
    if (!id) return thread;
    let index = turn.items.findIndex((i) => i.id === id);
    const category = event.method.split('/')[1];
    if (index < 0) {
      turn.items.push({ id, type: category, status: 'inProgress' });
      index = turn.items.length - 1;
    }
    const item = { ...turn.items[index] };
    const delta = String(p.delta ?? '');
    if (category === 'agentMessage' || category === 'plan') item.text = (item.text ?? '') + delta;
    else if (category === 'commandExecution') item.aggregatedOutput = (item.aggregatedOutput ?? '') + delta;
    else if (category === 'reasoning') {
      const field = event.method.includes('summary') ? 'summary' : 'content';
      const parts = [...((item[field] ?? []) as string[])];
      const partIndex = Number(p.summaryIndex ?? p.contentIndex ?? 0);
      parts[partIndex] = (parts[partIndex] ?? '') + delta;
      item[field] = parts;
    }
    turn.items[index] = item;
  } else return thread;
  turns[turnIndex] = turn;
  return { ...thread, turns };
}

export function threadTitle(thread: Thread, fallback = 'New conversation') {
  return thread.name?.trim() || thread.preview?.trim().split('\n')[0].slice(0, 90) || fallback;
}
export function activeTurn(thread?: Thread) {
  return thread?.status.type === 'active'
    ? thread.turns.findLast((t) => t.status === 'inProgress')
    : undefined;
}
