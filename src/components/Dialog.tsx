import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useT } from '../lib/i18n';
export function Dialog({
  title,
  onClose,
  children,
  wide = false,
  escapeCloses = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  escapeCloses?: boolean;
}) {
  const t = useT(),
    ref = useRef<HTMLDivElement>(null),
    id = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const original = document.activeElement as HTMLElement;
    const selector = 'button, input, select, textarea, a[href], [tabindex="0"]';
    const nodes = () =>
      [...(ref.current?.querySelectorAll<HTMLElement>(selector) ?? [])].filter(
        (e) => !e.hasAttribute('disabled'),
      );
    nodes()[0]?.focus();
    function key(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape' && escapeCloses) close.current();
      if (event.key === 'Tab') {
        const list = nodes(),
          first = list[0],
          last = list.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      original?.focus();
    };
  }, [escapeCloses]);
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={`dialog ${wide ? 'wide' : ''}`}
      >
        <header>
          <h2 id={id}>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label={t('关闭', 'Close')}>
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
