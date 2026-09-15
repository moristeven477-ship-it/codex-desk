import { useState } from 'react';
import { ShieldCheck, MessageCircleQuestion, Check, X, Loader2, ExternalLink } from 'lucide-react';
import type { Approval, JsonObject, Question } from '../shared/types';
import { request } from '../lib/useDesk';
import { useT } from '../lib/i18n';

export function ApprovalCard({ approval, onError }: { approval: Approval; onError: (e: unknown) => void }) {
  const t = useT(),
    [busy, setBusy] = useState(false),
    [answers, setAnswers] = useState<Record<string, string>>({});
  const [json, setJson] = useState('{}');
  const p = approval.params;
  const question = approval.method === 'item/tool/requestUserInput';
  const elicitation = approval.method === 'mcpServer/elicitation/request';
  const permissions = approval.method === 'item/permissions/requestApproval';
  const questions = (p.questions ?? []) as Question[];
  const choices = Array.isArray(p.availableDecisions)
    ? p.availableDecisions
    : ['accept', 'acceptForSession', 'decline', 'cancel'];
  async function respond(decision: string) {
    setBusy(true);
    try {
      const payload: JsonObject = { id: approval.id, decision };
      if (question)
        payload.answers = Object.fromEntries(
          questions.map((q) => [q.id, answers[q.id] ? [answers[q.id]] : []]),
        );
      if (elicitation && decision === 'accept' && p.mode !== 'url') payload.content = JSON.parse(json);
      await request('approval.respond', payload);
    } catch (e) {
      onError(e);
      setBusy(false);
    }
  }
  return (
    <section className="approval-card" aria-label={t('需要你的回应', 'Your response is needed')}>
      <div className="approval-title">
        {question ? <MessageCircleQuestion size={18} /> : <ShieldCheck size={18} />}
        <strong>
          {question ? t('Codex 想确认一下', 'Codex has a question') : t('需要你的授权', 'Approval needed')}
        </strong>
        {busy && <Loader2 size={16} className="spin" />}
      </div>
      {p.reason != null && <p>{String(p.reason)}</p>}
      {p.message != null && <p>{String(p.message)}</p>}
      {p.command != null && <pre className="approval-command">{String(p.command)}</pre>}
      {p.cwd != null && <small className="muted">{String(p.cwd)}</small>}
      {p.grantRoot != null && <pre>{String(p.grantRoot)}</pre>}
      {permissions && <pre>{JSON.stringify(p.permissions, null, 2)}</pre>}
      {question &&
        questions.map((q) => (
          <fieldset key={q.id}>
            <legend>{q.question}</legend>
            {q.options?.map((o) => (
              <label
                key={o.label}
                className={`question-option ${answers[q.id] === o.label ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name={`${approval.id}-${q.id}`}
                  checked={answers[q.id] === o.label}
                  onChange={() => setAnswers((a) => ({ ...a, [q.id]: o.label }))}
                />
                <span>
                  <strong>{o.label}</strong>
                  <small>{o.description}</small>
                </span>
              </label>
            ))}
            <input
              type={q.isSecret ? 'password' : 'text'}
              placeholder={t('输入你的回答…', 'Type your answer…')}
              aria-label={q.question}
              value={answers[q.id] ?? ''}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
            />
          </fieldset>
        ))}
      {elicitation && p.mode === 'url' && (
        <button
          className="secondary-button"
          onClick={() => void window.codexDesk?.openExternal(String(p.url)).catch(onError)}
        >
          <ExternalLink size={14} />
          {t('打开验证页面', 'Open verification page')}
        </button>
      )}
      {elicitation && p.mode !== 'url' && (
        <div className="elicitation-form">
          <details>
            <summary>{t('查看所需信息', 'Requested fields')}</summary>
            <pre>{JSON.stringify(p.requestedSchema ?? p.description, null, 2)}</pre>
          </details>
          <textarea
            aria-label={t('JSON 回应', 'JSON response')}
            value={json}
            onChange={(e) => setJson(e.target.value)}
            rows={4}
          />
        </div>
      )}
      <div className="approval-actions">
        {question ? (
          <button
            className="primary-button"
            disabled={busy || questions.some((q) => !answers[q.id]?.trim())}
            onClick={() => void respond('accept')}
          >
            <Check size={14} />
            {t('提交回答', 'Submit answers')}
          </button>
        ) : (
          <>
            {(choices.includes('accept') || permissions || elicitation) && (
              <button className="primary-button" disabled={busy} onClick={() => void respond('accept')}>
                <Check size={14} />
                {t('允许一次', 'Allow once')}
              </button>
            )}
            {!elicitation && choices.includes('acceptForSession') && (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void respond('acceptForSession')}
              >
                {t('本会话允许', 'Allow for session')}
              </button>
            )}
            {(choices.includes('decline') || elicitation || permissions) && (
              <button className="secondary-button" disabled={busy} onClick={() => void respond('decline')}>
                <X size={14} />
                {t('拒绝', 'Deny')}
              </button>
            )}
            {!permissions && choices.includes('cancel') && (
              <button className="text-button" disabled={busy} onClick={() => void respond('cancel')}>
                {t('取消', 'Cancel')}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
