import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArrowUpRight,
  Check,
  ChevronDown,
  Circle,
  Code2,
  Folder,
  FolderOpen,
  FolderPlus,
  GitFork,
  History,
  LayoutPanelLeft,
  Loader2,
  Maximize2,
  MessageSquare,
  Minus,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  Pencil,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';
import { LocaleContext, useT } from './lib/i18n';
import { request, useDesk } from './lib/useDesk';
import { activeTurn, threadTitle } from './lib/events';
import { Chat } from './components/Chat';
import { Composer } from './components/Composer';
import { Inspector } from './components/Inspector';
import { ApprovalCard } from './components/Approvals';
import { Settings } from './components/Settings';
import { Dialog } from './components/Dialog';
import { SyncDialog } from './components/SyncDialog';
import { GoalBadge, GoalPanel } from './components/GoalPanel';
import { StatusPanel } from './components/StatusPanel';
import { CliTerminal } from './components/CliTerminal';
import { CompletionToast } from './components/CompletionToast';
import { StartupModePicker } from './components/StartupModePicker';

export function App() {
  const desk = useDesk();
  useEffect(() => {
    document.documentElement.dataset.theme = desk.boot.settings.theme;
    document.documentElement.lang = desk.boot.settings.locale === 'zh' ? 'zh-CN' : 'en';
  }, [desk.boot.settings.theme, desk.boot.settings.locale]);
  return (
    <LocaleContext value={desk.boot.settings.locale}>
      <Workspace desk={desk} />
    </LocaleContext>
  );
}
function Workspace({ desk }: { desk: ReturnType<typeof useDesk> }) {
  const t = useT(),
    { boot, thread, threadId, projectId } = desk;
  const [sidebar, setSidebar] = useState(true),
    [inspector, setInspector] = useState(() => window.innerWidth >= 1190),
    [settings, setSettings] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(264),
    [inspectorWidth, setInspectorWidth] = useState(310);
  const [renaming, setRenaming] = useState(false),
    [name, setName] = useState(''),
    [menu, setMenu] = useState(false);
  const [syncDialog, setSyncDialog] = useState(false);
  const [goalPanel, setGoalPanel] = useState(false),
    [goalObjective, setGoalObjective] = useState(''),
    [statusPanel, setStatusPanel] = useState(false);
  const [cliPanel, setCliPanel] = useState<{ threadId: string; command: string } | null>(null);
  const [inspectorTab, setInspectorTab] = useState<{ tab: 'files' | 'changes'; revision: number }>({
    tab: 'files',
    revision: 0,
  });
  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('codex-desk:drafts') || '{}');
      return Object.fromEntries(
        Object.entries(saved).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      );
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('codex-desk:drafts', JSON.stringify(drafts));
    } catch {
      /* A full store must not block typing. */
    }
  }, [drafts]);
  const draftKey = threadId || `new:${projectId}`,
    draft = drafts[draftKey] ?? (desk.newConversation ? drafts[`new:${projectId}`] : '') ?? '';
  useEffect(() => {
    if (!threadId || !desk.newConversation) return;
    setDrafts((old) => {
      const source = `new:${projectId}`;
      if (old[draftKey] !== undefined || !old[source]) return old;
      return { ...old, [draftKey]: old[source], [source]: '' };
    });
  }, [threadId, desk.newConversation, draftKey, projectId]);
  const inputRef = useRef<HTMLTextAreaElement>(null),
    searchRef = useRef<HTMLInputElement>(null);
  const project = thread
    ? boot.projects.find((p) => p.path === thread.cwd)
    : boot.projects.find((p) => p.id === projectId);
  const ready = boot.connection.phase === 'ready',
    turn = activeTurn(thread),
    running = !!turn;
  const currentApprovals = desk.approvals.filter((a) => a.params.threadId === threadId);
  const title = thread
    ? threadTitle(thread, t('新会话', 'New conversation'))
    : t('新会话', 'New conversation');
  const setDraft = (value: string) => setDrafts((old) => ({ ...old, [draftKey]: value }));

  async function runCommand(name: string, args: string): Promise<boolean> {
    if (name === 'goal') {
      const control = args.toLowerCase();
      if (threadId && control === 'pause') await desk.setGoal({ status: 'paused' });
      else if (threadId && control === 'resume') await desk.setGoal({ status: 'active' });
      else if (threadId && control === 'clear') await desk.clearGoal();
      else {
        setGoalObjective(control === 'edit' ? '' : args);
        setGoalPanel(true);
      }
      return true;
    }
    if ((name === 'status' || name === 'pwd') && !args) {
      setStatusPanel(true);
      return true;
    }
    if ((name === 'new' || name === 'clear') && !args) {
      desk.newThread();
      return true;
    }
    if (name === 'resume' && !args) {
      setSidebar(true);
      desk.setArchived(false);
      desk.selectProject('');
      setTimeout(() => searchRef.current?.focus(), 0);
      return true;
    }
    if (name === 'rename' && threadId) {
      if (args) await desk.rename(threadId, args);
      else {
        setName(title);
        setRenaming(true);
      }
      return true;
    }
    if (name === 'archive' && threadId && !args) {
      await desk.archive(threadId);
      return true;
    }
    if (name === 'fork' && threadId && !args) {
      await desk.fork(threadId);
      return true;
    }
    if (name === 'compact' && threadId && !args) {
      await request('thread.compact', { threadId });
      return true;
    }
    if ((name === 'diff' || name === 'mention') && project && !args) {
      setInspectorTab((old) => ({ tab: name === 'diff' ? 'changes' : 'files', revision: old.revision + 1 }));
      setInspector(true);
      return true;
    }
    if (thread?.syncState === 'external') {
      setSyncDialog(true);
      return false;
    }
    const id = await desk.ensureThread();
    if (!threadId && draft && !draft.startsWith('/')) setDrafts((old) => ({ ...old, [id]: draft }));
    setCliPanel({ threadId: id, command: `/${name}${args ? ' ' + args : ''}` });
    return true;
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        desk.newThread();
        inputRef.current?.focus();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSidebar(true);
        setTimeout(() => searchRef.current?.focus(), 0);
      }
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault();
        setSettings(true);
      }
      if (event.key === 'Escape') setMenu(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  useEffect(() => {
    const resize = () => {
      if (window.innerWidth < 1190) setInspector(false);
    };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  function resize(event: React.PointerEvent, side: 'left' | 'right') {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = event.clientX,
      initial = side === 'left' ? sidebarWidth : inspectorWidth;
    function move(e: PointerEvent) {
      const next = initial + (e.clientX - start) * (side === 'left' ? 1 : -1);
      if (side === 'left') setSidebarWidth(Math.min(370, Math.max(220, next)));
      else setInspectorWidth(Math.min(560, Math.max(260, next)));
    }
    function end() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  }
  const suggestions = [
    {
      icon: <Code2 size={18} />,
      title: t('了解这个项目', 'Explore this project'),
      desc: t('梳理结构与关键模块', 'Map the structure and key modules'),
      prompt: t(
        '帮我了解这个项目：先梳理目录结构、技术栈和关键模块，不要修改文件。',
        'Help me understand this project. Map its structure, stack, and key modules without modifying files.',
      ),
    },
    {
      icon: <Sparkles size={18} />,
      title: t('开始一个新功能', 'Build something new'),
      desc: t('从想法到具体实现', 'Turn an idea into working code'),
      prompt: t('我想在这个项目中添加一个新功能：', 'I want to add a new feature to this project: '),
    },
    {
      icon: <GitFork size={18} />,
      title: t('检查当前更改', 'Review local changes'),
      desc: t('发现问题，完善细节', 'Find bugs and refine the details'),
      prompt: t(
        '请审查当前 Git 工作区中的更改，指出潜在错误和缺失的测试。先给出发现，不要修改文件。',
        'Review the current Git working-tree changes for bugs and missing tests. Report findings before modifying files.',
      ),
    },
  ];
  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="brand">
          <img src="./icon.svg" alt="" />
          <span>
            Codex <strong>Desk</strong>
          </span>
          <span className="ubuntu-badge">Ubuntu</span>
        </div>
        <div className="titlebar-center">
          <span className={`status-dot ${ready ? '' : 'offline'}`} />
          {t('你的本地 Codex 工作空间', 'Your local Codex workspace')}
        </div>
        <div className="window-controls">
          <button
            onClick={() => void window.codexDesk?.windowAction('minimize')}
            aria-label={t('最小化', 'Minimize')}
          >
            <Minus size={14} />
          </button>
          <button
            onClick={() => void window.codexDesk?.windowAction('maximize')}
            aria-label={t('最大化', 'Maximize')}
          >
            <Maximize2 size={12} />
          </button>
          <button
            className="window-close"
            onClick={() => void window.codexDesk?.windowAction('close')}
            aria-label={t('关闭窗口', 'Close window')}
          >
            <X size={16} />
          </button>
        </div>
      </header>
      <div
        className="workspace-layout"
        style={
          {
            '--sidebar-width': `${sidebarWidth}px`,
            '--inspector-width': `${inspectorWidth}px`,
          } as React.CSSProperties
        }
      >
        {sidebar && (
          <>
            <aside className="sidebar">
              <div className="sidebar-top">
                <button
                  className="new-conversation"
                  onClick={() => {
                    desk.newThread();
                    inputRef.current?.focus();
                  }}
                >
                  <Plus size={18} />
                  <span>{t('新会话', 'New conversation')}</span>
                  <kbd>Ctrl N</kbd>
                </button>
                <button
                  className="icon-button"
                  aria-label={t('收起侧栏', 'Collapse sidebar')}
                  onClick={() => setSidebar(false)}
                >
                  <PanelLeftClose size={17} />
                </button>
              </div>
              <div className="search-box">
                <Search size={15} />
                <input
                  ref={searchRef}
                  placeholder={t('搜索会话', 'Search conversations')}
                  aria-label={t('搜索会话', 'Search conversations')}
                  value={desk.search}
                  onChange={(e) => desk.setSearch(e.target.value)}
                />
                <kbd>⌃ K</kbd>
              </div>
              <div className="sidebar-scroll">
                <button
                  className={`nav-item all-conversations ${!projectId ? 'selected' : ''}`}
                  onClick={() => desk.selectProject('')}
                >
                  <MessageSquare size={16} />
                  <span>{t('所有会话', 'All conversations')}</span>
                </button>
                <div className="section-heading">
                  <span>{t('项目', 'PROJECTS')}</span>
                  <button
                    className="icon-button"
                    onClick={() => void desk.addProject()}
                    title={t('打开项目', 'Open project')}
                    aria-label={t('打开项目', 'Open project')}
                  >
                    <Plus size={15} />
                  </button>
                </div>
                <div className="project-list">
                  {boot.projects.map((p) => (
                    <div className={`project-row ${projectId === p.id ? 'selected' : ''}`} key={p.id}>
                      <button title={p.path} onClick={() => desk.selectProject(p.id)}>
                        {projectId === p.id ? <FolderOpen size={16} /> : <Folder size={16} />}
                        <span>{p.name}</span>
                      </button>
                      <button
                        className="remove-project"
                        title={t('从列表移除项目', 'Remove project bookmark')}
                        aria-label={`${t('移除项目', 'Remove project')} ${p.name}`}
                        onClick={() => void desk.removeProject(p.id)}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  {!boot.projects.length && (
                    <button className="open-first-project" onClick={() => void desk.addProject()}>
                      <FolderPlus size={16} />
                      {t('打开第一个项目', 'Open your first project')}
                    </button>
                  )}
                </div>
                <div className="section-heading">
                  <span>{desk.archived ? t('已归档', 'ARCHIVED') : t('最近会话', 'RECENT')}</span>
                  <div className="row">
                    <button
                      className={`icon-button ${desk.archived ? 'active' : ''}`}
                      title={t('切换归档会话', 'Toggle archived conversations')}
                      aria-label={t('切换归档会话', 'Toggle archived conversations')}
                      onClick={() => desk.setArchived(!desk.archived)}
                    >
                      <Archive size={13} />
                    </button>
                    <button
                      className="icon-button"
                      title={t('刷新会话', 'Refresh conversations')}
                      aria-label={t('刷新会话', 'Refresh conversations')}
                      onClick={() => void desk.refresh()}
                    >
                      <History size={13} />
                    </button>
                  </div>
                </div>
                <div className="thread-list">
                  {desk.threads.map((item) => (
                    <button
                      className={`thread-row ${threadId === item.id ? 'selected' : ''}`}
                      key={item.id}
                      onClick={() => void desk.openThread(item.id)}
                      title={threadTitle(item)}
                    >
                      <span className="thread-state">
                        {item.status?.type === 'active' ? (
                          <Loader2 size={13} className="spin success" />
                        ) : desk.approvals.some((a) => a.params.threadId === item.id) ? (
                          <span className="attention-dot" />
                        ) : (
                          <MessageSquare size={13} />
                        )}
                      </span>
                      <span className="thread-info">
                        <span>{threadTitle(item, t('新会话', 'New conversation'))}</span>
                        <small>
                          {item.cwd?.split('/').filter(Boolean).at(-1)} ·{' '}
                          {new Date(item.updatedAt * 1000).toLocaleDateString(
                            boot.settings.locale === 'zh' ? 'zh-CN' : 'en-US',
                            { month: 'short', day: 'numeric' },
                          )}
                        </small>
                      </span>
                    </button>
                  ))}
                  {!desk.threads.length && (
                    <p className="empty-threads">
                      {!ready
                        ? t('连接后显示会话', 'Conversations appear after connecting')
                        : desk.search
                          ? t('没有找到匹配的会话', 'No matching conversations')
                          : t('这里将保存你的工作轨迹', 'Your work will find a home here')}
                    </p>
                  )}
                  {desk.cursor && (
                    <button className="load-more" onClick={() => void desk.refresh(true, desk.cursor)}>
                      {t('加载更多', 'Load more')}
                      <ChevronDown size={12} />
                    </button>
                  )}
                </div>
              </div>
              <div className="sidebar-bottom">
                {!!desk.approvals.length && (
                  <button
                    className="pending-approvals"
                    onClick={() => void desk.openThread(String(desk.approvals[0].params.threadId))}
                  >
                    <span className="attention-dot" />
                    {desk.approvals.length} {t('项等待回应', 'awaiting response')}
                  </button>
                )}
                <div className="connection-status">
                  <span className={`status-dot ${ready ? '' : 'offline'}`} />
                  <div>
                    <strong>
                      {ready
                        ? t('Codex 已连接', 'Codex connected')
                        : boot.connection.phase === 'starting'
                          ? t('正在连接…', 'Connecting…')
                          : t('Codex 未连接', 'Codex disconnected')}
                    </strong>
                    <small>{boot.connection.version?.replace('codex-cli ', 'CLI v') || 'Codex CLI'}</small>
                  </div>
                  <button
                    className="icon-button"
                    onClick={() => setSettings(true)}
                    aria-label={t('设置', 'Settings')}
                  >
                    <Settings2 size={17} />
                  </button>
                </div>
              </div>
            </aside>
            <div
              className="resize-handle"
              role="separator"
              aria-label={t('调整侧栏宽度', 'Resize sidebar')}
              onPointerDown={(e) => resize(e, 'left')}
            />
          </>
        )}
        <main className="main-panel">
          <div className="conversation-topbar">
            <div className="conversation-breadcrumb">
              {!sidebar && (
                <button
                  className="icon-button"
                  onClick={() => setSidebar(true)}
                  aria-label={t('展开侧栏', 'Expand sidebar')}
                >
                  <PanelLeftOpen size={18} />
                </button>
              )}
              <span className="breadcrumb-project">
                {project?.name ??
                  (threadId ? t('工作空间', 'Workspace') : t('默认工作区', 'Default workspace'))}
              </span>
              <span className="breadcrumb-slash">/</span>
              <strong title={title}>{title}</strong>
            </div>
            <div className="conversation-actions">
              {thread?.goal && (
                <GoalBadge
                  goal={thread.goal}
                  onClick={() => {
                    setGoalObjective('');
                    setGoalPanel(true);
                  }}
                />
              )}
              {thread && !desk.archived && (
                <button
                  className="text-button sync-terminal-button"
                  onClick={() => setSyncDialog(true)}
                  title={t('在终端同步打开', 'Open synced terminal')}
                >
                  <Terminal size={15} />
                  {t('CLI 同步', 'CLI sync')}
                </button>
              )}
              {thread && !project && (
                <button
                  className="text-button"
                  onClick={() => {
                    void desk.addProject(thread.cwd).then((p) => {
                      if (p) void desk.openThread(thread.id);
                    });
                  }}
                >
                  <FolderPlus size={14} />
                  {t('添加此项目', 'Add this project')}
                </button>
              )}
              {thread && (
                <div className="menu-anchor">
                  <button
                    className="icon-button"
                    aria-label={t('会话操作', 'Conversation actions')}
                    onClick={() => setMenu(!menu)}
                  >
                    <MoreHorizontal size={19} />
                  </button>
                  {menu && (
                    <>
                      <div className="menu-dismiss" onClick={() => setMenu(false)} />
                      <div className="dropdown-menu">
                        <button
                          onClick={() => {
                            setMenu(false);
                            setName(title);
                            setRenaming(true);
                          }}
                        >
                          <Pencil size={14} />
                          {t('重命名', 'Rename')}
                        </button>
                        <button
                          disabled={running}
                          onClick={() => {
                            setMenu(false);
                            void desk.fork(threadId).catch(desk.fail);
                          }}
                        >
                          <GitFork size={14} />
                          {t('分叉会话', 'Fork conversation')}
                        </button>
                        <button
                          disabled={running}
                          onClick={() => {
                            setMenu(false);
                            void desk.archive(threadId, desk.archived).catch(desk.fail);
                          }}
                        >
                          <Archive size={14} />
                          {desk.archived
                            ? t('恢复会话', 'Restore conversation')
                            : t('归档会话', 'Archive conversation')}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {!inspector && (
                <button
                  className="icon-button"
                  onClick={() => setInspector(true)}
                  aria-label={t('打开项目面板', 'Open inspector')}
                >
                  <PanelRightOpen size={18} />
                </button>
              )}
            </div>
          </div>
          {thread?.syncState === 'external' && !desk.archived && (
            <div className="sync-banner" role="status">
              <div>
                <strong>
                  {t('此会话仍在独立 CLI 中打开', 'This conversation is open in a standalone CLI')}
                </strong>
                <p>
                  {t(
                    '退出原 CLI 后，Desk 会自动接入同一会话。使用同步终端即可在两边继续，历史与草稿会保留。',
                    'After you exit the original CLI, Desk reconnects to the same conversation. Use a synced terminal to continue in both interfaces; history and drafts are preserved.',
                  )}
                </p>
              </div>
              <button className="secondary-button" onClick={() => setSyncDialog(true)}>
                {t('连接同一会话', 'Connect this conversation')}
              </button>
            </div>
          )}
          {desk.error && (
            <div className="error-banner" role="alert">
              <span>{desk.error}</span>
              {!ready && <button onClick={() => setSettings(true)}>{t('打开设置', 'Open settings')}</button>}
              <button
                className="icon-button"
                onClick={() => desk.setError('')}
                aria-label={t('关闭提示', 'Dismiss message')}
              >
                <X size={14} />
              </button>
            </div>
          )}
          {desk.completion && (
            <CompletionToast
              notice={desk.completion}
              onClose={desk.dismissCompletion}
              onView={() => {
                void desk.openThread(desk.completion!.threadId);
                desk.dismissCompletion();
              }}
            />
          )}
          {!ready && !desk.error && (
            <div className="connection-banner">
              {boot.connection.phase === 'starting' ? (
                <>
                  <Loader2 size={14} className="spin" />
                  {t('正在连接本机 Codex CLI…', 'Connecting to local Codex CLI…')}
                </>
              ) : (
                <>
                  <Terminal size={15} />
                  {t('连接 Codex，开始工作。', 'Connect Codex to get started.')}
                  <button onClick={() => setSettings(true)}>{t('连接设置', 'Connection settings')}</button>
                </>
              )}
            </div>
          )}
          {threadId && !desk.newConversation ? (
            <Chat
              thread={thread}
              loading={desk.loading}
              running={running}
              onOlder={desk.older}
              onError={desk.fail}
            />
          ) : (
            <div className="welcome">
              <div className="welcome-inner">
                <div className="welcome-logo">
                  <img src="./icon.svg" alt="" />
                </div>
                <div className="welcome-eyebrow">
                  CODEX DESK
                  <span />
                  {t('让工作，接着发生', 'PICK UP WHERE IDEAS BEGIN')}
                </div>
                <h1>{t('今天，我们做点什么？', 'What shall we build today?')}</h1>
                <p className="welcome-subtitle">
                  {project
                    ? t(
                        `从 ${project.name} 开始，把想法一步步变成现实。`,
                        `Start with ${project.name}. Take your next idea a little further.`,
                      )
                    : t(
                        '直接描述任务，即可在默认工作区开始。',
                        'Describe a task to start in your default workspace.',
                      )}
                </p>
                {!project && (
                  <button className="open-project-hero" onClick={() => void desk.addProject()}>
                    <FolderPlus size={17} />
                    {t('打开项目', 'Open a project')}
                    <ArrowUpRight size={15} />
                  </button>
                )}
                <StartupModePicker
                  value={desk.startupAccess}
                  onChange={desk.setStartupAccess}
                  disabled={desk.sending}
                />
                <div className="suggestions">
                  {suggestions.map((s) => (
                    <button
                      key={s.title}
                      onClick={() => {
                        setDraft(s.prompt);
                        inputRef.current?.focus();
                      }}
                    >
                      {s.icon}
                      <strong>{s.title}</strong>
                      <span>{s.desc}</span>
                      <ArrowUpRight size={13} className="suggestion-arrow" />
                    </button>
                  ))}
                </div>
                <div className="local-note">
                  <span className="status-dot" />
                  {t('本地 CLI · 你的项目 · 熟悉的工作流', 'Local CLI · Your projects · Your workflow')}
                </div>
              </div>
            </div>
          )}
          {!!currentApprovals.length && (
            <div className="approvals-tray">
              {currentApprovals.map((a) => (
                <ApprovalCard key={a.id} approval={a} onError={desk.fail} />
              ))}
            </div>
          )}
          {!!desk.plan.length && running && (
            <details className="plan-bar">
              <summary>
                <LayoutPanelLeft size={14} />
                {t('执行计划', 'Work plan')}
                <span>
                  {desk.plan.filter((p) => p.status === 'completed').length}/{desk.plan.length}
                </span>
                <ChevronDown size={13} />
              </summary>
              <div>
                {desk.plan.map((p, i) => (
                  <p key={i}>
                    {p.status === 'completed' ? (
                      <Check size={13} className="success" />
                    ) : p.status === 'inProgress' ? (
                      <Loader2 size={13} className="spin" />
                    ) : (
                      <Circle size={12} />
                    )}
                    {p.step}
                  </p>
                ))}
              </div>
            </details>
          )}
          {desk.archived && thread && (
            <div className="archived-banner">
              <Archive size={14} />
              {t('这段会话已归档', 'This conversation is archived')}
              <button
                className="text-button"
                onClick={() => void desk.archive(threadId, true).catch(desk.fail)}
              >
                {t('恢复会话', 'Restore conversation')}
              </button>
            </div>
          )}
          <Composer
            key={desk.compositionKey}
            models={boot.models}
            initialModel={thread?.model}
            initialEffort={thread?.reasoningEffort}
            initialAccess={thread?.permissionMode}
            initialApprovalPolicy={thread?.approvalPolicy}
            startup={
              desk.newConversation
                ? { access: desk.startupAccess, onChange: desk.setStartupAccess }
                : undefined
            }
            initialMode={thread?.collaborationMode}
            onCommand={runCommand}
            project={project}
            connected={ready}
            sending={desk.sending}
            running={running}
            archived={desk.archived && !!threadId}
            blocked={thread?.syncState === 'external'}
            onSend={desk.send}
            draft={draft}
            onDraft={setDraft}
            inputRef={inputRef}
            onError={desk.fail}
            onStop={() => {
              if (turn) void request('turn.interrupt', { threadId, turnId: turn.id }).catch(desk.fail);
            }}
          />
          <footer className="main-statusbar">
            <span>
              {running ? <Loader2 size={11} className="spin" /> : <span className="status-dot" />}
              {running
                ? t('正在运行', 'Running')
                : ready
                  ? t('准备就绪', 'Ready')
                  : t('未连接', 'Disconnected')}
            </span>
            {desk.usage && (
              <span className="token-usage">
                {desk.usage.total.toLocaleString()} tokens{' '}
                {desk.usage.limit > 0 &&
                  `· ${Math.round((desk.usage.context / desk.usage.limit) * 100)}% ${t('上下文', 'context')}`}
              </span>
            )}
            <span className="statusbar-right">
              {desk.nativeTerminal && (
                <button
                  className="text-button background-terminal-status"
                  title={
                    desk.nativeTerminal.error ||
                    t(
                      '在 Ubuntu 终端应用中查找对应会话。',
                      'Find this conversation in the Ubuntu Terminal app.',
                    )
                  }
                  onClick={() => {
                    if (thread) {
                      if (desk.nativeTerminal?.state === 'error') desk.prepareTerminal(thread);
                      else setSyncDialog(true);
                    }
                  }}
                >
                  <Terminal size={12} />
                  {desk.nativeTerminal.state === 'ready'
                    ? t('终端已在后台打开', 'Terminal ready in background')
                    : desk.nativeTerminal.state === 'preparing'
                      ? t('正在准备后台终端…', 'Preparing background terminal…')
                      : desk.nativeTerminal.state === 'waiting'
                        ? t('终端等待 CLI 释放', 'Terminal waiting for CLI')
                        : t('重试后台终端', 'Retry background terminal')}
                </button>
              )}
              {thread?.syncState === 'live'
                ? t('CLI 与 Desk 实时同步', 'CLI and Desk · Live sync')
                : t('由 Codex CLI 驱动', 'Powered by Codex CLI')}
            </span>
          </footer>
        </main>
        {inspector && (
          <>
            <div
              className="resize-handle inspector-resizer"
              role="separator"
              aria-label={t('调整项目面板宽度', 'Resize inspector')}
              onPointerDown={(e) => resize(e, 'right')}
            />
            <Inspector
              project={project}
              requestedTab={inspectorTab}
              refreshKey={`${threadId}:${thread?.updatedAt}:${running}`}
              onClose={() => setInspector(false)}
              onError={desk.fail}
              onMention={(file) => {
                setDraft(`${draft}${draft ? '\n' : ''}@${file} `);
                inputRef.current?.focus();
              }}
            />
          </>
        )}
      </div>
      {settings && (
        <Settings
          boot={boot}
          onClose={() => setSettings(false)}
          onSave={desk.updateSettings}
          onReconnect={desk.reconnect}
          onError={desk.fail}
        />
      )}
      {syncDialog && threadId && (
        <SyncDialog
          threadId={threadId}
          external={thread?.syncState === 'external'}
          onClose={() => setSyncDialog(false)}
          onError={desk.fail}
        />
      )}
      {goalPanel && (
        <GoalPanel
          goal={thread?.goal}
          initialObjective={goalObjective}
          disabled={!ready || thread?.syncState === 'external' || desk.archived}
          onSave={desk.setGoal}
          onClear={desk.clearGoal}
          onClose={() => {
            setGoalPanel(false);
            setGoalObjective('');
          }}
        />
      )}
      {statusPanel && (
        <StatusPanel boot={boot} thread={thread} usage={desk.usage} onClose={() => setStatusPanel(false)} />
      )}
      {cliPanel && <CliTerminal {...cliPanel} onClose={() => setCliPanel(null)} />}
      {renaming && (
        <Dialog title={t('重命名会话', 'Rename conversation')} onClose={() => setRenaming(false)}>
          <form
            className="rename-form"
            onSubmit={(e) => {
              e.preventDefault();
              void desk
                .rename(threadId, name)
                .then(() => setRenaming(false))
                .catch(desk.fail);
            }}
          >
            <label className="field-label">
              {t('会话名称', 'Conversation name')}
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
            </label>
            <div className="dialog-actions">
              <button className="secondary-button" type="button" onClick={() => setRenaming(false)}>
                {t('取消', 'Cancel')}
              </button>
              <button className="primary-button" disabled={!name.trim()} type="submit">
                {t('保存', 'Save')}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
