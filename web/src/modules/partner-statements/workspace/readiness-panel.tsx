'use client';

/**
 * الجاهزية والمراجعة: الموانع بأسبابها (مع «اذهب للسطر») وزر «نقل إلى مراجَعة» **فقط حين يعلن الخادم الأهلية** (`readiness.can_mark_reviewed`) مع صلاحية `reconcile` وقدرة `enabled`.
 * إعادة الفتح (`reviewed → draft`) بسبب إلزامي ≥ 3 أحرف. لا إغلاق ولا إبطال ولا استبدال هنا (PS-A4c).
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Info, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { describeError } from '../errors';
import { MAX_REASON_LENGTH, isReasonValid, reasonLength } from './decision-rules';
import { clearReasonDraft, draftKey, loadReasonDraft, saveReasonDraft } from './reason-draft';
import type { StatusResponse } from './types';

const KNOWN_BLOCKERS = ['statement_changed', 'no_run', 'run_stale', 'unresolved_lines', 'decisions_without_entry_identity', 'decisions_on_other_runs'];

export interface ReadinessPanelProps {
  reconciliationId: string;
  status: StatusResponse;
  runId: string | null;
  /** صلاحية `reconcile` **و**قدرة `enabled`. */
  canWrite: boolean;
  pendingDecisions: number;
  onReview: (note: string | null) => Promise<void>;
  onReopen: (reason: string) => Promise<void>;
  onGoToOrdinal: (ordinal: number) => void;
}

