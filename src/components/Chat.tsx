import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { compactionFailure } from '../shared/errors';
import { CompactionError } from './CompactionError';

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
export function CopyButton({ text, onError }: { text: string; onError: (error: unknown) => void }) {
  const t = useT(),
    [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      className="copy-button"
      title={t('复制这条消息', 'Copy this message')}
      aria-label={copied ? t('已复制', 'Copied') : t('复制消息', 'Copy message')}
      onClick={() => {
        if (!window.codexDesk) return;
        void window.codexDesk
          .copyText(text)
          .then(() => {
            clearTimeout(timer.current);
            setCopied(true);
            timer.current = setTimeout(() => setCopied(false), 1500);
          })
          .catch(() =>
            onError(new Error(t('复制失败，请重试。', 'Could not copy this message. Please try again.'))),
          );
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      <span>{copied ? t('已复制', 'Copied') : t('复制', 'Copy')}</span>
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
  if (item.type === 'contextCompaction') {
    const label = running
      ? t('正在压缩上下文…', 'Compacting context…')
      : failed
        ? t('上下文压缩失败', 'Context compaction failed')
        : item.status === 'interrupted'
          ? t('上下文压缩已停止', 'Context compaction stopped')
          : t('上下文已压缩', 'Context compacted');
    return (
      <div className={`compaction-status ${failed ? 'failed' : ''}`} role="status">
        {running ? <Loader2 size={14} className="spin" /> : <Workflow size={14} />}
        <span>{label}</span>
        {item.status === 'completed' && <CheckCheck size={13} className="success" />}
      </div>
    );
  }
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
export function MessageItem({ item, onError }: { item: Item; onError: (error: unknown) => void }) {
  const t = useT();
  if (item.type === 'userMessage') {
    const inputs = item.content as { type: string; text?: string; path?: string; url?: string }[];
    const text =
      inputs
        ?.filter((input) => input.type === 'text')
        .map((input) => input.text || '')
        .join('\n\n') || '';
    return (
      <article className="message user-message" data-client-id={item.clientId ?? undefined}>
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
        {!!text && (
          <div className="message-actions">
            <CopyButton text={text} onError={onError} />
          </div>
        )}
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
        <div className="message-actions">
          <CopyButton text={item.text} onError={onError} />
        </div>
      </article>
    );
  }
  return <Activity item={item} />;
}
export function Chat({
  thread,
  loading,
  running,
  revealMessage,
  onOlder,
  onError,
  onCompact,
  onNew,
  canCompact,
}: {
  thread?: Thread;
  loading: boolean;
  running: boolean;
  revealMessage: number;
  onOlder: () => Promise<void>;
  onError: (e: unknown) => void;
  onCompact: () => Promise<boolean>;
  onNew: () => void;
  canCompact: boolean;
}) {
  const t = useT(),
    scrollRef = useRef<HTMLDivElement>(null),
    contentRef = useRef<HTMLDivElement>(null),
    pinned = useRef(true);
  const [atBottom, setAtBottom] = useState(true),
    [olderLoading, setOlderLoading] = useState(false);
  useLayoutEffect(() => {
    pinned.current = true;
    setAtBottom(true);
  }, [thread?.id, revealMessage]);
  useLayoutEffect(() => {
    if (pinned.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setAtBottom(true);
    }
  }, [thread, loading, revealMessage]);
  useEffect(() => {
    const element = scrollRef.current,
      content = contentRef.current;
    if (!element || !content) return;
    const observer = new ResizeObserver(() => {
      // Markdown, font changes and the steering tray can change the viewport
      // after a render. Keep the latest message visible only while following it.
      if (pinned.current) element.scrollTop = element.scrollHeight;
      setAtBottom(element.scrollHeight - element.scrollTop - element.clientHeight < 90);
    });
    observer.observe(element);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
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
        <div className="chat-content" ref={contentRef}>
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
            thread?.turns.map((turn, index) => {
              const message = turn.error?.message || t('任务执行失败', 'This turn failed.');
              const failure = compactionFailure(
                message,
                turn.items.some((item) => item.type === 'contextCompaction' && item.status === 'failed') ||
                  (turn.items.length > 0 && turn.items.every((item) => item.type === 'contextCompaction')),
              );
              return (
                <section key={turn.id} className="turn">
                  {turn.items.map((item) => (
                    <MessageItem
                      key={item.id}
                      item={
                        item.type === 'contextCompaction' && !item.status
                          ? { ...item, status: turn.status }
                          : item
                      }
                      onError={onError}
                    />
                  ))}
                  {turn.status === 'failed' &&
                    (failure ? (
                      <CompactionError
                        message={message}
                        filtered={failure === 'filtered'}
                        onRetry={canCompact && index === thread.turns.length - 1 ? onCompact : undefined}
                        onNew={onNew}
                        onError={onError}
                      />
                    ) : (
                      <div className="turn-error">{message}</div>
                    ))}
                  {turn.status === 'interrupted' && (
                    <div className="turn-note">{t('任务已停止', 'Turn stopped')}</div>
                  )}
                </section>
              );
            })
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
