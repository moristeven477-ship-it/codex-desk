import { useEffect, useState } from 'react';
import { Check, Copy, Loader2, Terminal, Radio } from 'lucide-react';
import { Dialog } from './Dialog';
import { useT } from '../lib/i18n';
import { request } from '../lib/useDesk';

export function SyncDialog({
  threadId,
  external,
  onClose,
  onError,
}: {
  threadId: string;
  external: boolean;
  onClose: () => void;
  onError: (error: unknown) => void;
}) {
  const t = useT();
  const [command, setCommand] = useState(''),
    [copied, setCopied] = useState(false),
    [opening, setOpening] = useState(false);
  useEffect(() => {
    let live = true;
    void request<{ command: string }>('thread.terminalCommand', { threadId })
      .then((result) => {
        if (live) setCommand(result.command);
      })
      .catch(onError);
    return () => {
      live = false;
    };
  }, [threadId, onError]);
  return (
    <Dialog title={t('与 Codex CLI 同步', 'Sync with Codex CLI')} onClose={onClose}>
      <div className="sync-dialog-content">
        <div className="sync-intro">
          <Radio size={24} />
          <div>
            <h3>{t('同一会话，两个入口', 'One conversation, two interfaces')}</h3>
            <p>
              {t(
                'CLI 和 Desk 共享消息、回复与运行状态，使用同一个会话 ID。',
                'CLI and Desk share messages, responses, and running state using the same conversation ID.',
              )}
            </p>
          </div>
        </div>
        {external && (
          <div className="sync-instructions" role="note">
            <strong>
              {t('先退出原来的独立 CLI 会话', 'Exit the original standalone CLI session first')}
            </strong>
            <p>
              {t(
                '在原终端结束当前任务并退出 Codex，然后使用下面的入口重新打开。历史与会话 ID 会保留，Desk 会自动连接。',
                'Finish the active task and exit Codex in the original terminal, then reopen it below. History and the conversation ID stay the same; Desk reconnects automatically.',
              )}
            </p>
          </div>
        )}
        <label className="field-label">
          {t('也可以复制命令到终端', 'Or copy this command into your terminal')}
          <textarea
            className="sync-command"
            aria-label={t('CLI 同步命令', 'CLI sync command')}
            readOnly
            value={command}
            rows={4}
          />
        </label>
        <p className="muted">
          {t(
            '关闭 Desk 后，共享服务与 CLI 任务会继续运行。',
            'Closing Desk keeps the shared service and CLI tasks running.',
          )}
        </p>
        <div className="dialog-actions">
          <button
            className="secondary-button"
            disabled={!command}
            onClick={() => {
              void navigator.clipboard
                .writeText(command)
                .then(() => setCopied(true))
                .catch(onError);
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? t('已复制', 'Copied') : t('复制命令', 'Copy command')}
          </button>
          <button
            className="primary-button"
            disabled={!command || opening}
            onClick={() => {
              setOpening(true);
              void window.codexDesk
                ?.openTerminal(threadId)
                .then(onClose)
                .catch(onError)
                .finally(() => setOpening(false));
            }}
          >
            {opening ? <Loader2 size={15} className="spin" /> : <Terminal size={15} />}
            {t('在终端同步打开', 'Open synced terminal')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
