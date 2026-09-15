import { useState } from 'react';
import {
  Check,
  ExternalLink,
  Loader2,
  RefreshCw,
  Terminal,
  Monitor,
  Languages,
  Sun,
  Moon,
  LogIn,
} from 'lucide-react';
import type { Bootstrap, Settings as Preferences } from '../shared/types';
import { Dialog } from './Dialog';
import { useT } from '../lib/i18n';
import { request } from '../lib/useDesk';

export function Settings({
  boot,
  onClose,
  onSave,
  onReconnect,
  onError,
}: {
  boot: Bootstrap;
  onClose: () => void;
  onSave: (patch: Partial<Preferences>) => Promise<void>;
  onReconnect: () => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const t = useT(),
    [binary, setBinary] = useState(boot.settings.binaryPath),
    [home, setHome] = useState(boot.settings.codexHome);
  const [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [tab, setTab] = useState('general');
  async function save(reconnect: boolean) {
    setBusy(true);
    setSaved(false);
    try {
      await onSave({ binaryPath: binary.trim(), codexHome: home.trim() });
      if (reconnect) await onReconnect();
      setSaved(true);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function login() {
    setBusy(true);
    try {
      const result = await request<{ authUrl?: string }>('account.login');
      if (result.authUrl) await window.codexDesk?.openExternal(result.authUrl);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={t('设置', 'Settings')} onClose={onClose} wide>
      <div className="settings-layout">
        <nav className="settings-nav">
          <button className={tab === 'general' ? 'active' : ''} onClick={() => setTab('general')}>
            <Monitor size={16} />
            {t('通用', 'General')}
          </button>
          <button className={tab === 'codex' ? 'active' : ''} onClick={() => setTab('codex')}>
            <Terminal size={16} />
            Codex CLI
          </button>
          <div className="settings-version">
            Codex Desk
            <br />v{boot.appVersion} · MIT
          </div>
        </nav>
        <div className="settings-content">
          {tab === 'general' ? (
            <>
              <h3>{t('让这里更适合你', 'Make yourself at home')}</h3>
              <p className="muted">
                {t('界面偏好保存在这台电脑上。', 'Your preferences stay on this computer.')}
              </p>
              <div className="setting-row">
                <div>
                  <Languages size={17} />
                  <span>{t('界面语言', 'Language')}</span>
                </div>
                <select
                  aria-label={t('界面语言', 'Language')}
                  value={boot.settings.locale}
                  onChange={(e) => void onSave({ locale: e.target.value as 'en' | 'zh' }).catch(onError)}
                >
                  <option value="zh">简体中文</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div className="setting-row">
                <div>
                  <Monitor size={17} />
                  <span>{t('外观', 'Appearance')}</span>
                </div>
                <div className="segmented">
                  <button
                    className={boot.settings.theme === 'dark' ? 'active' : ''}
                    onClick={() => void onSave({ theme: 'dark' }).catch(onError)}
                  >
                    <Moon size={14} />
                    {t('深色', 'Dark')}
                  </button>
                  <button
                    className={boot.settings.theme === 'light' ? 'active' : ''}
                    onClick={() => void onSave({ theme: 'light' }).catch(onError)}
                  >
                    <Sun size={14} />
                    {t('浅色', 'Light')}
                  </button>
                </div>
              </div>
              <div className="about-card">
                <img src="./icon.svg" alt="" />
                <div>
                  <strong>Codex Desk</strong>
                  <p>
                    {t('专为 Codex CLI 而生的本地工作空间。', 'A local workspace dedicated to Codex CLI.')}
                  </p>
                  <button
                    className="text-button"
                    onClick={() =>
                      void window.codexDesk
                        ?.openExternal('https://github.com/moristeven477-ship-it/codex-desk')
                        .catch(onError)
                    }
                  >
                    {t('在 GitHub 上查看源码', 'View source on GitHub')}
                    <ExternalLink size={12} />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <h3>{t('连接本机 Codex', 'Connect to local Codex')}</h3>
              <p className="muted">
                {t('使用已安装的 CLI 和已有登录状态。', 'Use your installed CLI and existing sign-in.')}
              </p>
              <div className="connection-card">
                <span className={`status-dot ${boot.connection.phase === 'ready' ? '' : 'offline'}`} />
                <div>
                  <strong>{boot.connection.version || t('尚未连接', 'Not connected')}</strong>
                  <small>{boot.connection.binary || 'npm install -g @openai/codex'}</small>
                </div>
              </div>
              <label className="field-label">
                {t('Codex 可执行文件', 'Codex executable')}
                <input
                  value={binary}
                  onChange={(e) => setBinary(e.target.value)}
                  placeholder={t('自动检测，或输入完整路径', 'Auto-detect, or enter an absolute path')}
                />
              </label>
              <label className="field-label">
                CODEX_HOME
                <input
                  value={home}
                  onChange={(e) => setHome(e.target.value)}
                  placeholder={boot.connection.codexHome || '~/.codex (default)'}
                />
              </label>
              <p className="settings-help">
                {t(
                  '留空使用 Codex 默认值。切换安装位置后，请重新连接。',
                  'Leave blank to use Codex defaults. Reconnect after changing these paths.',
                )}
              </p>
              <div className="account-row">
                <div>
                  <strong>{t('登录状态', 'Account')}</strong>
                  <p>
                    {boot.account ? boot.account.email || boot.account.type : t('未登录', 'Not signed in')}
                    {boot.account?.planType && ` · ${boot.account.planType}`}
                  </p>
                </div>
                {!boot.account && (
                  <button
                    className="secondary-button"
                    disabled={busy || boot.connection.phase !== 'ready'}
                    onClick={() => void login()}
                  >
                    <LogIn size={14} />
                    {t('登录', 'Sign in')}
                  </button>
                )}
              </div>
              <div className="settings-actions">
                {saved && (
                  <span className="saved">
                    <Check size={14} />
                    {t('已保存', 'Saved')}
                  </span>
                )}
                <button className="secondary-button" disabled={busy} onClick={() => void save(false)}>
                  {t('保存', 'Save')}
                </button>
                <button className="primary-button" disabled={busy} onClick={() => void save(true)}>
                  {busy ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
                  {t('保存并连接', 'Save & connect')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
