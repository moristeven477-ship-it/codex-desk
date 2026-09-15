import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Cpu, Brain, Gauge, LockKeyhole, Shield, Sparkles, Zap } from 'lucide-react';
import type { AccessMode, Model } from '../shared/types';
import { useT } from '../lib/i18n';

interface Choice {
  value: string;
  title: string;
  description: string;
  icon: ReactNode;
  badge?: string;
  danger?: boolean;
}
interface Section {
  id: string;
  title: string;
  value: string;
  choices: Choice[];
  select: (value: string) => void;
}

function ChoiceMenu({
  label,
  display,
  icon,
  sections,
  initialSection,
  header,
  footnote,
  disabled,
  compact = false,
  openSignal = 0,
}: {
  label: string;
  display: string;
  icon: ReactNode;
  sections: Section[];
  initialSection?: string;
  header: string;
  footnote: string;
  disabled?: boolean;
  compact?: boolean;
  openSignal?: number;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null),
    list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false),
    [sectionId, setSectionId] = useState(initialSection || sections[0].id),
    [active, setActive] = useState(0);
  const [position, setPosition] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    maxHeight: number;
  }>({ left: 0, bottom: 0, maxHeight: 440 });
  const section = sections.find((item) => item.id === sectionId) || sections[0];
  useEffect(() => {
    if (openSignal && !disabled) setOpen(true);
  }, [openSignal]);
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const above = rect.top > window.innerHeight / 2;
      setPosition({
        left: Math.max(12, Math.min(rect.left - 8, window.innerWidth - 372)),
        ...(above ? { bottom: window.innerHeight - rect.top + 10 } : { top: rect.bottom + 10 }),
        maxHeight: Math.min(450, (above ? rect.top : window.innerHeight - rect.bottom) - 24),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    setActive(
      Math.max(
        0,
        section.choices.findIndex((choice) => choice.value === section.value),
      ),
    );
    list.current?.focus({ preventScroll: true });
  }, [open, section.id]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node))
        setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, id]);
  function close() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }
  function select(value: string) {
    section.select(value);
    close();
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`picker-trigger ${compact ? 'compact' : ''} ${open ? 'open' : ''}`}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {icon}
        <span>{display}</span>
        <ChevronDown size={12} />
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            className="choice-popover"
            style={position}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
            }}
          >
            <div className="choice-popover-heading">
              <Sparkles size={14} />
              <span>{header}</span>
              <span className="choice-online-dot" />
            </div>
            {sections.length > 1 && (
              <div className="choice-tabs" role="tablist" aria-label={label}>
                {sections.map((item) => (
                  <button
                    role="tab"
                    type="button"
                    key={item.id}
                    aria-selected={section.id === item.id}
                    onClick={() => setSectionId(item.id)}
                  >
                    {item.title}
                  </button>
                ))}
              </div>
            )}
            <div
              id={id}
              ref={list}
              className="choice-options"
              role="listbox"
              tabIndex={-1}
              aria-label={section.title}
              aria-activedescendant={section.choices[active] ? `${id}-option-${active}` : undefined}
              onKeyDown={(event) => {
                if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault();
                  if (section.choices.length)
                    setActive((index) =>
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? section.choices.length - 1
                          : (index + (event.key === 'ArrowDown' ? 1 : -1) + section.choices.length) %
                            section.choices.length,
                    );
                } else if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  if (section.choices[active]) select(section.choices[active].value);
                } else if (event.key === 'Tab') close();
              }}
            >
              {section.choices.map((choice, index) => (
                <div
                  id={`${id}-option-${index}`}
                  key={choice.value}
                  role="option"
                  aria-selected={choice.value === section.value}
                  className={`choice-option ${index === active ? 'highlighted' : ''} ${choice.value === section.value ? 'selected' : ''} ${choice.danger ? 'danger' : ''}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => select(choice.value)}
                >
                  <span className="choice-icon">{choice.icon}</span>
                  <span className="choice-text">
                    <span className="choice-title">{choice.title}</span>
                    <span className="choice-description">{choice.description}</span>
                  </span>
                  <span className="choice-mark">
                    {choice.value === section.value ? <Check size={15} /> : choice.badge}
                  </span>
                </div>
              ))}
            </div>
            <div className="choice-footer">
              <Cpu size={13} />
              {footnote}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export function ModelPicker({
  models,
  chosen,
  effort,
  onModel,
  onEffort,
  disabled,
  effortOnly = false,
  openSignal,
}: {
  models: Model[];
  chosen?: Model;
  effort: string;
  onModel: (value: string) => void;
  onEffort: (value: string) => void;
  disabled: boolean;
  effortOnly?: boolean;
  openSignal?: number;
}) {
  const t = useT();
  const effortIcons: Record<string, ReactNode> = {
    none: <Zap size={18} />,
    minimal: <Zap size={18} />,
    low: <Zap size={18} />,
    medium: <Gauge size={18} />,
    high: <Brain size={18} />,
    xhigh: <Brain size={18} />,
    max: <Sparkles size={18} />,
    ultra: <Sparkles size={18} />,
  };
  const efforts: Section = {
    id: 'effort',
    title: t('推理强度', 'Reasoning effort'),
    value: effort,
    select: onEffort,
    choices: (chosen?.supportedReasoningEfforts || []).map((item) => ({
      value: item.reasoningEffort,
      title: item.reasoningEffort,
      description: item.description || t('设置 Codex 的推理强度', 'Set the reasoning effort for Codex'),
      icon: effortIcons[item.reasoningEffort] || <Brain size={18} />,
    })),
  };
  const sections: Section[] = [
    {
      id: 'models',
      title: t('模型', 'Models'),
      value: chosen?.model || '',
      select: onModel,
      choices: models.map((model) => ({
        value: model.model,
        title: model.displayName,
        description: model.description || model.model,
        icon: model.isDefault ? <Sparkles size={18} /> : <Cpu size={18} />,
        badge: model.isDefault ? t('默认', 'Default') : undefined,
      })),
    },
    efforts,
  ];
  return (
    <ChoiceMenu
      openSignal={openSignal}
      label={effortOnly ? t('推理强度', 'Reasoning effort') : t('模型', 'Model')}
      display={effortOnly ? effort : chosen?.displayName || t('Codex 默认模型', 'Codex default')}
      icon={effortOnly ? null : <Sparkles size={13} />}
      sections={effortOnly ? [efforts] : sections}
      initialSection={effortOnly ? 'effort' : 'models'}
      header={t('使用本机 Codex 模型', 'Models from your local Codex')}
      footnote={t('应用于下一条消息', 'Applies to your next message')}
      disabled={disabled}
      compact={effortOnly}
    />
  );
}

export function PermissionPicker({
  value,
  onChange,
  disabled,
  openSignal,
}: {
  value: AccessMode;
  onChange: (mode: AccessMode) => void;
  disabled: boolean;
  openSignal?: number;
}) {
  const t = useT();
  const choices: Choice[] = [
    {
      value: 'read-only',
      title: t('只读', 'Read only'),
      description: t('查看项目，文件修改需要审批。', 'Inspect the project; file changes require approval.'),
      icon: <LockKeyhole size={18} />,
    },
    {
      value: 'workspace-write',
      title: t('允许修改项目', 'Edit project'),
      description: t(
        '在工作区内编辑，超出范围时询问你。',
        'Edit inside the workspace and ask before going beyond it.',
      ),
      icon: <Shield size={18} />,
      badge: t('默认', 'Default'),
    },
    {
      value: 'danger-full-access',
      title: t('完全访问', 'Full access'),
      description: t(
        '允许 Codex 访问工作区以外的文件与网络。',
        'Allow Codex to access files and the network beyond the workspace.',
      ),
      icon: <Zap size={18} />,
      danger: true,
    },
  ];
  return (
    <ChoiceMenu
      openSignal={openSignal}
      label={t('权限模式', 'Permission mode')}
      display={choices.find((choice) => choice.value === value)?.title || ''}
      icon={<Shield size={12} />}
      sections={[
        {
          id: 'permission',
          title: t('权限模式', 'Permission mode'),
          value,
          choices,
          select: (selected) => onChange(selected as AccessMode),
        },
      ]}
      header={t('Codex 运行权限', 'Codex permissions')}
      footnote={t('权限由本机 Codex 执行', 'Enforced by your local Codex')}
      disabled={disabled}
      compact
    />
  );
}
