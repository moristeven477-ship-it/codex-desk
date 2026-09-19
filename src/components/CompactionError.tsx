import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useT } from '../lib/i18n';

export function CompactionError({
  message,
  filtered,
  onRetry,
  onNew,
  onError,
}: {
  message: string;
  filtered: boolean;
  onRetry?: () => Promise<boolean>;
  onNew: () => void;
  onError: (error: unknown) => void;
}) {
  const t = useT();
  const [pending, setPending] = useState(false);
  return (
    <div className="turn-error compaction-error" role="alert">
      <strong>{t('上下文压缩失败', 'Context compaction failed')}</strong>
      <p>
        {filtered
          ? t(
              'Codex 远端服务返回了 content_filter，未完成压缩。原会话已保留。如果认为是误判，可通过 CLI 的 /feedback 反馈。',
              'The Codex service returned content_filter and did not finish compaction. This conversation is preserved. Use /feedback in the CLI if you believe this was a mistake.',
            )
          : t(
              'Codex 未能完成上下文压缩。原会话已保留，可稍后重试。',
              'Codex could not finish context compaction. This conversation is preserved; you can try again later.',
            )}
      </p>
      <details>
        <summary>{t('错误详情', 'Error details')}</summary>
        <pre>{message}</pre>
      </details>
      <div className="compaction-actions">
        {!filtered && onRetry && (
          <button
            className="secondary-button"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              try {
                await onRetry();
              } catch (error) {
                onError(error);
              } finally {
                setPending(false);
              }
            }}
          >
            {pending && <Loader2 size={14} className="spin" />}
            {t('重试压缩', 'Retry compaction')}
          </button>
        )}
        <button className="secondary-button" onClick={onNew}>
          {t('新建会话', 'Start a new conversation')}
        </button>
      </div>
    </div>
  );
}
