import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Square, Paperclip, X, Shield, ChevronDown, Loader2, Sparkles } from 'lucide-react';
import type { AccessMode, Model, Project } from '../shared/types';
import { useT } from '../lib/i18n';

export function Composer({
  models,
  project,
  connected,
  sending,
  running,
  onSend,
  onStop,
  draft,
  onDraft,
  onError,
  inputRef,
  archived,
  initialModel,
  initialEffort,
}: {
  models: Model[];
  project?: Project;
  connected: boolean;
  sending: boolean;
  running: boolean;
  onSend: (
    text: string,
    model: string,
    effort: string,
    access: AccessMode,
    images: string[],
  ) => Promise<boolean>;
  onStop: () => void;
  draft: string;
  onDraft: (text: string) => void;
  onError: (e: unknown) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  archived: boolean;
  initialModel?: string | null;
  initialEffort?: string | null;
}) {
  const t = useT(),
    [modelId, setModelId] = useState(''),
    [effort, setEffort] = useState('');
  const [access, setAccess] = useState<AccessMode>('workspace-write');
  const [images, setImages] = useState<{ path: string; name: string; preview: string }[]>([]);
  useEffect(() => {
    if (initialModel) setModelId((old) => old || initialModel);
    if (initialEffort) setEffort((old) => old || initialEffort);
  }, [initialModel, initialEffort]);
  const savedModel =
    modelId && !models.some((m) => m.model === modelId)
      ? {
          id: modelId,
          model: modelId,
          displayName: modelId,
          defaultReasoningEffort: initialEffort || 'medium',
          supportedReasoningEfforts: [{ reasoningEffort: initialEffort || 'medium', description: '' }],
          description: '',
          isDefault: false,
        }
      : null;
  const options = savedModel ? [savedModel, ...models] : models;
  const chosen = options.find((m) => m.model === modelId) ?? options.find((m) => m.isDefault) ?? options[0];
  const selectedEffort = chosen?.supportedReasoningEfforts.some((e) => e.reasoningEffort === effort)
    ? effort
    : (chosen?.defaultReasoningEffort ?? 'medium');
  const lock = useRef(false);
  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.style.height = 'auto';
    inputRef.current.style.height = Math.min(200, inputRef.current.scrollHeight) + 'px';
  }, [draft, inputRef]);
  const disabled = !connected || sending || archived;
  async function submit() {
    if (disabled || running || lock.current || (!draft.trim() && !images.length)) return;
    lock.current = true;
    try {
      if (
        await onSend(
          draft,
          chosen?.model ?? '',
          selectedEffort,
          access,
          images.map((i) => i.path),
        )
      ) {
        onDraft('');
        setImages([]);
      }
    } finally {
      lock.current = false;
    }
  }
  async function attach() {
    try {
      const result = await window.codexDesk?.pickImages();
      if (!result) return;
      setImages((old) =>
        [...old, ...result.filter((image) => !old.some((o) => o.path === image.path))].slice(0, 8),
      );
    } catch (e) {
      onError(e);
    }
  }
  return (
    <div className="composer-area">
      <div className={`composer ${running ? 'is-running' : ''}`}>
        {!!images.length && (
          <div className="image-attachments">
            {images.map((image) => (
              <div key={image.path}>
                <img src={image.preview} alt={image.name} />
                <button
                  onClick={() => setImages((old) => old.filter((i) => i.path !== image.path))}
                  aria-label={t('移除图片', 'Remove image')}
                >
                  <X size={12} />
                </button>
                <span>{image.name}</span>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          rows={2}
          disabled={archived}
          aria-label={t('发送给 Codex 的消息', 'Message Codex')}
          placeholder={
            archived
              ? t('恢复此会话后继续', 'Restore this conversation to continue')
              : running
                ? t('写下接下来的想法…', 'Draft your next thought…')
                : t('描述任务，剩下的交给 Codex…', 'Describe a task for Codex…')
          }
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              e.nativeEvent.keyCode !== 229
            ) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div className="composer-toolbar">
          <div className="composer-tools">
            <button
              className="icon-button"
              disabled={disabled || images.length >= 8}
              onClick={() => void attach()}
              title={t('添加图片', 'Attach images')}
              aria-label={t('添加图片', 'Attach images')}
            >
              <Paperclip size={18} />
            </button>
            <span className="toolbar-separator" />
            <div className="select-wrap model-select">
              <Sparkles size={13} />
              <select
                aria-label={t('模型', 'Model')}
                value={chosen?.model ?? ''}
                onChange={(e) => setModelId(e.target.value)}
                disabled={!models.length || running}
              >
                {!options.length && <option value="">{t('Codex 默认模型', 'Codex default')}</option>}
                {options.map((m) => (
                  <option key={m.id} value={m.model}>
                    {m.displayName}
                  </option>
                ))}
              </select>
              <ChevronDown size={12} />
            </div>
            {chosen && (
              <div className="select-wrap effort-select">
                <select
                  aria-label={t('推理强度', 'Reasoning effort')}
                  value={selectedEffort}
                  onChange={(e) => setEffort(e.target.value)}
                  disabled={running}
                >
                  {chosen.supportedReasoningEfforts.map((e) => (
                    <option key={e.reasoningEffort} value={e.reasoningEffort}>
                      {e.reasoningEffort}
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} />
              </div>
            )}
          </div>
          {running ? (
            <button
              className="send-button stop-button"
              onClick={onStop}
              aria-label={t('停止任务', 'Stop task')}
              title={t('停止任务', 'Stop task')}
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              className="send-button"
              onClick={() => void submit()}
              disabled={disabled || (!draft.trim() && !images.length)}
              aria-label={t('发送消息', 'Send message')}
            >
              {sending ? <Loader2 size={17} className="spin" /> : <ArrowUp size={19} strokeWidth={2.5} />}
            </button>
          )}
        </div>
      </div>
      <div className="composer-caption">
        <div
          className={`select-wrap permission-select ${access === 'danger-full-access' ? 'full-access' : ''}`}
        >
          <Shield size={12} />
          <select
            aria-label={t('权限模式', 'Permission mode')}
            value={access}
            onChange={(e) => setAccess(e.target.value as AccessMode)}
            disabled={running}
          >
            <option value="read-only">{t('只读', 'Read only')}</option>
            <option value="workspace-write">
              {t('允许修改项目 · 按需审批', 'Edit project · Ask when needed')}
            </option>
            <option value="danger-full-access">{t('完全访问', 'Full access')}</option>
          </select>
          <ChevronDown size={10} />
        </div>
        <span>
          {project?.name ? `${project.name} · ` : ''}Shift + Enter {t('换行', 'for newline')}
        </span>
      </div>
    </div>
  );
}
