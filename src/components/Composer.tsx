import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Square, Paperclip, X, Loader2, Slash, ListChecks, CornerUpRight, Zap } from 'lucide-react';
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
import { fastTier, isFastTier } from '../shared/speed';
import type { PendingSteer } from '../shared/steering';
import { SteeringQueue } from './SteeringQueue';

export function Composer({
  models,
  project,
  connected,
  sending,
  running,
  onSend,
  onSteer,
  activeTurnId,
  pendingSteers,
  steersSaved,
  onDismissSteer,
  onStop,
  draft,
  onDraft,
  onError,
  inputRef,
  archived,
  initialModel,
  initialServiceTier,
  onServiceTier,
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
  onSteer: (expectedTurnId: string, text: string, images: string[]) => Promise<boolean>;
  activeTurnId?: string;
  pendingSteers: PendingSteer[];
  steersSaved: boolean;
  onDismissSteer: (clientId: string) => void;
  onCommand: (name: string, args: string) => Promise<boolean>;
  onStop: () => void;
  draft: string;
  onDraft: (text: string) => void;
  onError: (e: unknown) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  archived: boolean;
  initialModel?: string | null;
  initialServiceTier?: string | null;
  onServiceTier: (tier: string | null) => Promise<void>;
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
  const [steerSent, setSteerSent] = useState(false);
  const [speedPending, setSpeedPending] = useState(false);
  const speedLock = useRef(false);
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  useEffect(() => setSteerSent(false), [activeTurnId]);
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
  const fast = isFastTier(initialServiceTier);
  const fastServiceTier = fastTier(chosen);
  const speedDisabled = !connected || sending || running || archived || blocked || speedPending;
  async function changeFast(enabled: boolean) {
    if (speedLock.current) return false;
    if (speedDisabled)
      throw new Error(
        t('请等待会话就绪后切换 Fast。', 'Wait until the conversation is ready to change Fast.'),
      );
    if (enabled && !fastServiceTier)
      throw new Error(t('当前模型未提供 Fast 模式。', 'Fast mode is not available for this model.'));
    speedLock.current = true;
    setSpeedPending(true);
    try {
      await onServiceTier(enabled ? fastServiceTier! : null);
      return true;
    } finally {
      speedLock.current = false;
      if (mounted.current) setSpeedPending(false);
    }
  }
  const selectedEffort = chosen?.supportedReasoningEfforts.some((e) => e.reasoningEffort === effectiveEffort)
    ? effectiveEffort
    : (chosen?.defaultReasoningEffort ?? 'medium');
  const lock = useRef(false);
  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.style.height = 'auto';
    inputRef.current.style.height = Math.min(200, inputRef.current.scrollHeight) + 'px';
  }, [draft, inputRef]);
  const disabled = !connected || sending || archived || blocked || speedPending;
  async function command(name: string, args = '') {
    setCommandsOpen(false);
    if (!name) {
      setCommandsOpen(true);
      return true;
    }
    if (name === 'fast') {
      const action = args.trim().toLowerCase();
      if (action === 'status') return onCommand('status', '');
      if (action === '' || action === 'on' || action === 'off')
        return changeFast(action === '' ? !fast : action === 'on');
      throw new Error(
        t('用法：/fast on、/fast off 或 /fast status', 'Use /fast on, /fast off or /fast status'),
      );
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
    if (disabled || lock.current || (!draft.trim() && !images.length)) return;
    lock.current = true;
    try {
      const sent = running
        ? !!activeTurnId &&
          (await onSteer(
            activeTurnId,
            draft,
            images.map((i) => i.path),
          ))
        : await onSend(
            draft,
            modelId,
            effort,
            startup ? undefined : chosenAccess,
            images.map((i) => i.path),
            modeOverride,
          );
      if (sent) {
        if (latestDraft.current === draft) onDraft('');
        setImages((current) => current.filter((image) => !images.some((sent) => sent.path === image.path)));
        if (running) setSteerSent(true);
        else clearOverrides();
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
      <SteeringQueue
        entries={pendingSteers}
        saved={steersSaved}
        onDismiss={onDismissSteer}
        onError={onError}
      />
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
            setSteerSent(false);
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
                ? t('补充说明或调整方向，Enter 插话…', 'Add details or change direction. Enter to steer…')
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
              disabled={!connected || sending || speedPending}
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
              disabled={!options.length || running || sending || speedPending}
            />
            {chosen && (
              <ModelPicker
                models={options}
                chosen={chosen}
                effort={selectedEffort}
                onModel={setModelId}
                onEffort={setEffort}
                disabled={running || sending || speedPending}
                effortOnly
              />
            )}
            <button
              type="button"
              className={`fast-toggle ${fast ? 'active' : ''}`}
              aria-label={t('Fast 模式', 'Fast mode')}
              aria-pressed={fast}
              aria-busy={speedPending}
              disabled={speedDisabled || (!fast && !fastServiceTier)}
              title={
                !fast && !fastServiceTier
                  ? t('当前模型未提供 Fast 模式', 'Fast mode is not available for this model')
                  : running
                    ? t('任务结束后可切换 Fast', 'Change Fast after the running task finishes')
                    : t(
                        `${fast ? '关闭' : '开启'} Fast · 更快，额度消耗更高`,
                        `Turn Fast ${fast ? 'off' : 'on'} · Faster, increased usage`,
                      )
              }
              onClick={() => void changeFast(!fast).catch(onError)}
            >
              {speedPending ? <Loader2 size={13} className="spin" /> : <Zap size={13} />}
              <span>Fast</span>
              <span className="fast-state">
                {initialServiceTier === undefined ? 'CLI' : fast ? t('开', 'On') : t('关', 'Off')}
              </span>
            </button>
          </div>
          <div className="composer-send-actions">
            {running && (
              <button
                className="send-button stop-button"
                onClick={onStop}
                aria-label={t('停止任务', 'Stop task')}
                title={t('停止任务', 'Stop task')}
              >
                <Square size={14} fill="currentColor" />
              </button>
            )}
            <button
              className={`send-button ${running ? 'steer-button' : ''}`}
              onClick={() => void submit()}
              disabled={disabled || importing || (!draft.trim() && !images.length)}
              aria-label={running ? t('插话', 'Steer') : t('发送消息', 'Send message')}
              title={
                running
                  ? t('追加到当前任务 · Enter', 'Add to the running task · Enter')
                  : t('发送消息', 'Send message')
              }
            >
              {sending ? (
                <Loader2 size={17} className="spin" />
              ) : running ? (
                <CornerUpRight size={17} />
              ) : (
                <ArrowUp size={19} strokeWidth={2.5} />
              )}
              {running && <span>{t('插话', 'Steer')}</span>}
            </button>
          </div>
        </div>
      </div>
      {steerSent && running && (
        <div className="steer-status" role="status">
          {t('插话已发送，Codex 将在当前任务中处理。', 'Steer sent. Codex will use it in the current task.')}
        </div>
      )}
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
          disabled={running || sending || speedPending}
        />
        <span>
          {project?.name || t('默认工作区', 'Default workspace')} · Shift + Enter {t('换行', 'for newline')}
        </span>
      </div>
    </div>
  );
}
