import { useEffect, useRef, useState } from 'react';
import { Type } from 'lucide-react';
import { DEFAULT_FONT_SIZE, MAX_FONT_SIZE, MIN_FONT_SIZE } from '../shared/appearance';
import { applyFontSize } from '../lib/appearance';
import { useT } from '../lib/i18n';

export function FontSizeControl({
  fontSize,
  onSave,
  onError,
}: {
  fontSize: number;
  onSave: (fontSize: number) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const t = useT();
  const [value, setValue] = useState(fontSize);
  const current = useRef(value),
    dirty = useRef(false),
    dragging = useRef(false);
  const frame = useRef<number | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const callbacks = useRef({ onSave, onError });
  callbacks.current = { onSave, onError };

  function commit() {
    clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    void callbacks.current.onSave(current.current).catch(callbacks.current.onError);
  }
  function preview(next: number) {
    current.current = Math.round(Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, next)) * 100) / 100;
    dirty.current = true;
    setValue(current.current);
    // Keep drag feedback local; do not render the entire conversation or write to disk on each move.
    if (frame.current === undefined) {
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        applyFontSize(current.current);
      });
    }
    clearTimeout(timer.current);
    // Assistive technologies can change a range without a pointer or keyboard gesture.
    timer.current = setTimeout(() => {
      if (!dragging.current) commit();
    }, 250);
  }
  function finish() {
    dragging.current = false;
    commit();
  }
  useEffect(() => {
    if (!dirty.current) {
      current.current = fontSize;
      setValue(fontSize);
    }
  }, [fontSize]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      // Closing Settings mid-gesture must still save the visible value.
      if (dirty.current) {
        applyFontSize(current.current);
        commit();
      }
    },
    [],
  );

  return (
    <section className="font-size-setting" aria-labelledby="font-size-label">
      <div className="font-size-heading">
        <label id="font-size-label" htmlFor="font-size">
          <Type size={17} />
          {t('字体大小', 'Font size')}
        </label>
        <output htmlFor="font-size">{value.toFixed(2).replace(/\.?0+$/, '')} px</output>
        <button
          className="text-button"
          disabled={value === DEFAULT_FONT_SIZE}
          onClick={() => {
            preview(DEFAULT_FONT_SIZE);
            commit();
          }}
        >
          {t('恢复默认', 'Reset')}
        </button>
      </div>
      <div className="font-size-slider">
        <span aria-hidden="true">A</span>
        <input
          id="font-size"
          type="range"
          min={MIN_FONT_SIZE}
          max={MAX_FONT_SIZE}
          step={0.01}
          value={value}
          aria-valuetext={`${value} px`}
          aria-describedby="font-size-help"
          onChange={(event) => preview(Number(event.target.value))}
          onPointerDown={(event) => {
            dragging.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={finish}
          onPointerCancel={finish}
          onLostPointerCapture={finish}
          onBlur={finish}
          onKeyDown={(event) => {
            const delta = event.shiftKey ? 1 : 0.1;
            const next = {
              ArrowLeft: current.current - delta,
              ArrowDown: current.current - delta,
              ArrowRight: current.current + delta,
              ArrowUp: current.current + delta,
              PageDown: current.current - 1,
              PageUp: current.current + 1,
              Home: MIN_FONT_SIZE,
              End: MAX_FONT_SIZE,
            }[event.key];
            if (next === undefined) return;
            event.preventDefault();
            preview(next);
          }}
          onKeyUp={commit}
        />
        <span aria-hidden="true">A</span>
      </div>
      <p id="font-size-help">
        {t(
          '拖动以平滑调整文字大小，松手自动保存。',
          'Drag to smoothly resize text. Release to save automatically.',
        )}
      </p>
      <div className="font-size-preview">
        {t('让文字更清晰，让阅读更轻松。', 'A comfortable size for your next idea.')}
        <br />
        <code>Codex Desk · Aa 0123</code>
      </div>
    </section>
  );
}
