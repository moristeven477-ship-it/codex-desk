import { useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useT } from '../lib/i18n';
import { useModalFocus } from '../lib/useModalFocus';
export function Dialog({
  title,
  onClose,
  children,
  wide = false,
  escapeCloses = true,
  className = '',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  escapeCloses?: boolean;
  className?: string;
}) {
  const t = useT(),
    ref = useRef<HTMLDivElement>(null),
    id = useId();
  useModalFocus(ref, onClose, true, escapeCloses);
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
        className={`dialog ${wide ? 'wide' : ''} ${className}`}
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
