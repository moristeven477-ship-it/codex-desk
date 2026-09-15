import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Square, Paperclip, X, Loader2, Slash, ListChecks } from 'lucide-react';
import type {
  AccessMode,
  CollaborationMode,
  ImageAttachment,
  Model,
  Project,
  PermissionMode,
  ApprovalPolicy,
} from '../shared/types';
import { MAX_IMAGES, MAX_IMAGE_BYTES } from '../shared/images';
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
  initialApprovalPolicy,
  initialMode,
  startup,
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
    access: AccessMode | undefined,
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
  initialAccess?: PermissionMode;
  initialApprovalPolicy?: ApprovalPolicy;
  initialMode?: CollaborationMode;
  startup?: { access?: AccessMode; onChange: (access: AccessMode) => void };
  blocked?: boolean;
}) {
  const t = useT(),
    [modelId, setModelId] = useState(''),
    [effort, setEffort] = useState('');
  const [accessOverride, setAccess] = useState<AccessMode>();
  const chosenAccess = startup ? startup.access : accessOverride;
  const access = chosenAccess ?? initialAccess;
  const [modeOverride, setMode] = useState<CollaborationMode>();
  const mode = modeOverride ?? initialMode ?? 'default';
  const [commandsOpen, setCommandsOpen] = useState(false),
    [modelOpen, setModelOpen] = useState(0),
    [permissionsOpen, setPermissionsOpen] = useState(0);
  const closeCommands = useCallback(() => {
    setCommandsOpen(false);
    inputRef.current?.focus();
  }, [inputRef]);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [importing, setImporting] = useState(false);
  const importingRef = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const effectiveModelId = modelId || initialModel || '';
  const effectiveEffort = effort || (!modelId ? initialEffort : '') || '';
  function clearOverrides() {
    setModelId('');
    setEffort('');
    setAccess(undefined);
    setMode(undefined);
  }
  const savedModel =
    effectiveModelId && !models.some((m) => m.model === effectiveModelId)
      ? {
          id: effectiveModelId,
          model: effectiveModelId,
          displayName: effectiveModelId,
          defaultReasoningEffort: initialEffort || 'medium',
          supportedReasoningEfforts: [{ reasoningEffort: initialEffort || 'medium', description: '' }],
          description: '',
          isDefault: false,
        }
      : null;
  const options = savedModel ? [savedModel, ...models] : models;
  const chosen =
    options.find((m) => m.model === effectiveModelId) ?? options.find((m) => m.isDefault) ?? options[0];
  const selectedEffort = chosen?.supportedReasoningEfforts.some((e) => e.reasoningEffort === effectiveEffort)
    ? effectiveEffort
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
      if (args) {
        const sent = await onSend(args, modelId, effort, chosenAccess, [], 'plan');
        if (sent) clearOverrides();
        return sent;
      }
      return true;
    }
    return onCommand(name, args);
  }
  async function submit() {
    if (importingRef.current) return;
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
          modelId,
          effort,
          chosenAccess,
          images.map((i) => i.path),
          modeOverride,
        )
      ) {
        onDraft('');
        setImages([]);
        clearOverrides();
      }
    } finally {
      lock.current = false;
    }
  }
  async function attach() {
    if (sending || archived || importingRef.current) return;
    importingRef.current = true;
    setImporting(true);
    try {
      const result = await window.codexDesk?.pickImages();
      if (!result || !mounted.current) return;
      setImages((old) =>
        [...old, ...result.filter((image) => !old.some((o) => o.path === image.path))].slice(0, MAX_IMAGES),
      );
    } catch (e) {
      if (mounted.current) onError(e);
    } finally {
      importingRef.current = false;
      if (mounted.current) setImporting(false);
    }
  }
  async function pasteImages(files: File[]) {
    if (sending || archived) return;
    if (importingRef.current) {
      onError(new Error(t('正在添加图片，请稍候。', 'Please wait while images are being attached.')));
      return;
    }
    if (files.length + images.length > MAX_IMAGES) {
      onError(new Error(t('每条消息最多添加 8 张图片。', 'Attach up to 8 images per message.')));
      return;
    }
    if (files.some((file) => file.size > MAX_IMAGE_BYTES)) {
      onError(new Error(t('每张图片不能超过 20 MiB。', 'Each image must be 20 MiB or smaller.')));
      return;
    }
    importingRef.current = true;
    setImporting(true);
    try {
      if (!window.codexDesk)
        throw new Error(t('请在桌面应用中粘贴图片。', 'Paste images in the desktop application.'));
      const uploads = await Promise.all(
        files.map(async (file) => ({
          name: file.name.slice(0, 255) || 'clipboard.png',
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      );
      if (!mounted.current) return;
      const result = await window.codexDesk.importImages(uploads);
      if (mounted.current) setImages((old) => [...old, ...result]);
    } catch (error) {
      if (mounted.current) onError(error);
    } finally {
      importingRef.current = false;
      if (mounted.current) setImporting(false);
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
        {importing && (
          <div className="attachment-progress" role="status">
            <Loader2 size={14} className="spin" />
            {t('正在添加图片…', 'Attaching images…')}
          </div>
        )}
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            onDraft(e.target.value);
            if (e.target.value === '/') setCommandsOpen(true);
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files).filter((file) => file.type.startsWith('image/'));
            if (!files.length) return;
            // Preserve native text insertion (including selection/cursor position) for mixed clips.
            if (!e.clipboardData.getData('text/plain')) e.preventDefault();
            void pasteImages(files);
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
              disabled={sending || archived || importing || images.length >= MAX_IMAGES}
              onClick={() => void attach()}
              title={t('添加图片，也可 Ctrl+V 粘贴', 'Attach images, or paste with Ctrl+V')}
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
              disabled={disabled || importing || (!draft.trim() && !images.length)}
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
          approvalPolicy={
            chosenAccess
              ? chosenAccess === 'danger-full-access'
                ? 'never'
                : 'on-request'
              : initialApprovalPolicy
          }
          onChange={startup ? startup.onChange : setAccess}
          disabled={running || sending}
        />
        <span>
          {project?.name || t('默认工作区', 'Default workspace')} · Shift + Enter {t('换行', 'for newline')}
        </span>
      </div>
    </div>
  );
}
