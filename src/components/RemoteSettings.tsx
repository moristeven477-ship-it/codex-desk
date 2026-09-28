import { useEffect, useState } from 'react';
import { Smartphone, Copy, RefreshCw, Link2, X } from 'lucide-react';
import { useT } from '../lib/i18n';
import { request } from '../lib/useDesk';
type Status = {
  enabled: boolean;
  port: number;
  publicOrigin: string;
  localOrigin: string;
  devices: { id: string; name: string; online: boolean }[];
  tailscale: { installed: boolean; state: string; url: string };
};
export function RemoteSettings({ onError }: { onError: (error: unknown) => void }) {
  const t = useT();
  const [status, setStatus] = useState<Status>(),
    [busy, setBusy] = useState(false);
  const [pair, setPair] = useState<{ code: string; expiresAt: number }>();
  async function refresh() {
    setStatus(await request<Status>('remote.status'));
  }
  useEffect(() => {
    void refresh().catch(onError);
  }, [onError]);
  async function action(method: string, params = {}) {
    setBusy(true);
    try {
      await request(method, params);
      await refresh();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="remote-settings">
      <h3>
        <Smartphone size={20} /> {t('在手机上继续工作', 'Continue on your phone')}
      </h3>
      <p className="muted">
        {t(
          '安卓端通过 Tailscale 控制这台电脑上的 Codex，会话和 CLI 设置保持同步。',
          'Control Codex on this computer through Tailscale. Conversations and CLI settings stay synchronized.',
        )}
      </p>
      <div className="setting-row">
        <span>{t('手机连接', 'Phone access')}</span>
        <button
          className="secondary-button"
          disabled={busy || !status}
          onClick={() => {
            setPair(undefined);
            void action(status?.enabled ? 'remote.stop' : 'remote.start');
          }}
        >
          {status?.enabled ? t('关闭连接', 'Disable access') : t('启用连接', 'Enable access')}
        </button>
      </div>
      {status?.enabled && (
        <>
          <p>
            {t(
              '关闭窗口后，Desk 会留在系统托盘继续提供手机连接。从托盘退出将断开手机。',
              'Closing the window keeps Desk in the system tray for phone access. Quitting from the tray disconnects the phone.',
            )}
          </p>
          <div className="remote-setup-step">
            <strong>1 · Tailscale</strong>
            <p>
              {status.tailscale.state === 'Running'
                ? t('已登录 Tailscale', 'Signed in to Tailscale')
                : t(
                    '请先在电脑和手机上登录同一 Tailscale 网络。安装说明见下方。',
                    'Sign in to the same Tailscale network on your computer and phone. See the setup guide below.',
                  )}
            </p>
            <button className="secondary-button" disabled={busy} onClick={() => void action('remote.serve')}>
              <Link2 size={14} />
              {t('配置 Tailscale 地址', 'Configure Tailscale address')}
            </button>
          </div>
          {status.publicOrigin && (
            <label className="field-label">
              {t('在安卓 App 中填写此地址', 'Enter this address in the Android app')}
              <div className="remote-copy-field">
                <input
                  readOnly
                  value={status.publicOrigin}
                  aria-label={t('手机连接地址', 'Phone connection address')}
                />
                <button
                  className="icon-button"
                  aria-label={t('复制地址', 'Copy address')}
                  onClick={() => void window.codexDesk?.copyText(status.publicOrigin).catch(onError)}
                >
                  <Copy size={16} />
                </button>
              </div>
            </label>
          )}
          <div className="remote-setup-step">
            <strong>2 · {t('配对手机', 'Pair your phone')}</strong>
            <p>
              {t(
                '配对码只能使用一次，5 分钟内有效。配对后的登录保留 30 天，可随时撤销。',
                'Pairing codes work once and expire in 5 minutes. Paired sessions last 30 days and can be revoked.',
              )}
            </p>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => {
                void request<{ code: string; expiresAt: number }>('remote.pair').then(setPair).catch(onError);
              }}
            >
              {t('生成配对码', 'Create pairing code')}
            </button>
          </div>
          {pair && (
            <div className="remote-pair-code">
              <code>{pair.code}</code>
              <button
                className="icon-button"
                aria-label={t('复制配对码', 'Copy pairing code')}
                onClick={() => void window.codexDesk?.copyText(pair.code).catch(onError)}
              >
                <Copy size={16} />
              </button>
              <small>
                {t('到期时间：', 'Expires: ')}
                {new Date(pair.expiresAt).toLocaleTimeString()}
              </small>
            </div>
          )}
          <h4>{t('已配对设备', 'Paired devices')}</h4>
          {status.devices.map((device) => (
            <div className="remote-device" key={device.id}>
              <Smartphone size={17} />
              <span>
                {device.name}
                <small>{device.online ? t('在线', 'Online') : t('离线', 'Offline')}</small>
              </span>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void action('remote.revoke', { id: device.id })}
              >
                <X size={14} />
                {t('撤销', 'Revoke')}
              </button>
            </div>
          ))}
          {!status.devices.length && <p className="muted">{t('尚未配对手机。', 'No paired devices yet.')}</p>}
        </>
      )}
      <div className="dialog-actions">
        <button className="text-button" onClick={() => void refresh().catch(onError)}>
          <RefreshCw size={14} />
          {t('刷新', 'Refresh')}
        </button>
        <button
          className="text-button"
          onClick={() =>
            void window.codexDesk
              ?.openExternal('https://github.com/moristeven477-ship-it/codex-desk/blob/main/docs/ANDROID.md')
              .catch(onError)
          }
        >
          {t('安卓安装与连接说明', 'Android setup guide')}
        </button>
      </div>
    </div>
  );
}
