'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ColumnDef } from '@tanstack/react-table';
import { Eye, ListFilter } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Pagination } from '@/components/nebrax';
import { useToast } from '@/components/ui/toast';
import { ExceptionDetail } from './exception-detail';
import { buildQuery, formatDateTime, severityTone, reviewStateTone } from './helpers';
import type { Paginated, PosExceptionRow } from './types';

const CATEGORIES = ['cart', 'payment', 'cash', 'returns', 'approval', 'timing'];
const SEVERITIES = ['priority', 'review', 'watch'];
const STATES = ['new', 'reviewing', 'explained', 'dismissed', 'needs_investigation'];

interface Props {
  canReview: boolean;
  subjectFilter?: string | null;
  onOpenSubject?: (userId: string) => void;
}

export function ExceptionsPanel({ canReview, subjectFilter }: Props) {
  const t = useTranslations('posAudit');
  const locale = useLocale();
  const { error: errorToast } = useToast();

  const [rows, setRows] = useState<PosExceptionRow[]>([]);
  const [meta, setMeta] = useState({ total: 0, per_page: 25, current_page: 1, last_page: 1 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<PosExceptionRow | null>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [filters, setFilters] = useState({
    category: '', severity: '', review_state: '', confidence: '', rule_key: '',
    from: '', to: '', amount_min: '', amount_max: '',
  });

  const query = useMemo(
    () =>
      buildQuery({
        category: filters.category ? [filters.category] : undefined,
        severity: filters.severity ? [filters.severity] : undefined,
        review_state: filters.review_state ? [filters.review_state] : undefined,
        confidence: filters.confidence || undefined,
        rule_key: filters.rule_key || undefined,
        subject_user_id: subjectFilter || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        amount_min: filters.amount_min || undefined,
        amount_max: filters.amount_max || undefined,
        per_page: perPage,
        page,
      }),
    [filters, subjectFilter, perPage, page],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await api<Paginated<PosExceptionRow>>(`/pos/audit/exceptions?${query}`);
      setRows(result.data);
      setMeta(result.meta);
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [query, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const ruleLabel = (key: string) => String(t(`rules.${key}` as never, { fallback: key }));
  const columns = useMemo<ColumnDef<PosExceptionRow, unknown>[]>(
    () => [
      {
        id: 'detected',
        header: t('time'),
        accessorFn: (row) => row.detected_at ?? '',
        cell: ({ row }) => <span className="num whitespace-nowrap text-xs">{formatDateTime(row.original.detected_at, locale)}</span>,
      },
      {
        id: 'rule',
        header: t('ruleCategory'),
        accessorFn: (row) => ruleLabel(row.rule_key),
        cell: ({ row }) => (
          <div>
            <span className="font-medium text-text">{ruleLabel(row.original.rule_key)}</span>
            <span className="mt-0.5 block text-xs text-muted">{t(`categories.${row.original.category}` as never, { fallback: row.original.category })}</span>
          </div>
        ),
      },
      {
        id: 'subject',
        header: t('user'),
        accessorFn: (row) => row.subject?.name ?? row.performer?.name ?? '',
        cell: ({ row }) => <span>{row.original.subject?.name ?? row.original.performer?.name ?? '—'}</span>,
      },
      {
        id: 'severity',
        header: t('severity'),
        accessorFn: (row) => row.severity,
        cell: ({ row }) => <Badge tone={severityTone(row.original.severity)}>{t(`severities.${row.original.severity}` as never, { fallback: row.original.severity })}</Badge>,
      },
      {
        id: 'contribution',
        header: t('riskContribution'),
        accessorFn: (row) => row.risk_contribution,
        cell: ({ row }) => <span className="num">{row.original.risk_contribution}</span>,
      },
      {
        id: 'amount',
        header: t('amountUnderReview'),
        accessorFn: (row) => row.amount_under_review_minor,
        cell: ({ row }) => (row.original.amount_under_review_minor > 0 ? <span className="num">{formatRiyal(row.original.amount_under_review)}</span> : '—'),
      },
      {
        id: 'confidence',
        header: t('provenance'),
        accessorFn: (row) => row.evidence_confidence,
        cell: ({ row }) => (
          <Badge tone={row.original.evidence_confidence === 'server_authoritative' ? 'neutral' : 'muted'}>
            {t(`confidence.${row.original.evidence_confidence}` as never, { fallback: row.original.evidence_confidence })}
          </Badge>
        ),
      },
      {
        id: 'state',
        header: t('reviewState'),
        accessorFn: (row) => row.review_state,
        cell: ({ row }) => <Badge tone={reviewStateTone(row.original.review_state)}>{t(`states.${row.original.review_state}` as never, { fallback: row.original.review_state })}</Badge>,
      },
      {
        id: 'details',
        header: t('details'),
        enableSorting: false,
        cell: ({ row }) => (
          <Button size="sm" variant="outline" onClick={() => setSelected(row.original)}>
            <Eye className="h-3.5 w-3.5" strokeWidth={1.6} />
            {t('viewDetails')}
          </Button>
        ),
      },
    ],
    [locale, t],
  );

  function resetFilters() {
    setFilters({ category: '', severity: '', review_state: '', confidence: '', rule_key: '', from: '', to: '', amount_min: '', amount_max: '' });
    setPage(1);
  }

  return (
    <section className="space-y-4">
      <details open={filtersOpen} onToggle={(event) => setFiltersOpen((event.currentTarget as HTMLDetailsElement).open)} className="rounded border border-border bg-surface">
        <summary className="flex cursor-pointer list-none items-center gap-2 p-3 text-sm font-medium text-text">
          <ListFilter className="h-4 w-4 text-muted" strokeWidth={1.6} />
          {t('advancedFilters')}
        </summary>
        <div className="grid gap-3 border-t border-border p-3 sm:grid-cols-2 xl:grid-cols-4">
          <label>
            <Label htmlFor="exc-category">{t('category')}</Label>
            <Select id="exc-category" value={filters.category} onChange={(e) => { setFilters((v) => ({ ...v, category: e.target.value })); setPage(1); }}>
              <option value="">{t('all')}</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{t(`categories.${c}` as never, { fallback: c })}</option>
              ))}
            </Select>
          </label>
          <label>
            <Label htmlFor="exc-severity">{t('severity')}</Label>
            <Select id="exc-severity" value={filters.severity} onChange={(e) => { setFilters((v) => ({ ...v, severity: e.target.value })); setPage(1); }}>
              <option value="">{t('all')}</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{t(`severities.${s}` as never, { fallback: s })}</option>
              ))}
            </Select>
          </label>
          <label>
            <Label htmlFor="exc-state">{t('reviewState')}</Label>
            <Select id="exc-state" value={filters.review_state} onChange={(e) => { setFilters((v) => ({ ...v, review_state: e.target.value })); setPage(1); }}>
              <option value="">{t('all')}</option>
              {STATES.map((s) => (
                <option key={s} value={s}>{t(`states.${s}` as never, { fallback: s })}</option>
              ))}
            </Select>
          </label>
          <label>
            <Label htmlFor="exc-confidence">{t('provenance')}</Label>
            <Select id="exc-confidence" value={filters.confidence} onChange={(e) => { setFilters((v) => ({ ...v, confidence: e.target.value })); setPage(1); }}>
              <option value="">{t('all')}</option>
              <option value="server_authoritative">{t('confidence.server_authoritative')}</option>
              <option value="client_observed">{t('confidence.client_observed')}</option>
            </Select>
          </label>
          <label>
            <Label htmlFor="exc-from">{t('dateFrom')}</Label>
            <Input id="exc-from" type="datetime-local" value={filters.from} onChange={(e) => { setFilters((v) => ({ ...v, from: e.target.value })); setPage(1); }} />
          </label>
          <label>
            <Label htmlFor="exc-to">{t('dateTo')}</Label>
            <Input id="exc-to" type="datetime-local" value={filters.to} onChange={(e) => { setFilters((v) => ({ ...v, to: e.target.value })); setPage(1); }} />
          </label>
          <label>
            <Label htmlFor="exc-amin">{t('amountMin')}</Label>
            <Input id="exc-amin" className="num" inputMode="numeric" value={filters.amount_min} onChange={(e) => { setFilters((v) => ({ ...v, amount_min: e.target.value })); setPage(1); }} />
          </label>
          <label>
            <Label htmlFor="exc-amax">{t('amountMax')}</Label>
            <Input id="exc-amax" className="num" inputMode="numeric" value={filters.amount_max} onChange={(e) => { setFilters((v) => ({ ...v, amount_max: e.target.value })); setPage(1); }} />
          </label>
          <div className="flex items-end">
            <Button variant="outline" onClick={resetFilters}>{t('clearFilters')}</Button>
          </div>
        </div>
      </details>

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        error={loadError}
        onRetry={() => void load()}
        emptyLabel={t('emptyExceptions')}
        emptyDescription={t('emptyExceptionsHint')}
        showToolbar={false}
        mobileRecord={(row) => ({
          title: ruleLabel(row.rule_key),
          subtitle: row.subject?.name ?? row.performer?.name ?? '—',
          status: (
            <span className="flex flex-wrap gap-1">
              <Badge tone={severityTone(row.severity)}>{t(`severities.${row.severity}` as never, { fallback: row.severity })}</Badge>
              <Badge tone={reviewStateTone(row.review_state)}>{t(`states.${row.review_state}` as never, { fallback: row.review_state })}</Badge>
            </span>
          ),
          meta: [formatDateTime(row.detected_at, locale), row.amount_under_review_minor > 0 ? formatRiyal(row.amount_under_review) : '—'],
          actions: (
            <button className="text-sm font-medium text-primary" onClick={() => setSelected(row)}>
              {t('viewDetails')}
            </button>
          ),
        })}
      />

      <Pagination
        page={meta.current_page}
        lastPage={meta.last_page}
        perPage={perPage}
        total={meta.total}
        disabled={loading}
        onPageChange={(next) => setPage(next)}
        onPerPageChange={(next) => { setPerPage(next); setPage(1); }}
      />

      <ExceptionDetail
        id={selected?.id ?? null}
        canReview={canReview}
        onClose={() => setSelected(null)}
        onReviewed={() => { setSelected(null); void load(); }}
        onError={(message) => errorToast(message)}
      />
    </section>
  );
}
