'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { FolderPlus, ShieldQuestion } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { fromMilli, formatDateTime, reviewStateTone, severityTone } from './helpers';
import type { PosExceptionRow, ReviewState } from './types';

const NEXT_STATES: Record<ReviewState, ReviewState[]> = {
  new: ['reviewing', 'explained', 'dismissed', 'needs_investigation'],
  reviewing: ['explained', 'dismissed', 'needs_investigation', 'new'],
  explained: ['reviewing', 'needs_investigation'],
  dismissed: ['reviewing', 'needs_investigation'],
  needs_investigation: ['reviewing', 'explained', 'dismissed'],
};

const REASON_REQUIRED: ReviewState[] = ['explained', 'dismissed', 'needs_investigation'];

interface Props {
  id: string | null;
  canReview: boolean;
  canPromote?: boolean;
  onClose: () => void;
  onReviewed: () => void;
  onError: (message: string) => void;
  onPromoted?: (caseId: string) => void;
}

export function ExceptionDetail({ id, canReview, canPromote, onClose, onReviewed, onError, onPromoted }: Props) {
  const t = useTranslations('posAudit');
  const locale = useLocale();
  const [exception, setException] = useState<PosExceptionRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toState, setToState] = useState<ReviewState | ''>('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [promoting, setPromoting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await api<{ data: PosExceptionRow }>(`/pos/audit/exceptions/${id}`);
      setException(result.data);
      setToState('');
      setReason('');
      setNote('');
    } catch (error) {
      setException(null);
      const message = error instanceof ApiError ? error.message : t('loadFailed');
      setLoadError(message);
      onError(message);
    } finally {
      setLoading(false);
    }
  }, [id, onError, t]);

  useEffect(() => {
    if (id) void load();
    else {
      setException(null);
      setLoadError(null);
    }
  }, [id, load]);

  async function submitReview() {
    if (!exception || !toState) return;
    setSubmitting(true);
    try {
      await api(`/pos/audit/exceptions/${exception.id}/review`, {
        method: 'POST',
        body: { to_state: toState, reason: reason || undefined, note: note || undefined },
      });
      onReviewed();
    } catch (error) {
      onError(error instanceof ApiError ? error.message : t('loadFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  const ruleLabel = (key: string) => String(t(`rules.${key}` as never, { fallback: key }));
  const explanation = exception?.explanation;
  const nextStates = exception ? NEXT_STATES[exception.review_state] ?? [] : [];

  async function promoteToCase() {
    if (!exception) return;
    setPromoting(true);
    try {
      const result = await api<{ data: { id: string } }>('/pos/investigations/promote-exception', {
        method: 'POST',
        body: { pos_exception_id: exception.id },
      });
      onPromoted?.(result.data.id);
    } catch (error) {
      onError(error instanceof ApiError ? error.message : t('loadFailed'));
    } finally {
      setPromoting(false);
    }
  }

  return (
    <Dialog open={id !== null} onClose={onClose} title={t('exceptionDetails')}>
      {loading && !exception ? (
        <p className="text-sm text-muted">{t('loading')}</p>
      ) : loadError && !exception ? (
        <div className="space-y-3" role="alert">
          <p className="text-sm text-negative">{loadError || t('detailLoadFailed')}</p>
          <Button size="sm" variant="outline" onClick={() => void load()}>{t('retry')}</Button>
        </div>
      ) : exception ? (
        <div className="space-y-5">
          {/* ملخص بشري مقروء */}
          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-text">{ruleLabel(exception.rule_key)}</h2>
              <Badge tone={severityTone(exception.severity)}>{t(`severities.${exception.severity}` as never, { fallback: exception.severity })}</Badge>
              <Badge tone={reviewStateTone(exception.review_state)}>{t(`states.${exception.review_state}` as never, { fallback: exception.review_state })}</Badge>
              <Badge tone={exception.evidence_confidence === 'server_authoritative' ? 'neutral' : 'muted'}>
                {t(`confidence.${exception.evidence_confidence}` as never, { fallback: exception.evidence_confidence })}
              </Badge>
            </div>
            <p className="text-sm text-muted">{t('genericExplain')}</p>
            <p className="rounded border border-border bg-background p-2 text-xs text-muted">{t('notAccusation')}</p>
            {canPromote && (
              <Button size="sm" variant="outline" onClick={() => void promoteToCase()} disabled={promoting}>
                <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.6} />
                {promoting ? t('saving') : t('cases.promoteToCase')}
              </Button>
            )}
          </section>

          {/* المرصود مقابل خط الأساس + مقام التطبيع + مساهمة الدرجة */}
          <section className="grid gap-3 rounded border border-border p-3 sm:grid-cols-2">
            <Metric label={t('observedRate')} value={`${fromMilli(exception.observed_rate_milli)} / ${exception.explanation.per}`} />
            <Metric label={t('baselineRate')} value={`${fromMilli(exception.baseline_rate_milli)} · ${t(`baselineTypes.${exception.baseline_type}` as never, { fallback: exception.baseline_type })}`} />
            <Metric label={t('numeratorDenominator')} value={`${exception.observed_count} / ${exception.denominator}`} />
            <Metric label={t('denominatorKind')} value={t(`denominators.${explanation?.denominator_kind}` as never, { fallback: explanation?.denominator_kind ?? '—' })} />
            <Metric label={t('sampleSize')} value={String(exception.sample_size)} hint={explanation?.sample_sufficient ? undefined : t('insufficientSample')} />
            <Metric label={t('timeWindow')} value={t('windowDays', { days: explanation?.window_days ?? 0 })} />
            <Metric label={t('riskContribution')} value={String(exception.risk_contribution)} />
            <Metric label={t('amountUnderReview')} value={exception.amount_under_review_minor > 0 ? formatRiyal(exception.amount_under_review) : '—'} mono />
          </section>

          {/* المرجع والجلسة والمعتمِد */}
          <section className="grid gap-3 rounded border border-border p-3 sm:grid-cols-2">
            <Metric label={t('performedBy')} value={exception.performer?.name ?? exception.subject?.name ?? '—'} />
            <Metric label={t('approvedBy')} value={exception.approver?.name ?? '—'} />
            <Metric label={t('session')} value={exception.session?.number ?? '—'} mono />
            <Metric label={t('reviewer')} value={exception.reviewer?.name ?? '—'} />
          </section>

          {/* سجلّ المراجعة */}
          {exception.reviews && exception.reviews.length > 0 ? (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-text">{t('reviewHistory')}</h3>
              <ol className="space-y-0 border-s border-border">
                {exception.reviews.map((review) => (
                  <li key={review.id} className="relative ps-4 pb-3">
                    <span className="absolute -start-1.5 top-1.5 h-3 w-3 rounded-full border-2 border-surface bg-primary" aria-hidden="true" />
                    <p className="text-sm text-text">
                      {t(`states.${review.to_state}` as never, { fallback: review.to_state })}
                      {review.reviewer_name ? ` · ${review.reviewer_name}` : ''}
                    </p>
                    <p className="text-xs text-muted">{formatDateTime(review.created_at, locale)}{review.note ? ` · ${review.note}` : ''}</p>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {/* إجراءات المراجعة المسموحة */}
          {canReview && nextStates.length > 0 ? (
            <section className="space-y-3 rounded border border-border p-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
                <ShieldQuestion className="h-4 w-4 text-muted" strokeWidth={1.6} />
                {t('dispositionActions')}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  <Label htmlFor="review-to">{t('newState')}</Label>
                  <Select id="review-to" value={toState} onChange={(e) => setToState(e.target.value as ReviewState)}>
                    <option value="">{t('choose')}</option>
                    {nextStates.map((state) => (
                      <option key={state} value={state}>{t(`states.${state}` as never, { fallback: state })}</option>
                    ))}
                  </Select>
                </label>
                <label>
                  <Label htmlFor="review-reason">{t('reason')}</Label>
                  <Input id="review-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={80} />
                </label>
              </div>
              <label className="block">
                <Label htmlFor="review-note">{t('note')}{toState && REASON_REQUIRED.includes(toState) ? ' *' : ''}</Label>
                <textarea
                  id="review-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={2000}
                  rows={2}
                  className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                />
              </label>
              <div className="flex justify-end">
                <Button onClick={() => void submitReview()} disabled={!toState || submitting}>
                  {submitting ? t('saving') : t('applyDisposition')}
                </Button>
              </div>
            </section>
          ) : null}

          {/* تفاصيل تقنية ثانوية قابلة للطي */}
          <details>
            <summary className="cursor-pointer text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{t('technicalDetails')}</summary>
            <pre className="mt-2 max-h-56 overflow-auto rounded border border-border bg-background p-3 text-xs text-text" dir="ltr">
              {JSON.stringify(
                {
                  id: exception.id,
                  rule_key: exception.rule_key,
                  rule_version: exception.rule_version,
                  rule_snapshot: exception.rule_snapshot,
                  explanation: exception.explanation,
                },
                null,
                2,
              )}
            </pre>
          </details>
        </div>
      ) : null}
    </Dialog>
  );
}

function Metric({ label, value, hint, mono }: { label: string; value: string; hint?: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-sm text-text ${mono ? 'num' : ''}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-warning">{hint}</p> : null}
    </div>
  );
}
