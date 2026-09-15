import { Dialog } from './Dialog';
import { useT } from '../lib/i18n';
import type { Bootstrap, Thread } from '../shared/types';

export function StatusPanel({
  boot,
  thread,
  usage,
  onClose,
}: {
  boot: Bootstrap;
  thread?: Thread;
  usage?: { total: number; context: number; limit: number };
  onClose: () => void;
}) {
  const t = useT();
  const rows = [
    [t('Codex 版本', 'Codex version'), boot.connection.version || '—'],
    [t('会话 ID', 'Conversation ID'), thread?.id || '—'],
    [t('工作目录', 'Working directory'), thread?.cwd || boot.defaultWorkspace],
    [t('模型', 'Model'), thread?.model || boot.models.find((model) => model.isDefault)?.displayName || '—'],
    [t('推理强度', 'Reasoning effort'), thread?.reasoningEffort || '—'],
    [t('权限', 'Permissions'), thread?.permissionMode || 'workspace-write'],
    [t('模式', 'Mode'), thread?.collaborationMode === 'plan' ? t('计划', 'Plan') : t('默认', 'Default')],
    [
      t('同步', 'Sync'),
      thread?.syncState === 'external'
        ? t('等待原 CLI 退出', 'Waiting for standalone CLI')
        : boot.connection.shared
          ? t('共享本机服务', 'Shared local server')
          : '—',
    ],
    [t('账户', 'Account'), boot.account?.email || boot.account?.type || '—'],
    [t('累计 tokens', 'Total tokens'), usage ? usage.total.toLocaleString() : '—'],
    [
      t('上下文 tokens', 'Context tokens'),
      usage ? `${usage.context.toLocaleString()} / ${usage.limit.toLocaleString()}` : '—',
    ],
  ];
  return (
    <Dialog title={t('会话状态', 'Session status')} onClose={onClose}>
      <dl className="session-status">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
