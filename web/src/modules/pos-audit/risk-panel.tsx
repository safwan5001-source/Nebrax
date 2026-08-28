'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Pagination } from '@/components/nebrax';
import { useToast } from '@/components/ui/toast';
import { bandTone, fromMilli, severityTone } from './helpers';
import type { Paginated, PosExceptionRow, RiskSnapshotRow } from './types';

const BANDS = ['priority', 'review', 'watch', 'normal'];

export function RiskPanel() {
  const t = useTranslations('posAudit');
  const locale = useLocale();
  const { error: errorToast } = useToast();

  const [rows, setRows] = useState<RiskSnapshotRow[]>([]);
  const [meta, setMeta] = useState({ total: 0, per_page: 25, current_page: 1, last_page: 1 });
  const [loading, setLoading] = useState(true);
  const [band, setBand] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [detail, setDetail] = useState<{ snapshot: RiskSnapshotRow | null; exceptions: PosExceptionRow[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const search = new URLSearchParams();
      if (band) search.set('band', band);
      search.set('per_page', String(perPage));
      search.set('page', String(page));
      const result = await api<Paginated<RiskSnapshotRow>>(`/pos/audit/risk?${search.toString()}`);
      setRows(result.data);
      setMeta(result.meta);
    } catch (error) {
      errorToast(error instanceof ApiError ? error.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [band, page, perPage, errorToast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDetail(userId: string) {
    try {
      const result = await api<{ data: { snapshot: RiskSnapshotRow | null; exceptions: PosExceptionRow[] } }>(`/pos/audit/risk/${userId}`);
      setDetail(result.data);
    } catch (error) {
      errorToast(error instanceof ApiError ? error.message : t('loadFailed'));
    }
  }

  const ruleLabel = (key: string) => String(t(`rules.${key}` as never, { fallback: key }));

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label>
          <Label htmlFor="risk-band">{t('band')}</Label>
          <Select id="risk-band" value={band} onChange={(e) => { setBand(e.target.value); setPage(1); }} className="w-48">
            <option value="">{t('all')}</option>
            {BANDS.map((b) => (
              <option key={b} value={b}>{t(`bands.${b}` as never, { fallback: b })}</option>
            ))}
          </Select>
        </label>
        <p className="text-xs text-muted">{t('riskHint')}</p>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded border border-border bg-surface" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded border border-border bg-surface p-4 text-sm text-muted">{t('emptyRisk')}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <button
              key={row.subject_user_id}
              onClick={() => void openDetail(row.subject_user_id)}
              className="rounded border border-border bg-surface p-4 text-start transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-text">{row.subject_name}</p>
                <Badge tone={bandTone(row.band)}>{t(`bands.${row.band}` as never, { fallback: row.band })}</Badge>
              </div>
              <p className="num mt-3 text-2xl font-semibold text-text">{row.total_score}<span className="text-sm text-muted"> / 100</span></p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                <span>{t('exceptionsCount', { count: row.exception_count })}</span>
                {row.amount_under_review_minor > 0 ? <span className="num">{formatRiyal(row.amount_under_review)}</span> : null}
              </div>
              {!row.sample_sufficient ? <p className="mt-2 text-xs text-warning">{t('insufficientSample')}</p> : null}
            </button>
          ))}
        </div>
      )}

      <Pagination
        page={meta.current_page}
        lastPage={meta.last_page}
        perPage={perPage}
        total={meta.total}
        disabled={loading}
        onPageChange={(next) => setPage(next)}
        onPerPageChange={(next) => { setPerPage(next); setPage(1); }}
      />

      <Dialog open={detail !== null} onClose={() => setDetail(null)} title={t('riskDetail')}>
        {detail ? (
          <div className="space-y-5">
            {detail.snapshot ? (
              <>
                <section className="flex flex-wrap items-center gap-3">
                  <div>
                    <p className="text-sm font-medium text-text">{detail.snapshot.subject_name}</p>
                    <p className="num text-2xl font-semibold text-text">{detail.snapshot.total_score}<span className="text-sm text-muted"> / 100</span></p>
                  </div>
                  <Badge tone={bandTone(detail.snapshot.band)}>{t(`bands.${detail.snapshot.band}` as never, { fallback: detail.snapshot.band })}</Badge>
                  {detail.snapshot.amount_under_review_minor > 0 ? (
                    <span className="num text-sm text-muted">{t('amountUnderReview')}: {formatRiyal(detail.snapshot.amount_under_review)}</span>
                  ) : null}
                </section>
                <p className="rounded border border-border bg-background p-2 text-xs text-muted">{t('notAccusation')}</p>

                {/* مساهمة كل فئة (سائقو الدرجة) */}
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-text">{t('scoreDrivers')}</h3>
                  {Object.entries(detail.snapshot.components).map(([category, component]) => (
                    <div key={category} className="rounded border border-border p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-text">{t(`categories.${category}` as never, { fallback: category })}</span>
                        <span className="num text-sm text-text">{component.points} {t('points')}</span>
                      </div>
                      <ul className="mt-2 space-y-1">
                        {component.rules.map((rule) => (
                          <li key={rule.exception_id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                            <span>{ruleLabel(rule.rule_key)}</span>
                            <span className="flex items-center gap-2">
                              <Badge tone={severityTone(rule.severity)}>{t(`severities.${rule.severity}` as never, { fallback: rule.severity })}</Badge>
                              <span>{t(`baselineTypes.${rule.baseline_type}` as never, { fallback: rule.baseline_type })}</span>
                              <span className="num">+{rule.contribution}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              </>
            ) : (
              <p className="text-sm text-muted">{t('emptyRisk')}</p>
            )}

            {/* الاستثناءات المسهِمة مع المقاييس المطبّعة */}
            <section>
              <h3 className="mb-2 text-sm font-semibold text-text">{t('contributingExceptions')}</h3>
              <div className="space-y-2">
                {detail.exceptions.map((exception) => (
                  <div key={exception.id} className="rounded border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-text">{ruleLabel(exception.rule_key)}</span>
                      <Badge tone={severityTone(exception.severity)}>{t(`severities.${exception.severity}` as never, { fallback: exception.severity })}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {t('observedRate')}: <span className="num">{fromMilli(exception.observed_rate_milli)}</span>
                      {' · '}
                      {t('baselineRate')}: <span className="num">{fromMilli(exception.baseline_rate_milli)}</span>
                      {' · '}
                      {t(`baselineTypes.${exception.baseline_type}` as never, { fallback: exception.baseline_type })}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}
