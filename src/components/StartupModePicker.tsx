import { Terminal, Shield, LockKeyhole, Zap } from 'lucide-react';
import type { AccessMode } from '../shared/types';
import { useT } from '../lib/i18n';

export function StartupModePicker({
  value,
  onChange,
  disabled,
}: {
  value?: AccessMode;
  onChange: (value: AccessMode | undefined) => void;
  disabled: boolean;
}) {
  const t = useT();
  const choices = [
    {
      value: '',
      title: t('跟随 CLI 配置', 'CLI defaults'),
      detail: t('使用 Codex 当前配置', 'Use your Codex configuration'),
      icon: Terminal,
    },
    {
      value: 'read-only',
      title: t('只读', 'Read only'),
      detail: t('读取文件 · 按需审批', 'Read files · Ask when needed'),
      icon: LockKeyhole,
    },
    {
      value: 'workspace-write',
      title: t('标准模式', 'Standard'),
      detail: t('工作区写入 · 按需审批', 'Workspace writes · Ask when needed'),
      icon: Shield,
    },
    {
      value: 'danger-full-access',
      title: 'YOLO',
      detail: t('完全访问 · 无需审批', 'Full access · No approvals'),
      icon: Zap,
    },
  ];
  return (
    <fieldset className="startup-modes" disabled={disabled}>
      <legend>{t('启动模式', 'Startup mode')}</legend>
      <div className="startup-mode-options">
        {choices.map((choice) => (
          <label
            key={choice.value}
            className={value === choice.value || (!value && !choice.value) ? 'selected' : ''}
          >
            <input
              type="radio"
              name="startup-mode"
              value={choice.value}
              checked={(value || '') === choice.value}
              onChange={() => onChange(choice.value ? (choice.value as AccessMode) : undefined)}
            />
            <choice.icon size={17} />
            <strong>{choice.title}</strong>
            <span>{choice.detail}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
