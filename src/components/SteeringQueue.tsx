import { useLayoutEffect, useRef } from 'react';
import { CornerUpRight, Image, Loader2, CircleHelp, X } from 'lucide-react';
import type { PendingSteer } from '../shared/steering';
import { useT } from '../lib/i18n';
import { CopyButton } from './Chat';

export function SteeringQueue({
  entries,
  saved,
  onDismiss,
  onError,
}: {
  entries: PendingSteer[];
  saved: boolean;
  onDismiss: (clientId: string) => void;
  onError: (error: unknown) => void;
}) {
  const t = useT();
  const list = useRef<HTMLDivElement>(null);
  const newest = entries.at(-1)?.clientId;
  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [newest]);
  if (!entries.length) return null;
  return (
    <section className="steering-queue" aria-label={t('已提交的插话', 'Submitted steering')}>
      <header>
        <CornerUpRight size={14} />
        <strong>{t('插话', 'Steering')}</strong>
        <span>{entries.length}</span>
      </header>
      <div className="steering-entries" ref={list}>
        {entries.map((entry) => (
          <article className="steering-entry" key={entry.clientId} data-client-id={entry.clientId}>
            <div className="steering-entry-heading">
              <span className={`steering-delivery ${entry.phase}`} role="status">
                {entry.phase === 'unconfirmed' ? (
                  <CircleHelp size={13} />
                ) : (
                  <Loader2 size={13} className="spin" />
                )}
                {entry.phase === 'sending'
                  ? t('正在提交…', 'Submitting…')
                  : entry.phase === 'submitted'
                    ? t('已提交 · 等待 Codex 接收', 'Submitted · Waiting for Codex')
                    : t('尚未确认接收', 'Receipt not confirmed')}
              </span>
              {!!entry.text && <CopyButton text={entry.text} onError={onError} />}
              {entry.phase === 'unconfirmed' && (
                <button
                  className="icon-button"
                  onClick={() => onDismiss(entry.clientId)}
                  aria-label={t('隐藏这条插话提示', 'Hide this steering receipt')}
                  title={t(
                    '仅隐藏此提示，不会撤回已提交的内容',
                    'Hide this receipt; submitted input is not withdrawn',
                  )}
                >
                  <X size={13} />
                </button>
              )}
            </div>
            {!!entry.text && <div className="steering-text">{entry.text}</div>}
            {entry.images.map((file) => (
              <div className="attachment-label" key={file}>
                <Image size={14} />
                {file.split('/').at(-1)}
              </div>
            ))}
          </article>
        ))}
      </div>
      {!saved && (
        <p className="steering-storage-error" role="alert">
          {t(
            '无法保存到本地，当前窗口仍会保留插话内容。',
            'Could not save locally. Your steering remains visible in this window.',
          )}
        </p>
      )}
    </section>
  );
}
