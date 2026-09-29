import type { ReactNode } from 'react';
import { Brain, Cpu, Shield, LockKeyhole, Sparkles, Zap, Terminal } from 'lucide-react';
import type { AccessMode, Model, PermissionMode, ApprovalPolicy } from '../shared/types';
import { useT } from '../lib/i18n';
import { ChoiceMenu, type Section } from './ChoiceMenu';

export function permissionLabel(
  value: PermissionMode | undefined,
  policy: ApprovalPolicy | undefined,
  t: ReturnType<typeof useT>,
) {
  if (value === 'danger-full-access') return policy === 'never' ? 'YOLO' : t('完全访问', 'Full access');
  if (value === 'read-only') return t('只读', 'Read only');
  if (value === 'workspace-write') return t('标准', 'Standard');
  if (value === 'external-sandbox') return t('外部沙箱', 'External');
  return t('跟随 CLI', 'CLI');
}

export function MobileSessionPicker({
  models,
  chosen,
  effort,
  onModel,
  onEffort,
  access,
  approvalPolicy,
  onAccess,
  disabled,
  openSignal,
  section,
  fast,
  speedControl,
}: {
  models: Model[];
  chosen?: Model;
  effort: string;
  onModel: (value: string) => void;
  onEffort: (value: string) => void;
  access?: PermissionMode;
  approvalPolicy?: ApprovalPolicy;
  onAccess: (value: AccessMode | undefined) => void;
  disabled: boolean;
  openSignal: number;
  section: string;
  fast: boolean;
  speedControl: ReactNode;
}) {
  const t = useT();
  const customAccess =
    access === 'external-sandbox' || (access === 'danger-full-access' && approvalPolicy !== 'never');
  const sections: Section[] = [
    {
      id: 'models',
      title: t('模型', 'Model'),
      value: chosen?.model ?? '',
      select: onModel,
      choices: models.map((model) => ({
        value: model.model,
        title: model.displayName,
        description: model.description || model.model,
        icon: <Cpu size={19} />,
        badge: model.isDefault ? t('默认', 'Default') : undefined,
      })),
    },
    {
      id: 'effort',
      title: t('思考', 'Thinking'),
      value: effort,
      select: onEffort,
      choices: (chosen?.supportedReasoningEfforts ?? []).map((item) => ({
        value: item.reasoningEffort,
        title: item.reasoningEffort,
        description: item.description || t('推理强度', 'Reasoning effort'),
        icon: <Brain size={19} />,
      })),
    },
    {
      id: 'permission',
      title: t('权限', 'Access'),
      value: customAccess ? 'cli-current' : (access ?? ''),
      select: (value) => onAccess(value && value !== 'cli-current' ? (value as AccessMode) : undefined),
      choices: [
        ...(customAccess
          ? [
              {
                value: 'cli-current',
                title: `${permissionLabel(access, approvalPolicy, t)} · CLI`,
                description: t(
                  '保留 CLI 当前权限与审批设置',
                  'Keep the current CLI permissions and approval policy',
                ),
                icon: <Terminal size={19} />,
              },
            ]
          : []),
        {
          value: '',
          title: t('跟随 CLI 配置', 'CLI defaults'),
          description: t('使用 Codex 当前配置', 'Use your Codex configuration'),
          icon: <Terminal size={19} />,
        },
        {
          value: 'read-only',
          title: t('只读', 'Read only'),
          description: t('查看文件，修改时请求审批', 'Read files; request approval for changes'),
          icon: <LockKeyhole size={19} />,
        },
        {
          value: 'workspace-write',
          title: t('标准模式', 'Standard'),
          description: t('修改工作区，超出范围时询问', 'Edit the workspace; ask before going beyond it'),
          icon: <Shield size={19} />,
        },
        {
          value: 'danger-full-access',
          title: t('完全访问 · YOLO', 'Full access · YOLO'),
          description: t(
            '关闭沙箱和审批，可访问电脑文件与网络',
            'No sandbox or approvals; access computer files and network',
          ),
          icon: <Zap size={19} />,
          danger: true,
        },
      ],
    },
  ];
  return (
    <ChoiceMenu
      label={t('会话设置', 'Session settings')}
      display={chosen?.displayName || t('Codex 默认模型', 'Codex default')}
      icon={fast ? <Zap size={14} /> : <Sparkles size={14} />}
      sections={sections}
      initialSection={section}
      triggerSection="models"
      header={t('会话设置', 'Session settings')}
      footnote={t('沿用 CLI 设置，选择后才更改', 'Inherit CLI settings until you change them')}
      disabled={disabled}
      openSignal={openSignal}
      extra={
        <div className="mobile-speed-setting">
          <div>
            <strong>Fast</strong>
            <small>{t('响应更快，额度消耗更高', 'Faster responses, higher usage')}</small>
          </div>
          {speedControl}
        </div>
      }
    />
  );
}
