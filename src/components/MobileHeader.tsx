import { Menu, MoreHorizontal, SquarePen } from 'lucide-react';
import type { ThreadGoal } from '../shared/types';
import { useT } from '../lib/i18n';
import { GoalBadge } from './GoalPanel';

export function MobileHeader({
  title,
  workspace,
  ready,
  goal,
  onHistory,
  onNew,
  onActions,
  onGoal,
}: {
  title: string;
  workspace: string;
  ready: boolean;
  goal?: ThreadGoal | null;
  onHistory: () => void;
  onNew: () => void;
  onActions: () => void;
  onGoal: () => void;
}) {
  const t = useT();
  return (
    <header className="mobile-header">
      <button className="icon-button" onClick={onHistory} aria-label={t('展开侧栏', 'Expand sidebar')}>
        <Menu size={22} />
      </button>
      <div className="mobile-header-title">
        <strong>{title}</strong>
        <small>
          <i className={`status-dot ${ready ? '' : 'offline'}`} />
          {ready ? workspace : t('正在连接…', 'Connecting…')}
        </small>
      </div>
      {goal && <GoalBadge goal={goal} onClick={onGoal} compact />}
      <button className="icon-button" onClick={onNew} aria-label={t('新会话', 'New conversation')}>
        <SquarePen size={20} />
      </button>
      <button
        className="icon-button"
        onClick={onActions}
        aria-label={t('会话操作', 'Conversation actions')}
        aria-haspopup="dialog"
      >
        <MoreHorizontal size={22} />
      </button>
    </header>
  );
}
