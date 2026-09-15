import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Square, Paperclip, X, Loader2, Slash, ListChecks } from 'lucide-react';
import type { AccessMode, CollaborationMode, Model, Project } from '../shared/types';
import { useT } from '../lib/i18n';
import { ModelPicker, PermissionPicker } from './ChoiceMenu';
import { CommandMenu } from './CommandMenu';
import { parseSlash } from '../shared/commands';

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
  initialAccess,
  initialMode,
  onCommand,
  blocked = false,
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
    mode?: CollaborationMode,
  ) => Promise<boolean>;
  onCommand: (name: string, args: string) => Promise<boolean>;
  onStop: () => void;
  draft: string;
  onDraft: (text: string) => void;
  onError: (e: unknown) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  archived: boolean;
  initialModel?: string | null;
  initialEffort?: string | null;
  initialAccess?: AccessMode;
  initialMode?: CollaborationMode;
  blocked?: boolean;
}) {
  const t = useT(),
    [modelId, setModelId] = useState(''),
    [effort, setEffort] = useState('');
  const [access, setAccess] = useState<AccessMode>('workspace-write');
  const [mode, setMode] = useState<CollaborationMode>(initialMode || 'default');
  const [commandsOpen, setCommandsOpen] = useState(false),
    [modelOpen, setModelOpen] = useState(0),
    [permissionsOpen, setPermissionsOpen] = useState(0);
  const closeCommands = useCallback(() => {
    setCommandsOpen(false);
    inputRef.current?.focus();
  }, [inputRef]);
  useEffect(() => {
    if (initialMode) setMode(initialMode);
  }, [initialMode]);
  const [images, setImages] = useState<{ path: string; name: string; preview: string }[]>([]);
  useEffect(() => {
    if (initialModel) setModelId(initialModel);
    if (initialEffort) setEffort(initialEffort);
    if (initialAccess) setAccess(initialAccess);
  }, [initialModel, initialEffort, initialAccess]);
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
  const disabled = !connected || sending || archived || blocked;
  async function command(name: string, args = '') {
    setCommandsOpen(false);
    if (!name) {
      setCommandsOpen(true);
      return true;
    }
    if (name === 'model' && !args) {
      setModelOpen((value) => value + 1);
      return true;
    }
    if (name === 'permissions' && !args) {
      setPermissionsOpen((value) => value + 1);
      return true;
    }
    if (name === 'plan') {
      if (running || blocked)
        throw new Error(
          t('等待当前任务结束后切换模式。', 'Wait for the current task before switching modes.'),
        );
      setMode('plan');
      if (args) return onSend(args, chosen?.model || '', selectedEffort, access, [], 'plan');
      return true;
    }
    return onCommand(name, args);
  }
  async function submit() {
    const slash = parseSlash(draft);
    if (slash && connected && !sending && !archived && !lock.current) {
      lock.current = true;
      try {
        if (await command(slash.name, slash.args)) onDraft('');
      } catch (error) {
        onError(error);
      } finally {
        lock.current = false;
      }
      return;
    }
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
          mode,
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
      {commandsOpen && (
        <CommandMenu
          onClose={closeCommands}
          onSelect={(name) => {
            void command(name)
              .then((ok) => {
                if (ok && draft.trim() === '/') onDraft('');
              })
              .catch(onError);
          }}
        />
      )}
      {mode === 'plan' && (
        <div className="composer-mode">
          <ListChecks size={14} />
          {t('计划模式 · 先讨论方案', 'Plan mode · Discuss the approach first')}
          <button className="text-button" disabled={running || sending} onClick={() => setMode('default')}>
            {t('退出计划', 'Exit plan mode')}
          </button>
        </div>
      )}
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
          onChange={(e) => {
            onDraft(e.target.value);
            if (e.target.value === '/') setCommandsOpen(true);
          }}
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
              className="icon-button command-trigger"
              type="button"
              aria-label={t('Codex 命令', 'Codex commands')}
              title={t('全部 / 命令', 'All / commands')}
              disabled={!connected || sending}
              onClick={() => setCommandsOpen(!commandsOpen)}
            >
              <Slash size={17} />
            </button>
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
            <ModelPicker
              openSignal={modelOpen}
              models={options}
              chosen={chosen}
              effort={selectedEffort}
              onModel={setModelId}
              onEffort={setEffort}
              disabled={!options.length || running || sending}
            />
            {chosen && (
              <ModelPicker
                models={options}
                chosen={chosen}
                effort={selectedEffort}
                onModel={setModelId}
                onEffort={setEffort}
                disabled={running || sending}
                effortOnly
              />
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
        <PermissionPicker
          openSignal={permissionsOpen}
          value={access}
          onChange={setAccess}
          disabled={running || sending}
        />
        <span>
          {project?.name || t('默认工作区', 'Default workspace')} · Shift + Enter {t('换行', 'for newline')}
        </span>
      </div>
    </div>
  );
}