export function ReadinessPanel(props: ReadinessPanelProps) {
  const t = useTranslations('partnerStatements');
  const { status } = props;
  const state = status.reconciliation.status;
  const [note, setNote] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [reopening, setReopening] = useState(false);
  const [busy, setBusy] = useState<null | 'review' | 'reopen'>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const inFlight = useRef(false);
  const reopenKey = draftKey(props.reconciliationId, 'reconciliation', 'reopen');

  useEffect(() => setReopenReason(loadReasonDraft(reopenKey)), [reopenKey]);

  const run = async (kind: 'review' | 'reopen', action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(kind);
    setErrorKey(null);
    try {
      await action();
    } catch (error) {
      setErrorKey(describeError(error).key);
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const eligible = state === 'draft' && status.readiness.can_mark_reviewed && props.runId !== null;
  const reviewDisabled = !props.canWrite || !eligible || props.pendingDecisions > 0 || busy !== null;
  const reviewed = status.reviewed_state;

  return (
    <section aria-label={t('workspace.readiness.title')} className="space-y-3 rounded-md border border-border bg-surface p-3 md:p-4" data-testid="readiness-panel">
      <h3 className="text-sm font-semibold text-text">{t('workspace.readiness.title')}</h3>

      {state === 'reviewed' ? (
        <div className="space-y-2" data-testid="reviewed-banner">
          <p className="flex items-start gap-2 text-sm text-text"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-positive" strokeWidth={1.7} aria-hidden="true" />{t('workspace.readiness.reviewed')}</p>
          {reviewed?.ledger_changed_since_review ? <p role="alert" className="text-sm text-warning" data-testid="ledger-changed-since-review">{t('workspace.readiness.ledger_changed_since_review')}</p> : null}
          {reviewed?.statement_changed_since_review ? <p role="alert" className="text-sm text-negative">{t('workspace.readiness.statement_changed_since_review')}</p> : null}
          {props.canWrite ? (
            reopening ? (
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!isReasonValid(reopenReason)) return;
                  void run('reopen', async () => {
                    await props.onReopen(reopenReason.trim());
                    clearReasonDraft(reopenKey);
                    setReopening(false);
                  });
                }}
              >
                <Label htmlFor="ps-reopen-reason">{t('workspace.readiness.reopen_reason')} <span className="text-negative">*</span></Label>
                <Textarea
                  id="ps-reopen-reason"
                  value={reopenReason}
                  rows={3}
                  dir="auto"
                  required
                  maxLength={MAX_REASON_LENGTH + 50}
                  onChange={(event) => {
                    setReopenReason(event.target.value);
                    saveReasonDraft(reopenKey, event.target.value);
                  }}
                />
                <p className="text-xs text-muted">{t('workspace.form.reason_hint')} <span className="num" dir="ltr">{reasonLength(reopenReason)}/{MAX_REASON_LENGTH}</span></p>
                <div className="flex gap-2">
                  <Button type="submit" className="min-h-[44px] md:min-h-9" disabled={!isReasonValid(reopenReason) || busy !== null}>
                    {busy === 'reopen' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                    {t('workspace.readiness.reopen_confirm')}
                  </Button>
                  <Button type="button" variant="ghost" className="min-h-[44px] md:min-h-9" onClick={() => setReopening(false)} disabled={busy !== null}>{t('workspace.form.cancel')}</Button>
                </div>
              </form>
            ) : (
              <Button type="button" variant="outline" className="min-h-[44px] md:min-h-9" onClick={() => setReopening(true)}>{t('workspace.readiness.reopen')}</Button>
            )
          ) : null}
        </div>
      ) : null}

      {state === 'draft' ? (
        <>
          {status.blockers.length === 0 ? (
            <p className="flex items-start gap-2 text-sm text-positive" data-testid="ready"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} aria-hidden="true" />{t('workspace.readiness.ready')}</p>
          ) : (
            <ul className="space-y-2" data-testid="blockers">
              {status.blockers.map((blocker) => (
                <li key={blocker.code} className="rounded border border-border p-2 text-sm" data-blocker={blocker.code}>
                  <p className="flex items-start gap-2 text-text"><Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={1.7} aria-hidden="true" />
                    {t(`workspace.blocker.${KNOWN_BLOCKERS.includes(blocker.code) ? blocker.code : 'other'}`, { count: blocker.count ?? 0 })}
                  </p>
                  {blocker.sample_ordinals && blocker.sample_ordinals.length > 0 ? (
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      {t('workspace.readiness.go_to')}
                      {blocker.sample_ordinals.map((ordinal) => (
                        <button key={ordinal} type="button" className="num min-h-[44px] min-w-[44px] rounded border border-border px-2 text-text hover:bg-background md:min-h-7 md:min-w-0" onClick={() => props.onGoToOrdinal(ordinal)}>
                          #{ordinal}
                        </button>
                      ))}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {props.canWrite && eligible ? (
            <div className="space-y-2">
              <Label htmlFor="ps-review-note">{t('workspace.readiness.note')} <span className="text-muted">({t('workspace.form.optional')})</span></Label>
              <Textarea id="ps-review-note" value={note} rows={2} dir="auto" maxLength={500} onChange={(event) => setNote(event.target.value)} />
            </div>
          ) : null}

          {props.canWrite ? (
            <div className="space-y-1">
              <Button
                type="button"
                className="min-h-[44px] md:min-h-9"
                disabled={reviewDisabled}
                onClick={() => void run('review', () => props.onReview(note.trim() === '' ? null : note.trim()))}
                data-testid="review-button"
              >
                {busy === 'review' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {t('workspace.readiness.review')}
              </Button>
              {props.pendingDecisions > 0 ? <p className="text-xs text-warning">{t('workspace.readiness.pending_decisions', { count: props.pendingDecisions })}</p> : null}
            </div>
          ) : null}
        </>
      ) : null}

      {state === 'closed' || state === 'voided' || state === 'superseded' ? <p className="text-sm text-muted" data-testid="final-readonly">{t(`workspace.readiness.final_${state}`)}</p> : null}

      {errorKey ? <p role="alert" className="text-sm text-negative" data-testid="lifecycle-error">{t(`errors.${errorKey}`)}</p> : null}
    </section>
  );
}
