import { useEffect, useRef, type RefObject } from 'react';

export function useModalFocus(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  enabled = true,
  escapeCloses = true,
) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!enabled) return;
    const original = document.activeElement as HTMLElement | null;
    const nodes = () =>
      [
        ...(ref.current?.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, a[href], [tabindex="0"]',
        ) ?? []),
      ].filter((node) => !node.hasAttribute('disabled') && node.getClientRects().length > 0);
    (nodes()[0] ?? ref.current)?.focus({ preventScroll: true });
    function key(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape' && escapeCloses) {
        event.preventDefault();
        close.current();
      }
      if (event.key !== 'Tab') return;
      const list = nodes(),
        first = list[0],
        last = list.at(-1);
      if (!first) {
        event.preventDefault();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || !ref.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !ref.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      if (original?.isConnected) original.focus({ preventScroll: true });
    };
  }, [enabled, escapeCloses, ref]);
}
