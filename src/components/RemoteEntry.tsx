import { useEffect, useRef, useState } from 'react';
import { App } from '../App';
import { RemoteBridge } from '../lib/remoteBridge';
import { Smartphone, Loader2, Link2 } from 'lucide-react';
import {
  forgetPhoneSession,
  phoneSession,
  rememberPhoneSession,
  savedPhoneSession,
  type PhoneSession,
} from '../lib/historyStorage';

export function RemoteEntry() {
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(true),
    [error, setError] = useState('');
  const [code, setCode] = useState(''),
    [name, setName] = useState('Android');
  const [zh, setZh] = useState(navigator.language.startsWith('zh'));
  const bridge = useRef<RemoteBridge | undefined>(undefined);
  const sessionId = useRef<string | undefined>(undefined);
  const [identity, setIdentity] = useState('');
  const t = (cn: string, en: string) => (zh ? cn : en);
  function connected(session?: PhoneSession) {
    if (bridge.current && sessionId.current === session?.id) return;
    if (bridge.current && sessionId.current !== session?.id) {
      void bridge.current.historyStorage?.invalidate();
      forgetPhoneSession();
    }
    bridge.current?.dispose();
    if (session) rememberPhoneSession(session);
    sessionId.current = session?.id;
    bridge.current = new RemoteBridge(session);
    window.codexDesk = bridge.current;
    setIdentity(session?.id ?? 'paired');
    setReady(true);
  }
  useEffect(() => {
    document.documentElement.dataset.remote = 'true';
    document.documentElement.dataset.theme = 'dark';
    const viewport = window.visualViewport;
    const resize = () => {
      document.documentElement.style.setProperty(
        '--mobile-height',
        `${viewport?.height ?? window.innerHeight}px`,
      );
      document.documentElement.style.setProperty('--mobile-top', `${viewport?.offsetTop ?? 0}px`);
    };
    resize();
    window.addEventListener('resize', resize);
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    let disposed = false;
    let revision = 0;
    const unpair = () => {
      ++revision;
      void bridge.current?.historyStorage?.invalidate();
      bridge.current?.dispose();
      bridge.current = undefined;
      window.codexDesk = undefined;
      sessionId.current = undefined;
      forgetPhoneSession();
      setReady(false);
      setCode('');
      setError('');
    };
    window.addEventListener('desk:pair-required', unpair);
    const cachedSession = savedPhoneSession();
    if (cachedSession) connected(cachedSession);
    const initialRevision = revision;
    void fetch('/v1/session', { signal: AbortSignal.timeout(10_000) })
      .then(async (response) => {
        if (disposed || initialRevision !== revision) return;
        if (response.status === 401) {
          unpair();
          return;
        }
        if (response.ok) {
          const session = phoneSession(await response.json());
          if (!disposed && initialRevision === revision) connected(session);
        }
      })
      .catch(() => {
        if (!disposed && !bridge.current) setError('无法连接电脑 / Could not connect to the computer.');
      })
      .finally(() => {
        if (!disposed) setBusy(false);
      });
    return () => {
      disposed = true;
      bridge.current?.dispose();
      window.removeEventListener('desk:pair-required', unpair);
      window.removeEventListener('resize', resize);
      viewport?.removeEventListener('resize', resize);
      viewport?.removeEventListener('scroll', resize);
    };
  }, []);
  if (ready) return <App key={identity} />;
  return (
    <main className="remote-pair">
      <img src="./icon.svg" alt="" />
      <span className="remote-eyebrow">CODEX DESK · ANDROID</span>
      <h1>{t('连接你的电脑', 'Connect to your computer')}</h1>
      <p>
        {t(
          '在电脑的「设置 → 手机连接」中生成配对码。',
          'Create a pairing code in Settings → Phone access on your computer.',
        )}
      </p>
      <div className="remote-endpoint">
        <Link2 size={15} />
        {location.host}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          void fetch('/v1/pair', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: code.trim(), name }),
          })
            .then(async (response) => {
              const result = await response.json();
              if (!response.ok) throw new Error(result.error);
              connected(phoneSession(result.session));
            })
            .catch((e) => setError(String(e.message)))
            .finally(() => setBusy(false));
        }}
      >
        <label className="field-label">
          {t('设备名称', 'Device name')}
          <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="field-label">
          {t('配对码', 'Pairing code')}
          <input
            aria-label={t('配对码', 'Pairing code')}
            value={code}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button className="primary-button" disabled={busy || !code.trim() || !name.trim()}>
          {busy ? <Loader2 size={18} className="spin" /> : <Smartphone size={18} />}
          {t('配对并连接', 'Pair and connect')}
        </button>
      </form>
      <button className="text-button" onClick={() => setZh(!zh)}>
        {zh ? 'English' : '简体中文'}
      </button>
      {/CodexDeskAndroid\//.test(navigator.userAgent) && (
        <a className="text-button" href="/_desk/connection">
          {t('连接设置', 'Connection settings')}
        </a>
      )}
      <p className="remote-note">
        {t(
          '手机与电脑需连接同一 Tailscale 网络。',
          'Connect your phone and computer to the same Tailscale network.',
        )}
      </p>
    </main>
  );
}
