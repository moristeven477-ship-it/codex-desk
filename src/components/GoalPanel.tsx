import { useEffect, useState } from 'react';
import { Check, Pause, Play, Target, Clock, Gauge } from 'lucide-react';
import type { GoalStatus, ThreadGoal } from '../shared/types';
import { useT } from '../lib/i18n';
import { Dialog } from './Dialog';

export function useGoalLabel(status?: GoalStatus) {
  const t = useT();
  const labels = {
    active: t('正在追求目标', 'Pursuing goal'),
    paused: t('目标已暂停', 'Goal paused'),
    blocked: t('目标受阻', 'Goal blocked'),
    usageLimited: t('达到用量限制', 'Usage limit reached'),
    budgetLimited: t('达到目标预算', 'Goal budget reached'),
    complete: t('目标已完成', 'Goal complete'),
  };
  return status ? labels[status] : t('设置目标', 'Set a goal');
}
export function GoalBadge({ goal, onClick }: { goal: ThreadGoal; onClick: () => void }) {
  const label = useGoalLabel(goal.status);
  return (
    <button
      className={`goal-badge ${goal.status}`}
      title={goal.objective}
      onClick={onClick}
      aria-label={label}
    >
      {goal.status === 'complete' ? <Check size={14} /> : <Target size={14} />}
      <span>{label}</span>
      {goal.status === 'active' && <i />}
    </button>
  );
}
export function GoalPanel({
  goal,
  initialObjective = '',
  disabled,
  onSave,
  onClear,
  onClose,
}: {
  goal?: ThreadGoal | null;
  initialObjective?: string;
  disabled: boolean;
  onSave: (patch: {
    objective?: string;
    status?: 'active' | 'paused';
    tokenBudget?: number | null;
  }) => Promise<void>;
  onClear: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useT(),
    label = useGoalLabel(goal?.status);
  const [objective, setObjective] = useState(initialObjective || goal?.objective || ''),
    [budget, setBudget] = useState(goal?.tokenBudget?.toString() || ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (goal?.objective && !initialObjective) setObjective(goal.objective);
  }, [goal?.objective, initialObjective]);
  useEffect(() => {
    setBudget(goal?.tokenBudget?.toString() || '');
  }, [goal?.tokenBudget]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  const locked = busy || disabled;
  return (
    <Dialog title={t('目标', 'Goal')} onClose={onClose}>
      <div className="goal-panel">
        <div className={`goal-state ${goal?.status || ''}`}>
          <Target size={20} />
          <strong>{label}</strong>
        </div>
        {goal && (
          <>
            <p className="goal-objective">{goal.objective}</p>
            <div className="goal-metrics">
              <div>
                <Gauge size={16} />
                <strong>{goal.tokensUsed.toLocaleString()}</strong>
                <small>
                  {goal.tokenBudget
                    ? `/ ${goal.tokenBudget.toLocaleString()} tokens`
                    : t('已用 tokens', 'tokens used')}
                </small>
              </div>
              <div>
                <Clock size={16} />
                <strong>
                  {Math.floor(goal.timeUsedSeconds / 60)}m {Math.floor(goal.timeUsedSeconds % 60)}s
                </strong>
                <small>{t('累计运行', 'Active time')}</small>
              </div>
            </div>
            {goal.tokenBudget && (
              <progress
                max={goal.tokenBudget}
                value={Math.min(goal.tokensUsed, goal.tokenBudget)}
                aria-label={t('目标预算用量', 'Goal budget usage')}
              />
            )}
          </>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(() =>
              onSave({
                objective: objective.trim(),
                tokenBudget: budget ? Number(budget) : null,
                ...(!goal || goal.status === 'complete' ? { status: 'active' as const } : {}),
              }),
            );
          }}
        >
          <label>
            {t('目标内容', 'Objective')}
            <textarea
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              rows={4}
              required
              disabled={locked}
              placeholder={t(
                '描述你希望 Codex 持续完成的目标…',
                'Describe what Codex should keep working toward…',
              )}
            />
          </label>
          <label>
            {t('Token 预算（可选）', 'Token budget (optional)')}
            <input
              type="number"
              min="1"
              max={Number.MAX_SAFE_INTEGER}
              step="1"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
              placeholder={t('不设置', 'No budget set')}
              disabled={locked}
            />
          </label>
          <p className="field-hint">
            {t(
              '开始或继续目标后，Codex 会持续工作；CLI 中的目标状态会同步到这里。',
              'Starting or resuming a goal lets Codex keep working. Goal changes in the CLI appear here.',
            )}
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="goal-actions">
            {goal && (
              <button
                type="button"
                className="text-button"
                disabled={locked}
                onClick={() => void run(onClear)}
              >
                {t('清除目标', 'Clear goal')}
              </button>
            )}
            {goal && goal.status !== 'complete' && (
              <button
                type="button"
                className="secondary-button"
                disabled={locked}
                onClick={() =>
                  void run(() => onSave({ status: goal.status === 'active' ? 'paused' : 'active' }))
                }
              >
                {goal.status === 'active' ? <Pause size={14} /> : <Play size={14} />}{' '}
                {goal.status === 'active' ? t('暂停', 'Pause') : t('继续', 'Resume')}
              </button>
            )}
            <button className="primary-button" disabled={locked || !objective.trim()} type="submit">
              {goal && goal.status !== 'complete' ? t('保存目标', 'Save goal') : t('开始目标', 'Start goal')}
            </button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}
