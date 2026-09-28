import { useEffect, useRef, useState } from 'react';
import { App } from '../App';
import { RemoteBridge } from '../lib/remoteBridge';
import { Smartphone, Loader2, Link2 } from 'lucide-react';

export function RemoteEntry() {
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(true),
    [error, setError] = useState('');
  const [code, setCode] = useState(''),
    [name, setName] = useState('Android');
  const [zh, setZh] = useState(navigator.language.startsWith('zh'));
  const bridge = useRef<RemoteBridge | undefined>(undefined);
  const t = (cn: string, en: string) => (zh ? cn : en);
  function connected() {
    bridge.current?.dispose();
    bridge.current = new RemoteBridge();
    window.codexDesk = bridge.current;
    setReady(true);
  }
  useEffect(() => {
    document.documentElement.dataset.remote = 'true';
    document.documentElement.dataset.theme = 'dark';
    let disposed = false;
    const unpair = () => {
      bridge.current?.dispose();
      setReady(false);
      setCode('');
      setError('');
    };
    window.addEventListener('desk:pair-required', unpair);
    void fetch('/v1/session')
      .then((response) => {
        if (!disposed && response.ok) connected();
      })
      .catch(() => {
        if (!disposed) setError('无法连接电脑 / Could not connect to the computer.');
      })
      .finally(() => {
        if (!disposed) setBusy(false);
      });
    return () => {
      disposed = true;
      bridge.current?.dispose();
      window.removeEventListener('desk:pair-required', unpair);
    };
  }, []);
  if (ready) return <App />;
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
              connected();
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
      <p className="remote-note">
        {t(
          '手机与电脑需连接同一 Tailscale 网络。',
          'Connect your phone and computer to the same Tailscale network.',
        )}
      </p>
    </main>
  );
}
