import { useCallback, useEffect, useRef, useState } from 'react';
import { Smartphone, Copy, RefreshCw, ExternalLink, X, Check, LoaderCircle, Download } from 'lucide-react';
import { useT } from '../lib/i18n';
import { request } from '../lib/useDesk';
import type { PhoneStatus, SetupStage } from '../shared/remote';

export function RemoteSettings({ onError }: { onError: (error: unknown) => void }) {
  const t = useT();
  const [status, setStatus] = useState<PhoneStatus>(),
    [busy, setBusy] = useState(false);
  const [pair, setPair] = useState<{ code: string; expiresAt: number }>();
  const [now, setNow] = useState(Date.now());
  const pairRequested = useRef(false);
  const refresh = useCallback(async () => {
    setStatus(await request<PhoneStatus>('remote.status'));
  }, []);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const value = await request<PhoneStatus>('remote.status');
        if (!disposed) {
          setStatus(value);
          setNow(Date.now());
        }
      } catch (error) {
        if (!disposed) onError(error);
      }
      if (!disposed) timer = setTimeout(() => void poll(), 1500);
    }
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [onError]);
  const stage = status?.setup.stage ?? 'idle';
  const ready = !!(
    status?.enabled &&
    !status.setup.active &&
    stage !== 'error' &&
    status.tailscale.state === 'Running' &&
    status.publicOrigin &&
    status.publicOrigin === status.tailscale.url
  );
  const createPair = useCallback(async () => {
    setPair(await request<{ code: string; expiresAt: number }>('remote.pair'));
    setNow(Date.now());
  }, []);
  useEffect(() => {
    if (ready && !pairRequested.current && !status?.devices.length) {
      pairRequested.current = true;
      void createPair().catch(onError);
    }
  }, [ready, status?.devices.length, createPair, onError]);
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
  const open = (url: string) => void window.codexDesk?.openExternal(url).catch(onError);
  const labels: Record<SetupStage, [string, string]> = {
    idle: ['连接你的手机', 'Connect your phone'],
    checking: ['正在检查电脑连接…', 'Checking this computer…'],
    downloading: ['正在下载 Tailscale…', 'Downloading Tailscale…'],
    installing: ['正在校验并安装…', 'Verifying and installing…'],
    starting: ['正在启动连接…', 'Starting the connection…'],
    login: ['登录 Tailscale', 'Sign in to Tailscale'],
    approval: ['需要批准这台设备', 'Approve this device'],
    https: ['启用安全连接', 'Enable secure connections'],
    serving: ['正在配置连接地址…', 'Configuring your address…'],
    ready: ['电脑已就绪', 'Computer is ready'],
    error: ['设置未完成', 'Setup needs attention'],
  };
  const active = !!status?.setup.active;
  const expired = pair && pair.expiresAt <= now;
  return (
    <div className="remote-settings">
      <h3>
        <Smartphone size={20} /> {t('在手机上继续工作', 'Continue on your phone')}
      </h3>
      <p className="muted">
        {t(
          'Desk 自动安装并配置电脑连接。登录后，将地址和配对码填入安卓 App，即可继续同一个 Codex 会话。',
          'Desk installs and configures your computer connection. Sign in, then enter the address and pairing code in Android to continue the same Codex conversation.',
        )}
      </p>
      <div className={`remote-setup-card ${ready ? 'is-ready' : ''}`}>
        <div className="remote-step-heading">
          <span className="remote-step-number">{ready ? <Check size={17} /> : '1'}</span>
          <strong>{t('连接这台电脑', 'Connect this computer')}</strong>
          {active && <LoaderCircle size={17} className="remote-spinner" aria-hidden="true" />}
        </div>
        <p role="status" aria-live="polite" className="remote-setup-status">
          {t(...labels[ready ? 'ready' : stage === 'ready' ? 'idle' : stage])}
        </p>
        {stage === 'idle' && !ready && (
          <p>
            {t(
              '点击一次，Desk 会完成下载、安装和地址配置。',
              'One click starts the download, installation and address setup.',
            )}
          </p>
        )}
        {stage === 'downloading' && (
          <progress
            max={100}
            value={status?.setup.progress}
            aria-label={t('下载进度', 'Download progress')}
          />
        )}
        {['login', 'approval', 'https'].includes(stage) && (
          <p>
            {stage === 'login'
              ? t(
                  '使用与手机相同的 Tailscale 账号登录。完成后这里会自动继续，无需输入命令。',
                  'Sign in with the same Tailscale account as your phone. Setup continues automatically when you finish.',
                )
              : stage === 'https'
                ? t(
                    '在 Tailscale 页面开启 HTTPS。完成后，Desk 会自动生成手机连接地址。',
                    'Enable HTTPS on the Tailscale page. Desk will then finish your phone connection address automatically.',
                  )
                : t(
                    '在 Tailscale 管理页面批准这台电脑，Desk 会自动继续。',
                    'Approve this computer in Tailscale. Desk will continue automatically.',
                  )}
          </p>
        )}
        {status?.setup.actionUrl && (
          <button className="primary-button" onClick={() => open(status.setup.actionUrl!)}>
            <ExternalLink size={15} />
            {stage === 'https'
              ? t('启用 HTTPS', 'Enable HTTPS')
              : stage === 'approval'
                ? t('打开设备管理', 'Open device approval')
                : t('登录 Tailscale', 'Sign in to Tailscale')}
          </button>
        )}
        {active && ['login', 'https', 'approval'].includes(stage) && (
          <button className="text-button" disabled={busy} onClick={() => void action('remote.retry')}>
            {t('重新获取连接', 'Retry connection setup')}
          </button>
        )}
        {stage === 'error' && (
          <p className="remote-setup-error" role="alert">
            {status?.setup.error}
          </p>
        )}
        {!active && !ready && (
          <button
            className="primary-button"
            disabled={busy || !status}
            onClick={() => {
              pairRequested.current = false;
              setPair(undefined);
              void action('remote.setup');
            }}
          >
            <RefreshCw size={15} />
            {stage === 'error' || status?.enabled
              ? t('重新设置连接', 'Retry setup')
              : t('一键设置手机连接', 'Set up phone access')}
          </button>
        )}
        {ready && (
          <label className="field-label">
            {t('手机连接地址', 'Phone connection address')}
            <div className="remote-copy-field">
              <input
                readOnly
                value={status?.publicOrigin ?? ''}
                aria-label={t('手机连接地址', 'Phone connection address')}
              />
              <button
                className="icon-button"
                aria-label={t('复制地址', 'Copy address')}
                onClick={() => void window.codexDesk?.copyText(status!.publicOrigin).catch(onError)}
              >
                <Copy size={16} />
              </button>
            </div>
          </label>
        )}
      </div>
      <div className="remote-setup-card">
        <div className="remote-step-heading">
          <span className="remote-step-number">2</span>
          <strong>{t('在安卓手机上连接', 'Connect from Android')}</strong>
        </div>
        <ol className="remote-phone-steps">
          <li>
            {t(
              '安装 Codex Desk 安卓版。APK 已内置 Tailscale，无需另装应用。',
              'Install Codex Desk for Android. Tailscale is included in the APK; no separate app is needed.',
            )}
          </li>
          <li>
            {t(
              '在安卓 Desk 点击「登录内置 Tailscale」，使用与电脑相同的账号。',
              'In Android Desk, tap Sign in to built-in Tailscale and use the same account as your computer.',
            )}
          </li>
          <li>
            {t(
              '回到安卓 Desk，填入上面的地址和下面的配对码。',
              'Return to Android Desk and enter the address above and pairing code below.',
            )}
          </li>
        </ol>
        <button
          className="secondary-button"
          onClick={() => open('https://github.com/moristeven477-ship-it/codex-desk/releases/latest')}
        >
          <Download size={15} />
          {t('下载安卓 App', 'Get Android app')}
        </button>
        {ready && (
          <>
            <div className="remote-pair-actions">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void createPair().catch(onError)}
              >
                {pair ? t('刷新配对码', 'Refresh pairing code') : t('生成配对码', 'Create pairing code')}
              </button>
              <span className="muted">{t('一次有效 · 5 分钟过期', 'Single use · Expires in 5 minutes')}</span>
            </div>
            {pair && (
              <div className={`remote-pair-code ${expired ? 'is-expired' : ''}`}>
                {expired ? (
                  <span>{t('配对码已过期，请刷新。', 'Pairing code expired. Generate a new one.')}</span>
                ) : (
                  <>
                    <code>{pair.code}</code>
                    <button
                      className="icon-button"
                      aria-label={t('复制配对码', 'Copy pairing code')}
                      onClick={() => void window.codexDesk?.copyText(pair.code).catch(onError)}
                    >
                      <Copy size={16} />
                    </button>
                  </>
                )}
                {!expired && (
                  <small>
                    {t('到期时间：', 'Expires: ')}
                    {new Date(pair.expiresAt).toLocaleTimeString()}
                  </small>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {status?.enabled && (
        <>
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
          <p>
            {t(
              '保持电脑开机。关闭 Desk 窗口后连接会在托盘继续运行；从托盘退出会断开手机。',
              'Keep your computer awake. Closing Desk keeps the connection running in the tray; quitting from the tray disconnects your phone.',
            )}
          </p>
        </>
      )}
      <div className="dialog-actions">
        {status?.enabled && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              setPair(undefined);
              pairRequested.current = false;
              void action('remote.stop');
            }}
          >
            {t('关闭连接', 'Disable access')}
          </button>
        )}
        <button
          className="text-button"
          onClick={() =>
            open('https://github.com/moristeven477-ship-it/codex-desk/blob/main/docs/ANDROID.md')
          }
        >
          {t('连接帮助', 'Connection help')}
        </button>
      </div>
    </div>
  );
}
