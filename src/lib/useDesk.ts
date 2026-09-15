import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AccessMode,
  Approval,
  Bootstrap,
  CodexEvent,
  JsonObject,
  Project,
  Settings,
  Thread,
  Turn,
} from '../shared/types';
import { reduceThread } from './events';

export async function request<T = unknown>(method: string, params?: JsonObject): Promise<T> {
  if (!window.codexDesk) throw new Error('Open Codex Desk using the desktop application.');
  return window.codexDesk.request<T>(method, params);
}
const empty: Bootstrap = {
  projects: [],
  settings: {
    binaryPath: '',
    codexHome: '',
    locale: 'zh',
    theme: 'dark',
    lastProjectId: '',
    lastThreadId: '',
  },
  connection: { phase: 'stopped' },
  models: [],
  account: null,
  approvals: [],
  appVersion: '0.1.0',
};

export function useDesk() {
  const [boot, setBoot] = useState<Bootstrap>(empty);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [projectId, setProjectId] = useState('');
  const [threadId, setThreadId] = useState('');
  const [cache, setCache] = useState<Record<string, Thread>>({});
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [archived, setArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [usage, setUsage] = useState<Record<string, { total: number; context: number; limit: number }>>({});
  const [plans, setPlans] = useState<Record<string, { step: string; status: string }[]>>({});
  const current = useRef({ boot, projectId, threadId, archived, search });
  current.current = { boot, projectId, threadId, archived, search };
  const pendingEvents = useRef(new Map<string, CodexEvent[]>());
  const listGeneration = useRef(0);
  const selectionGeneration = useRef(0);
  const sendingRef = useRef(false);
  const fail = useCallback((e: unknown) => setError(e instanceof Error ? e.message : String(e)), []);

  const refresh = useCallback(
    async (append = false, nextCursor?: string | null) => {
      const snapshot = current.current;
      if (snapshot.boot.connection.phase !== 'ready') return;
      const generation = ++listGeneration.current;
      try {
        const project = snapshot.boot.projects.find((p) => p.id === snapshot.projectId);
        const result = await request<{ data: Thread[]; nextCursor: string | null }>('threads.list', {
          ...(project ? { cwd: project.path } : {}),
          archived: snapshot.archived,
          search: snapshot.search,
          cursor: append ? (nextCursor ?? null) : null,
        });
        if (generation !== listGeneration.current) return;
        setThreads((old) =>
          append ? [...old, ...result.data.filter((t) => !old.some((o) => o.id === t.id))] : result.data,
        );
        setCursor(result.nextCursor);
      } catch (e) {
        fail(e);
      }
    },
    [fail],
  );

  const openThread = useCallback(
    async (id: string) => {
      const generation = ++selectionGeneration.current;
      setThreadId(id);
      setLoading(true);
      const buffered: CodexEvent[] = [];
      pendingEvents.current.set(id, buffered);
      try {
        const thread = await request<Thread>('thread.read', { threadId: id });
        const hydrated = buffered.reduce(reduceThread, thread);
        if (generation !== selectionGeneration.current) return;
        setCache((old) => ({ ...old, [id]: hydrated }));
        void request('settings.update', { lastThreadId: id }).catch(fail);
      } catch (e) {
        if (generation === selectionGeneration.current) fail(e);
      } finally {
        if (pendingEvents.current.get(id) === buffered) pendingEvents.current.delete(id);
        if (generation === selectionGeneration.current) setLoading(false);
      }
    },
    [fail],
  );

  useEffect(() => {
    let disposed = false;
    const unsubscribe = window.codexDesk?.subscribe((event) => {
      if (disposed) return;
      if (event.kind === 'connection' && event.connection) {
        setBoot((old) => ({ ...old, connection: event.connection! }));
        if (event.connection.phase !== 'ready') {
          setApprovals([]);
          setCache((old) =>
            Object.fromEntries(
              Object.entries(old).map(([id, thread]) => [
                id,
                {
                  ...thread,
                  status: { type: 'notLoaded' },
                  turns: thread.turns.map((t) =>
                    t.status === 'inProgress' ? { ...t, status: 'interrupted' as const } : t,
                  ),
                },
              ]),
            ),
          );
        }
      }
      if (event.kind === 'request' && event.request)
        setApprovals((old) => [...old.filter((r) => r.id !== event.request!.id), event.request!]);
      if (event.kind === 'resolved') setApprovals((old) => old.filter((r) => r.id !== event.id));
      if (event.kind === 'notice' && event.message) setError(event.message);
      if (event.kind !== 'notification') return;
      const p = event.params ?? {};
      const id = p.threadId as string;
      if (id) {
        pendingEvents.current.get(id)?.push(event);
        setCache((old) => (old[id] ? { ...old, [id]: reduceThread(old[id], event) } : old));
        if (event.method === 'thread/tokenUsage/updated') {
          const u = p.tokenUsage as {
            total?: { totalTokens: number };
            last?: { totalTokens: number };
            modelContextWindow?: number;
          };
          setUsage((old) => ({
            ...old,
            [id]: {
              total: u.total?.totalTokens ?? 0,
              context: u.last?.totalTokens ?? 0,
              limit: u.modelContextWindow ?? 0,
            },
          }));
        }
        if (event.method === 'turn/plan/updated')
          setPlans((old) => ({ ...old, [id]: p.plan as { step: string; status: string }[] }));
      }
      if (
        ['turn/started', 'turn/completed', 'thread/name/updated', 'thread/started'].includes(
          event.method ?? '',
        )
      )
        void refresh();
      if (event.method === 'error') {
        const err = p.error as { message?: string } | undefined;
        if (!p.willRetry) setError(err?.message ?? 'Codex reported an error.');
      }
      if (event.method === 'account/login/completed') {
        if (p.success === false) setError(String(p.error ?? 'Login failed.'));
        else
          void request<{ account: Bootstrap['account'] }>('account.refresh')
            .then((r) => setBoot((old) => ({ ...old, account: r.account })))
            .catch(fail);
      }
    });
    void (async () => {
      try {
        let data = await request<Bootstrap>('bootstrap');
        if (disposed) return;
        setBoot(data);
        setProjectId(data.settings.lastProjectId);
        if (data.connection.phase !== 'ready') data = await request<Bootstrap>('codex.connect');
        if (disposed) return;
        setBoot(data);
        setApprovals(data.approvals);
        if (data.settings.lastThreadId) void openThread(data.settings.lastThreadId);
      } catch (e) {
        if (!disposed) fail(e);
      }
    })();
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [fail, openThread, refresh]);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), search ? 220 : 0);
    return () => clearTimeout(timer);
  }, [projectId, archived, search, boot.connection.phase, boot.projects, refresh]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 15_000);
    const focus = () => {
      void refresh();
    };
    window.addEventListener('focus', focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [refresh]);

  function selectProject(id: string) {
    ++selectionGeneration.current;
    setProjectId(id);
    setThreadId('');
    setLoading(false);
    setArchived(false);
    setSearch('');
    void request('settings.update', { lastProjectId: id, lastThreadId: '' }).catch(fail);
  }
  async function addProject(folder?: string) {
    try {
      const picked = folder ?? (await window.codexDesk?.pickDirectory());
      if (!picked) return;
      const project = await request<Project>('project.add', { path: picked });
      setBoot((old) => ({
        ...old,
        projects: old.projects.some((p) => p.id === project.id) ? old.projects : [...old.projects, project],
      }));
      selectProject(project.id);
      return project;
    } catch (e) {
      fail(e);
    }
  }
  async function removeProject(id: string) {
    try {
      await request('project.remove', { projectId: id });
      setBoot((old) => ({ ...old, projects: old.projects.filter((p) => p.id !== id) }));
      if (projectId === id) selectProject('');
    } catch (e) {
      fail(e);
    }
  }
  async function send(text: string, model: string, effort: string, access: AccessMode, images: string[]) {
    if (sendingRef.current) return false;
    sendingRef.current = true;
    setSending(true);
    setError('');
    try {
      let id = threadId;
      if (!id) {
        if (!projectId)
          throw new Error(
            boot.settings.locale === 'zh' ? '请先选择或打开一个项目。' : 'Choose or open a project first.',
          );
        const thread = await request<Thread>('thread.create', { projectId, model, access });
        id = thread.id;
        setThreadId(id);
        setCache((old) => ({ ...old, [id]: thread }));
        setThreads((old) => [thread, ...old]);
        await request('settings.update', { lastThreadId: id });
      }
      const { turn } = await request<{ turn: Turn }>('turn.start', {
        threadId: id,
        text,
        model,
        effort,
        access,
        images,
      });
      // Responses may arrive after turn/completed. Never regress a completed turn to inProgress.
      setCache((old) => {
        const existing = old[id];
        if (!existing) return old;
        if (existing.turns.some((t) => t.id === turn.id)) return old;
        return { ...old, [id]: { ...existing, turns: [...existing.turns, turn] } };
      });
      void refresh();
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }
  async function updateSettings(patch: Partial<Settings>) {
    const settings = await request<Settings>('settings.update', patch);
    setBoot((old) => ({ ...old, settings }));
  }
  async function reconnect() {
    setError('');
    const data = await request<Bootstrap>('codex.restart');
    setBoot(data);
    setApprovals(data.approvals);
    void refresh();
  }
  async function rename(id: string, name: string) {
    await request('thread.rename', { threadId: id, name });
    setThreads((old) => old.map((t) => (t.id === id ? { ...t, name } : t)));
    setCache((old) => (old[id] ? { ...old, [id]: { ...old[id], name } } : old));
  }
  async function archive(id: string, restore = false) {
    await request(restore ? 'thread.unarchive' : 'thread.archive', { threadId: id });
    if (id === threadId) {
      setThreadId('');
      void request('settings.update', { lastThreadId: '' }).catch(fail);
    }
    void refresh();
  }
  async function fork(id: string) {
    const thread = await request<Thread>('thread.fork', { threadId: id });
    setCache((old) => ({ ...old, [thread.id]: thread }));
    setThreadId(thread.id);
    await request('settings.update', { lastThreadId: thread.id });
    void refresh();
  }
  async function older() {
    const thread = cache[threadId];
    if (!thread?.nextTurnsCursor) return;
    const page = await request<{ data: Turn[]; nextCursor: string | null }>('thread.older', {
      threadId,
      cursor: thread.nextTurnsCursor,
    });
    setCache((old) => ({
      ...old,
      [threadId]: {
        ...old[threadId],
        turns: [
          ...page.data.reverse().filter((t) => !old[threadId].turns.some((o) => o.id === t.id)),
          ...old[threadId].turns,
        ],
        nextTurnsCursor: page.nextCursor,
      },
    }));
  }
  return {
    boot,
    projectId,
    threadId,
    thread: cache[threadId],
    threads,
    cursor,
    approvals,
    error,
    loading,
    sending,
    archived,
    search,
    usage: usage[threadId],
    plan: plans[threadId] ?? [],
    setError,
    fail,
    setSearch,
    setArchived,
    refresh,
    openThread,
    selectProject,
    addProject,
    removeProject,
    send,
    updateSettings,
    reconnect,
    rename,
    archive,
    fork,
    older,
    newThread: () => {
      ++selectionGeneration.current;
      setThreadId('');
      setLoading(false);
      setArchived(false);
      void request('settings.update', { lastThreadId: '' }).catch(fail);
    },
  };
}
