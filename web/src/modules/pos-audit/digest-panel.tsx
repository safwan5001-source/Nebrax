'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import type { LpDigestRow, Paginated } from './types';

interface Props {
  canManage: boolean;
  onOpenCase: (caseId: string) => void;
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <article className="rounded border border-border bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="num mt-1 text-2xl font-semibold text-text">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </article>
  );
}

export function DigestPanel({ canManage, onOpenCase }: Props) {
  const t = useTranslations('posAudit');
  const locale = useLocale();
  const { error: errorToast, success } = useToast();

  const [digests, setDigests] = useState<LpDigestRow[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await api<Paginated<LpDigestRow>>('/pos/lp-digests?per_page=30');
      setDigests(result.data);
      setSelectedDate((current) => current ?? result.data[0]?.digest_date ?? null);
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    setGenerating(true);
    try {
      await api('/pos/lp-digests/generate', { method: 'POST', body: {} });
      success(t('digest.generated'));
      await load();
    } catch (error) {
      errorToast(error instanceof ApiError ? error.message : t('loadFailed'));
    } finally {
      setGenerating(false);
    }
  }

  const active = useMemo(() => digests.find((d) => d.digest_date === selectedDate) ?? digests[0] ?? null, [digests, selectedDate]);

  const dateLabel = (value: string) => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-US', { dateStyle: 'long' }).format(new Date(value));

  if (loading && digests.length === 0) return <p className="text-sm text-muted">{t('loading')}</p>;
  if (loadError) return <p className="rounded border border-negative/30 bg-negative/10 p-3 text-sm text-negative">{loadError}</p>;

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-text">{t('digest.title')}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t('digest.hint')}</p>
        </div>
        {canManage && (
          <Button variant="outline" onClick={() => void generate()} disabled={generating}>
            <RefreshCw className="h-4 w-4" strokeWidth={1.6} />
            {generating ? t('recalculating') : t('digest.regenerate')}
          </Button>
        )}
      </div>

      {digests.length === 0 ? (
        <p className="rounded border border-border bg-surface p-4 text-sm text-muted">{t('digest.empty')}</p>
      ) : (
        <>
          <label className="block max-w-xs">
            <Label htmlFor="digest-date">{t('digest.dateSelector')}</Label>
            <select
              id="digest-date"
              value={selectedDate ?? ''}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="h-9 w-full rounded border border-border bg-surface px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {digests.map((d) => (
                <option key={d.digest_date} value={d.digest_date}>{dateLabel(d.digest_date)}</option>
              ))}
            </select>
          </label>

          {active && (
            <>
              {active.data_sufficiency_caveats.length > 0 && (
                <div className="flex items-start gap-2 rounded border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
                  <div>
                    {active.data_sufficiency_caveats.map((c) => (
                      <p key={c}>{t(`digest.caveats.${c}` as never, { fallback: c })}</p>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatTile label={t('digest.newExceptions')} value={String(active.new_exceptions_count)} hint={t('digest.priorityCount', { count: active.priority_exceptions_count })} />
                <StatTile label={t('amountUnderReview')} value={active.amount_under_review_minor > 0 ? formatRiyal(active.amount_under_review) : '—'} />
                <StatTile label={t('digest.newCases')} value={String(active.new_cases_count)} />
                <StatTile label={t('digest.unresolvedHighPriority')} value={String(active.unresolved_high_priority_cases_count)} />
                <StatTile label={t('digest.confirmedLoss')} value={active.confirmed_loss_count > 0 ? formatRiyal(active.confirmed_loss) : '—'} hint={t('digest.confirmedLossCount', { count: active.confirmed_loss_count })} />
                <StatTile label={t('digest.controlFailure')} value={String(active.control_failure_count)} />
                <StatTile label={t('digest.materialVariance')} value={String(active.material_variance_sessions_count)} />
                <StatTile label={t('digest.generatedAt')} value={active.generated_at ? new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(active.generated_at)) : '—'} />
              </div>

              {active.branch_breakdown.length > 0 && (
                <section className="rounded border border-border bg-surface p-3">
                  <h3 className="mb-2 text-sm font-semibold text-text">{t('digest.branchBreakdown')}</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-start text-xs text-muted">
                          <th className="p-1.5 text-start">{t('digest.branch')}</th>
                          <th className="p-1.5 text-start">{t('digest.newExceptions')}</th>
                          <th className="p-1.5 text-start">{t('digest.newCases')}</th>
                          <th className="p-1.5 text-start">{t('amountUnderReview')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {active.branch_breakdown.map((b, i) => (
                          <tr key={b.branch_id ?? `unassigned-${i}`} className="border-t border-border">
                            <td className="p-1.5">{b.branch_id ?? t('digest.unassignedBranch')}</td>
                            <td className="num p-1.5">{b.new_exceptions_count}</td>
                            <td className="num p-1.5">{b.new_cases_count}</td>
                            <td className="num p-1.5">{b.amount_under_review_minor > 0 ? formatRiyal(b.amount_under_review_minor / 100) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {active.payload.case_ids.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-text">{t('digest.linkedCases')}</h3>
                  <div className="flex flex-wrap gap-2">
                    {active.payload.case_ids.map((caseId) => (
                      <button
                        key={caseId}
                        onClick={() => onOpenCase(caseId)}
                        className="num rounded border border-border px-2 py-1 text-xs text-primary hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        dir="ltr"
                      >
                        {caseId.slice(0, 8)}…
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <p className="rounded border border-border bg-background p-2 text-xs text-muted">{t('notAccusation')}</p>
            </>
          )}
        </>
      )}
    </section>
  );
}
