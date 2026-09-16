import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { ArrowDownToLine, Terminal } from 'lucide-react';
import { Dialog } from './Dialog';
import { request } from '../lib/useDesk';
import { useT } from '../lib/i18n';
import type { CodexEvent } from '../shared/types';
import { DEFAULT_FONT_SIZE } from '../shared/appearance';

export function CliTerminal({
  threadId,
  command,
  fontSize,
  onClose,
}: {
  threadId: string;
  command: string;
  fontSize: number;
  onClose: () => void;
}) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null),
    terminal = useRef<XTerm | null>(null),
    session = useRef('');
  const fitAddon = useRef<FitAddon | null>(null);
  const currentFontSize = useRef(fontSize);
  currentFontSize.current = fontSize;
  const [error, setError] = useState(''),
    [ready, setReady] = useState(false),
    [exited, setExited] = useState(false);
  useEffect(() => {
    if (!root.current) return;
    let disposed = false;
    const term = new XTerm({
      cursorBlink: true,
      fontFamily: "'Ubuntu Mono', 'DejaVu Sans Mono', monospace",
      fontSize: (14 * currentFontSize.current) / DEFAULT_FONT_SIZE,
      scrollback: 5000,
      theme: {
        background: '#10121b',
        foreground: '#e8e8f1',
        cursor: '#f0a2db',
        selectionBackground: '#a577aa66',
      },
      allowProposedApi: false,
    });
    terminal.current = term;
    const fit = new FitAddon();
    fitAddon.current = fit;
    term.loadAddon(fit);
    term.open(root.current);
    fit.fit();
    const buffered: CodexEvent[] = [];
    const receive = (event: CodexEvent) => {
      if (disposed || event.kind !== 'terminal') return;
      if (!session.current) {
        buffered.push(event);
        return;
      }
      if (event.terminalId !== session.current) return;
      if (event.data) term.write(event.data);
      if (event.exitCode !== undefined) {
        setExited(true);
        setReady(false);
      }
    };
    const unsubscribe = window.codexDesk?.subscribe(receive);
    const data = term.onData((value) => {
      if (session.current)
        void request('terminal.write', { id: session.current, data: value }).catch(() => {});
    });
    const resize = new ResizeObserver(() => {
      if (disposed) return;
      fit.fit();
      if (session.current)
        void request('terminal.resize', {
          id: session.current,
          cols: Math.max(20, term.cols),
          rows: Math.max(5, term.rows),
        }).catch(() => {});
    });
    resize.observe(root.current);
    void request<{ id: string }>('terminal.start', {
      threadId,
      cols: Math.max(20, term.cols),
      rows: Math.max(5, term.rows),
    })
      .then(({ id }) => {
        if (disposed) {
          void request('terminal.stop', { id }).catch(() => {});
          return;
        }
        session.current = id;
        setReady(true);
        buffered.splice(0).forEach(receive);
        term.focus();
      })
      .catch((reason) => {
        if (!disposed) setError(String(reason));
      });
    return () => {
      disposed = true;
      unsubscribe?.();
      resize.disconnect();
      data.dispose();
      term.dispose();
      terminal.current = null;
      fitAddon.current = null;
      if (session.current) void request('terminal.stop', { id: session.current }).catch(() => {});
      session.current = '';
    };
  }, [threadId]);
  useEffect(() => {
    const term = terminal.current;
    if (!term) return;
    term.options.fontSize = (14 * fontSize) / DEFAULT_FONT_SIZE;
    fitAddon.current?.fit();
    if (session.current)
      void request('terminal.resize', {
        id: session.current,
        cols: Math.max(20, term.cols),
        rows: Math.max(5, term.rows),
      }).catch(() => {});
  }, [fontSize]);
  // Keep commands as editable input. Enter is handled by the real TUI, including
  // its own pickers, feature gates and confirmation flows.
  async function insert() {
    try {
      if (!session.current) return;
      await request('terminal.write', {
        id: session.current,
        data: '\x15' + command.replace(/[\r\n]/g, ' '),
      });
      terminal.current?.focus();
    } catch (reason) {
      setError(String(reason));
    }
  }
  return (
    <Dialog
      title={t('Codex CLI · 同一会话', 'Codex CLI · Same conversation')}
      onClose={onClose}
      wide
      escapeCloses={false}
    >
      <div className="terminal-dialog">
        <div className="terminal-hint">
          <Terminal size={16} />
          <span>
            {t('真实 CLI，消息与目标同步到 Desk。', 'The real CLI. Messages and goals sync with Desk.')}
          </span>
        </div>
        {command && (
          <div className="terminal-command">
            <code>{command}</code>
            <button className="secondary-button" disabled={!ready} onClick={() => void insert()}>
              <ArrowDownToLine size={14} />
              {t('填入命令', 'Insert command')}
            </button>
            <small>
              {t('出现输入提示后填入，按 Enter 执行。', 'Insert at the CLI prompt, then press Enter.')}
            </small>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="embedded-terminal" ref={root} />
        {exited && (
          <p role="status">{t('CLI 已退出，可以关闭此面板。', 'CLI exited. You can close this panel.')}</p>
        )}
      </div>
    </Dialog>
  );
}
