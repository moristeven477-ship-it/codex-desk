import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Check,
  CheckCheck,
  ChevronDown,
  Copy,
  FileCode2,
  Globe2,
  Loader2,
  Terminal,
  Workflow,
  Brain,
  ArrowDown,
  CircleCheck,
} from 'lucide-react';
import type { Item, Thread } from '../shared/types';
import { useT } from '../lib/i18n';

export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              if (href) void window.codexDesk?.openExternal(href);
            }}
          >
            {children}
          </a>
        ),
        img: ({ alt }) => <span className="muted">[{alt || 'Image'}]</span>,
        pre: ({ children }) => <pre tabIndex={0}>{children}</pre>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
function CopyButton({ text }: { text: string }) {
  const t = useT(),
    [copied, setCopied] = useState(false);
  return (
    <button
      className="icon-button copy-button"
      title={t('复制', 'Copy')}
      aria-label={t('复制', 'Copy')}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}
function Activity({ item }: { item: Item }) {
  const t = useT();
  const running = ['inProgress', 'running'].includes(item.status ?? '');
  const failed =
    ['failed', 'declined'].includes(item.status ?? '') ||
    (typeof item.exitCode === 'number' && item.exitCode !== 0);
  const reasoning = item.type === 'reasoning';
  const icon =
    item.type === 'commandExecution' ? (
      <Terminal size={14} />
    ) : item.type === 'fileChange' ? (
      <FileCode2 size={14} />
    ) : item.type === 'webSearch' ? (
      <Globe2 size={14} />
    ) : reasoning ? (
      <Brain size={14} />
    ) : (
      <Workflow size={14} />
    );
  const title =
    item.type === 'commandExecution'
      ? item.command || t('运行命令', 'Run command')
      : item.type === 'fileChange'
        ? t('修改文件', 'File changes') + ` · ${item.changes?.length ?? 0}`
        : reasoning
          ? t('思考摘要', 'Thinking summary')
          : item.type === 'webSearch'
            ? t('搜索网页', 'Search the web')
            : item.type === 'contextCompaction'
              ? t('压缩上下文', 'Compact context')
              : item.type === 'collabAgentToolCall'
                ? t('子任务', 'Subtask') + ` · ${item.tool ?? ''}`
                : [item.server, item.tool || item.type].filter(Boolean).join(' / ');
  const body =
    item.type === 'commandExecution'
      ? item.aggregatedOutput || t('等待命令输出…', 'Waiting for output…')
      : reasoning
        ? [...(item.summary ?? []), ...((item.content ?? []) as string[])].filter(Boolean).join('\n\n')
        : item.type === 'fileChange'
          ? item.changes?.map((c) => `${c.path}\n${c.diff}`).join('\n\n')
          : JSON.stringify(item.result ?? item.arguments ?? item, null, 2);
  if (reasoning && !body) return null;
  return (
    <details className={`activity ${failed ? 'failed' : ''}`}>
      <summary>
        {running ? <Loader2 size={14} className="spin" /> : icon}
        <span>{title}</span>
        {item.durationMs != null && <small>{(item.durationMs / 1000).toFixed(1)}s</small>}
        {item.status === 'completed' && <CheckCheck size={13} className="success" />}
        <ChevronDown size={13} className="disclosure" />
      </summary>
      <div className="activity-body">
        {reasoning ? <Markdown text={body || ''} /> : <pre>{body}</pre>}
        {item.exitCode != null && (
          <span className="muted">
            {t('退出码', 'Exit code')}: {item.exitCode}
          </span>
        )}
      </div>
    </details>
  );
}
export function MessageItem({ item }: { item: Item }) {
  const t = useT();
  if (item.type === 'userMessage') {
    const inputs = item.content as { type: string; text?: string; path?: string; url?: string }[];
    return (
      <article className="message user-message">
        <div className="user-bubble">
          {inputs?.map((input, i) =>
            input.type === 'text' ? (
              <div key={i} className="user-text">
                {input.text}
              </div>
            ) : (
              <div key={i} className="attachment-label">
                <FileCode2 size={15} />
                {input.path?.split('/').at(-1) || t('图片附件', 'Image attachment')}
              </div>
            ),
          )}
        </div>
      </article>
    );
  }
  if (item.type === 'agentMessage' || item.type === 'plan') {
    if (!item.text) return null;
    return (
      <article
        className={`message assistant-message ${item.phase === 'commentary' ? 'commentary-message' : ''}`}
      >
        <div className="message-heading">
          <span className="mini-logo">/</span>
          <strong>Codex</strong>
          {item.type === 'plan' && <span className="badge">{t('计划', 'Plan')}</span>}
        </div>
        <div className="markdown">
          <Markdown text={item.text} />
        </div>
        <CopyButton text={item.text} />
      </article>
    );
  }
  return <Activity item={item} />;
}
export function Chat({
  thread,
  loading,
  running,
  onOlder,
  onError,
}: {
  thread?: Thread;
  loading: boolean;
  running: boolean;
  onOlder: () => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const t = useT(),
    scrollRef = useRef<HTMLDivElement>(null),
    pinned = useRef(true);
  const [atBottom, setAtBottom] = useState(true),
    [olderLoading, setOlderLoading] = useState(false);
  useEffect(() => {
    pinned.current = true;
    setAtBottom(true);
  }, [thread?.id]);
  useEffect(() => {
    if (pinned.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread, loading]);
  async function older() {
    const element = scrollRef.current,
      height = element?.scrollHeight ?? 0;
    pinned.current = false;
    setOlderLoading(true);
    try {
      await onOlder();
      requestAnimationFrame(() => {
        if (element) element.scrollTop += element.scrollHeight - height;
      });
    } catch (e) {
      onError(e);
    } finally {
      setOlderLoading(false);
    }
  }
  return (
    <div className="chat-shell">
      <div
        className="chat-scroll"
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (!el) return;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
          setAtBottom(pinned.current);
        }}
      >
        <div className="chat-content">
          {thread?.nextTurnsCursor && (
            <button className="load-older" onClick={() => void older()} disabled={olderLoading}>
              {olderLoading && <Loader2 size={14} className="spin" />}
              {t('加载更早的消息', 'Load earlier messages')}
            </button>
          )}
          {loading ? (
            <div className="chat-loading">
              <Loader2 className="spin" size={20} />
              <span>{t('读取会话…', 'Loading conversation…')}</span>
            </div>
          ) : (
            thread?.turns.map((turn) => (
              <section key={turn.id} className="turn">
                {turn.items.map((item) => (
                  <MessageItem key={item.id} item={item} />
                ))}
                {turn.status === 'failed' && (
                  <div className="turn-error">
                    {turn.error?.message || t('任务执行失败', 'This turn failed.')}
                  </div>
                )}
                {turn.status === 'interrupted' && (
                  <div className="turn-note">{t('任务已停止', 'Turn stopped')}</div>
                )}
              </section>
            ))
          )}
          {!loading && thread && !thread.turns.length && (
            <div className="empty-conversation">
              <CircleCheck size={22} />
              <h3>{t('会话已就绪', 'Conversation ready')}</h3>
              <p>
                {t('发送一条消息，开始这个项目的工作。', 'Send a message to start working on this project.')}
              </p>
            </div>
          )}
          {running && (
            <div className="working-indicator">
              <span className="pulse-dot" />
              {t('Codex 正在工作', 'Codex is working')}
              <span className="ellipsis">…</span>
            </div>
          )}
        </div>
      </div>
      {!atBottom && (
        <button
          className="jump-bottom"
          onClick={() => {
            pinned.current = true;
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
          }}
          aria-label={t('跳到最新消息', 'Jump to latest')}
        >
          <ArrowDown size={17} />
        </button>
      )}
    </div>
  );
}
