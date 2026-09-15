import { useEffect, useRef, useState } from 'react';
import { Search, Slash, Terminal, ArrowUpRight } from 'lucide-react';
import { slashCommands } from '../shared/commands';
import { useT } from '../lib/i18n';

export function CommandMenu({
  onSelect,
  onClose,
}: {
  onSelect: (name: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState(''),
    [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const entries = slashCommands.filter(
    (item) =>
      !query ||
      `${item.name} ${item.zh} ${item.en} ${item.aliases?.join(' ')}`
        .toLowerCase()
        .includes(query.replace(/^\//, '').toLowerCase()),
  );
  useEffect(() => {
    ref.current?.querySelector('input')?.focus();
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [onClose]);
  useEffect(() => {
    ref.current?.querySelector(`[data-active="true"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <div
      className="command-popover choice-popover"
      ref={ref}
      role="dialog"
      aria-label={t('Codex 命令', 'Codex commands')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (entries.length)
            setActive(
              (value) => (value + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length,
            );
        }
        if (event.key === 'Enter' && entries[active]) {
          event.preventDefault();
          onSelect(entries[active].name);
        }
      }}
    >
      <div className="choice-popover-heading">
        <Slash size={15} />
        {t('Codex 全部命令', 'All Codex commands')}
        <span className="command-count">{slashCommands.length}</span>
      </div>
      <label className="command-search">
        <Search size={15} />
        <input
          placeholder={t('搜索命令…', 'Search commands…')}
          aria-label={t('搜索命令', 'Search commands')}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          aria-controls="command-results"
          aria-activedescendant={entries[active] ? `command-${entries[active].name}` : undefined}
        />
      </label>
      <div
        className="command-options"
        id="command-results"
        role="listbox"
        aria-label={t('命令列表', 'Commands')}
      >
        {entries.map((entry, index) => (
          <button
            id={`command-${entry.name}`}
            key={entry.name}
            type="button"
            role="option"
            aria-selected={index === active}
            data-active={index === active}
            onMouseEnter={() => setActive(index)}
            onClick={() => onSelect(entry.name)}
          >
            <span className="command-symbol">
              {entry.native ? <Slash size={16} /> : <Terminal size={16} />}
            </span>
            <span>
              <strong>/{entry.name}</strong>
              <small>
                {t(entry.zh, entry.en)}
                {entry.aliases?.length ? ` · /${entry.aliases.join(' /')}` : ''}
              </small>
            </span>
            <span className="command-route">
              {entry.advanced ? (
                t('条件可用', 'Conditional')
              ) : entry.native ? (
                <ArrowUpRight size={13} />
              ) : (
                'CLI'
              )}
            </span>
          </button>
        ))}
        {!entries.length && (
          <p className="command-empty">
            {t('可在内置 CLI 中直接输入自定义命令。', 'Enter custom commands directly in the embedded CLI.')}
          </p>
        )}
      </div>
      <div className="choice-footer">
        {t('CLI 标记的命令在内置终端运行', 'Commands marked CLI run in the embedded terminal')}
      </div>
    </div>
  );
}
