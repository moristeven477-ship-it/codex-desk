import { useEffect } from 'react';
import { CircleCheck, CircleAlert, X } from 'lucide-react';
import type { CompletionNotice } from '../shared/completion';
import { useT } from '../lib/i18n';

export function CompletionToast({
  notice,
  onView,
  onClose,
}: {
  notice: CompletionNotice;
  onView: () => void;
  onClose: () => void;
}) {
  const t = useT();
  useEffect(() => {
    const timer = setTimeout(onClose, 8000);
    return () => clearTimeout(timer);
  }, [notice, onClose]);
  return (
    <div className={`completion-toast ${notice.failed ? 'failed' : ''}`} role="status">
      {notice.failed ? <CircleAlert size={22} /> : <CircleCheck size={22} />}
      <div>
        <strong>
          {notice.failed ? t('任务执行失败', 'Task failed') : t('任务已完成', 'Task completed')}
        </strong>
        <span>{t('Codex 已结束本轮任务', 'Codex finished this turn')}</span>
      </div>
      <button className="text-button" onClick={onView}>
        {t('查看会话', 'View conversation')}
      </button>
      <button
        className="icon-button"
        onClick={onClose}
        aria-label={t('关闭完成提醒', 'Dismiss completion notice')}
      >
        <X size={15} />
      </button>
    </div>
  );
}
