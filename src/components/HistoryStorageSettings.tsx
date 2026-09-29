import { useEffect, useState } from 'react';
import { Database, Loader2 } from 'lucide-react';
import { useT } from '../lib/i18n';

export function HistoryStorageSettings() {
  const t = useT();
  const storage = window.codexDesk?.historyStorage;
  const [stats, setStats] = useState<Awaited<ReturnType<NonNullable<typeof storage>['stats']>>>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      void storage?.stats().then((value) => {
        if (!disposed) setStats(value);
      });
    };
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [storage]);
  if (!storage) return null;
  return (
    <section className="history-storage-setting">
      <div className="setting-row">
        <div>
          <Database size={17} />
          <span>{t('手机本地缓存', 'Phone history cache')}</span>
        </div>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void storage
              .clear()
              .then(() => storage.stats())
              .then(setStats)
              .finally(() => setBusy(false));
          }}
        >
          {busy && <Loader2 size={14} className="spin" />}
          {t('清除缓存', 'Clear history cache')}
        </button>
      </div>
      <p className="settings-help" role="status">
        {stats?.available === false
          ? t(
              '此设备暂时无法保存缓存，仍可在线读取会话。',
              'Local storage is unavailable. Conversations still load from the computer.',
            )
          : stats
            ? t(
                `${stats.conversations} 个会话 · ${(stats.bytes / 1024 / 1024).toFixed(1)} / ${Math.round(stats.limit / 1024 / 1024)} MB`,
                `${stats.conversations} conversations · ${(stats.bytes / 1024 / 1024).toFixed(1)} / ${Math.round(stats.limit / 1024 / 1024)} MB`,
              )
            : t('正在读取缓存信息…', 'Reading storage usage…')}
      </p>
      <p className="settings-help">
        {t(
          '自动保存已读会话，先显示本地记录，再与电脑同步。最多保留 80 个会话；清除缓存不会删除电脑上的记录或手机草稿。',
          'Opened conversations appear from local storage, then sync with the computer. Keeps up to 80 conversations. Clearing this cache preserves computer history and phone drafts.',
        )}
      </p>
    </section>
  );
}
