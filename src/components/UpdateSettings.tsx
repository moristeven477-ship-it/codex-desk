import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { UpdateState } from '../shared/updates';
import { request } from '../lib/useDesk';
import { useT } from '../lib/i18n';

export function UpdateSettings({
  enabled,
  onChange,
  onError,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const t = useT();
  const [state, setState] = useState<UpdateState>({ phase: 'idle' });
  useEffect(() => {
    let mounted = true;
    const read = () =>
      void request<UpdateState>('updates.status')
        .then((value) => {
          if (mounted) setState(value);
        })
        .catch(() => {});
    read();
    const timer = setInterval(read, 1500);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);
  const messages: Record<UpdateState['phase'], string> = {
    idle: t('会自动检查正式版本。', 'Stable releases are checked automatically.'),
    checking: t('正在检查更新…', 'Checking for updates…'),
    downloading: t(
      `正在下载 ${state.version} · ${state.progress ?? 0}%`,
      `Downloading ${state.version} · ${state.progress ?? 0}%`,
    ),
    ready: t(
      `${state.version} 已就绪；任务结束且电脑空闲后自动安装并重启。`,
      `${state.version} is ready. It will install and restart when tasks finish and your computer is idle.`,
    ),
    installing: t('正在安装并重启…', 'Installing and restarting…'),
    current: t('已是最新正式版本。', 'You have the latest stable release.'),
    unsupported: t(
      '此安装方式由系统包管理器更新；个人目录中的 AppImage 支持自动更新。',
      'Use your package manager for this installation. AppImages in your own directory support automatic updates.',
    ),
    error: t('更新失败，可稍后重试。', 'The update failed. You can retry later.'),
  };
  return (
    <div className="update-settings">
      <div className="setting-row">
        <div>
          <RefreshCw size={17} />
          <span>{t('自动更新', 'Automatic updates')}</span>
        </div>
        <input
          type="checkbox"
          aria-label={t('自动更新', 'Automatic updates')}
          checked={enabled}
          onChange={(event) => void onChange(event.target.checked).catch(onError)}
        />
      </div>
      <p className="settings-help">
        {t(
          '自动下载、校验 Desk 新版，并在空闲时安装；Codex CLI 升级后自动切换后台。',
          'Download and verify Desk releases, then install while idle. Switch the backend after Codex CLI upgrades.',
        )}
      </p>
      <p className="settings-help" role="status">
        {messages[state.phase]}
      </p>
      {state.error && <p className="settings-help">{state.error}</p>}
      <button
        className="secondary-button"
        disabled={['unsupported', 'checking', 'downloading', 'installing'].includes(state.phase)}
        onClick={() => {
          void request<UpdateState>('updates.check').then(setState).catch(onError);
        }}
      >
        <RefreshCw size={14} />
        {t('检查更新', 'Check for updates')}
      </button>
    </div>
  );
}
