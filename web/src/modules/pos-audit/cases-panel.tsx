'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ColumnDef } from '@tanstack/react-table';
import { Eye, ListFilter, Plus } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { formatRiyal } from '@/lib/money';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { Pagination } from '@/components/nebrax';
import { useToast } from '@/components/ui/toast';
import { CaseDetail } from './case-detail';
import { buildQuery, casePriorityTone, caseStatusTone, formatDateTime } from './helpers';
import type { CasePriority, CaseStatus, InvestigationCaseRow, Paginated } from './types';

const STATUSES: CaseStatus[] = ['open', 'investigating', 'awaiting_information', 'explained', 'control_failure', 'confirmed_loss', 'dismissed', 'closed'];
const PRIORITIES: CasePriority[] = ['low', 'normal', 'high', 'critical'];

interface Props {
  canCreate: boolean;
  canManage: boolean;
  canAssign: boolean;
  canResolve: boolean;
  canExport: boolean;
  canCctv: boolean;
  focusCaseId?: string | null;
  onFocusHandled?: () => void;
}

function ageLabel(openedAt: string | null, locale: string, t: ReturnType<typeof useTranslations>): string {
  if (!openedAt) return '—';
  const days = Math.floor((Date.now() - new Date(openedAt).getTime()) / 86_400_000);
  if (days <= 0) return t('cases.ageToday');
  return t('cases.ageDays', { count: days });
}

export function CasesPanel({ canCreate, canManage, canAssign, canResolve, canExport, canCctv, focusCaseId, onFocusHandled }: Props) {
  const t = useTranslations('posAudit');
  const locale = useLocale();
  const user = currentUser();
  const { error: errorToast, success } = useToast();

  const [rows, setRows] = useState<InvestigationCaseRow[]>([]);
  const [meta, setMeta] = useState({ total: 0, per_page: 25, current_page: 1, last_page: 1 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<CasePriority>('normal');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [filters, setFilters] = useState({ status: '', priority: '', mine: false, unassigned: false, number: '' });

  useEffect(() => {
    if (focusCaseId) {
      setSelectedId(focusCaseId);
      onFocusHandled?.();
    }
  }, [focusCaseId, onFocusHandled]);

  const query = useMemo(
    () =>
      buildQuery({
        status: filters.status ? [filters.status] : undefined,
        priority: filters.priority ? [filters.priority] : undefined,
        mine: filters.mine ? '1' : undefined,
        unassigned: filters.unassigned ? '1' : undefined,
        number: filters.number || undefined,
        per_page: perPage,
        page,
      }),
    [filters, perPage, page],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await api<Paginated<InvestigationCaseRow>>(`/pos/investigations?${query}`);
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

  async function createCase() {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const result = await api<{ data: InvestigationCaseRow }>('/pos/investigations', {
        method: 'POST',
        body: { title: newTitle.trim(), priority: newPriority },
      });
      success(t('cases.created'));
      setCreateOpen(false);
      setNewTitle('');
      setNewPriority('normal');
      await load();
      setSelectedId(result.data.id);
    } catch (error) {
      errorToast(error instanceof ApiError ? error.message : t('loadFailed'));
    } finally {
      setCreating(false);
    }
  }

  const columns = useMemo<ColumnDef<InvestigationCaseRow, unknown>[]>(
    () => [
      {
        id: 'number',
        header: t('cases.number'),
        accessorFn: (row) => row.number,
        cell: ({ row }) => <span className="num font-medium text-text" dir="ltr">{row.original.number}</span>,
      },
      {
        id: 'title',
        header: t('cases.title'),
        accessorFn: (row) => row.title,
        cell: ({ row }) => (
          <div>
            <span className="text-text">{row.original.title}</span>
            <span className="mt-0.5 block text-xs text-muted">{row.original.subject?.name ?? '—'}</span>
          </div>
        ),
      },
      {
        id: 'priority',
        header: t('cases.priority'),
        accessorFn: (row) => row.priority,
        cell: ({ row }) => <Badge tone={casePriorityTone(row.original.priority)}>{t(`cases.priorities.${row.original.priority}` as never, { fallback: row.original.priority })}</Badge>,
      },
      {
        id: 'status',
        header: t('cases.status'),
        accessorFn: (row) => row.status,
        cell: ({ row }) => <Badge tone={caseStatusTone(row.original.status)}>{t(`cases.statuses.${row.original.status}` as never, { fallback: row.original.status })}</Badge>,
      },
      {
        id: 'owner',
        header: t('cases.owner'),
        accessorFn: (row) => row.owner?.name ?? '',
        cell: ({ row }) => <span>{row.original.owner?.name ?? t('cases.unassigned')}</span>,
      },
      {
        id: 'aur',
        header: t('amountUnderReview'),
        accessorFn: (row) => row.amount_under_review_minor,
        cell: ({ row }) => (row.original.amount_under_review_minor > 0 ? <span className="num">{formatRiyal(row.original.amount_under_review)}</span> : '—'),
      },
      {
        id: 'confirmed',
        header: t('cases.confirmedLoss'),
        accessorFn: (row) => row.confirmed_loss_minor ?? 0,
        cell: ({ row }) => (row.original.confirmed_loss ? <span className="num">{formatRiyal(row.original.confirmed_loss)}</span> : '—'),
      },
      {
        id: 'activity',
        header: t('cases.lastActivity'),
        accessorFn: (row) => row.last_activity_at ?? '',
        cell: ({ row }) => <span className="num whitespace-nowrap text-xs">{formatDateTime(row.original.last_activity_at, locale)}</span>,
      },
      {
        id: 'age',
        header: t('cases.age'),
        enableSorting: false,
        cell: ({ row }) => <span className="num text-xs text-muted">{ageLabel(row.original.opened_at, locale, t)}</span>,
      },
      {
        id: 'details',
        header: t('details'),
        enableSorting: false,
        cell: ({ row }) => (
          <Button size="sm" variant="outline" onClick={() => setSelectedId(row.original.id)}>
            <Eye className="h-3.5 w-3.5" strokeWidth={1.6} />
            {t('viewDetails')}
          </Button>
        ),
      },
    ],
    [locale, t],
  );

  function exportCsv() {
    window.open(`${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/pos/investigations/export`, '_blank', 'noopener,noreferrer');
  }

  function resetFilters() {
    setFilters({ status: '', priority: '', mine: false, unassigned: false, number: '' });
    setPage(1);
  }

  if (!user) return null;

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm text-muted">{t('cases.hint')}</p>
        <div className="flex gap-2">
          {canExport && (
            <Button variant="outline" onClick={exportCsv}>
              {t('export')}
            </Button>
          )}
          {canCreate && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" strokeWidth={1.8} />
              {t('cases.newCase')}
            </Button>
          )}
        </div>
      </div>

      <details open={filtersOpen} onToggle={(event) => setFiltersOpen((event.currentTarget as HTMLDetailsElement).open)} className="rounded border border-border bg-surface">
        <summary className="flex cursor-pointer list-none items-center gap-2 p-3 text-sm font-medium text-text">
          <ListFilter className="h-4 w-4 text-muted" strokeWidth={1.6} />
          {t('advancedFilters')}
        </summary>
        <div className="grid gap-3 border-t border-border p-3 sm:grid-cols-2 xl:grid-cols-5">
          <label>
            <Label htmlFor="case-status">{t('cases.status')}</Label>
            <Select id="case-status" value={filters.status} onChange={(e) => { setFilters((v) => ({ ...v, status: e.target.value })); setPage(1); }}>
              <option value="">{t('all')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{t(`cases.statuses.${s}` as never, { fallback: s })}</option>
              ))}
            </Select>
          </label>
          <label>
            <Label htmlFor="case-priority">{t('cases.priority')}</Label>
            <Select id="case-priority" value={filters.priority} onChange={(e) => { setFilters((v) => ({ ...v, priority: e.target.value })); setPage(1); }}>
              <option value="">{t('all')}</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{t(`cases.priorities.${p}` as never, { fallback: p })}</option>
              ))}
            </Select>
          </label>
          <label>
            <Label htmlFor="case-number">{t('cases.number')}</Label>
            <Input id="case-number" className="num" value={filters.number} onChange={(e) => { setFilters((v) => ({ ...v, number: e.target.value })); setPage(1); }} />
          </label>
          <label className="flex items-end gap-2 pb-1.5">
            <input type="checkbox" checked={filters.mine} onChange={(e) => { setFilters((v) => ({ ...v, mine: e.target.checked })); setPage(1); }} className="h-4 w-4 rounded border-border" />
            <span className="text-sm text-text">{t('cases.myCases')}</span>
          </label>
          <label className="flex items-end gap-2 pb-1.5">
            <input type="checkbox" checked={filters.unassigned} onChange={(e) => { setFilters((v) => ({ ...v, unassigned: e.target.checked })); setPage(1); }} className="h-4 w-4 rounded border-border" />
            <span className="text-sm text-text">{t('cases.unassigned')}</span>
          </label>
          <div className="flex items-end sm:col-span-2 xl:col-span-5">
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
        emptyLabel={t('cases.empty')}
        emptyDescription={t('cases.emptyHint')}
        showToolbar={false}
        mobileRecord={(row) => ({
          title: row.title,
          subtitle: `${row.number} · ${row.owner?.name ?? t('cases.unassigned')}`,
          status: (
            <span className="flex flex-wrap gap-1">
              <Badge tone={casePriorityTone(row.priority)}>{t(`cases.priorities.${row.priority}` as never, { fallback: row.priority })}</Badge>
              <Badge tone={caseStatusTone(row.status)}>{t(`cases.statuses.${row.status}` as never, { fallback: row.status })}</Badge>
            </span>
          ),
          meta: [formatDateTime(row.last_activity_at, locale), row.amount_under_review_minor > 0 ? formatRiyal(row.amount_under_review) : '—'],
          actions: (
            <button className="text-sm font-medium text-primary" onClick={() => setSelectedId(row.id)}>
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

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title={t('cases.newCase')}>
        <div className="space-y-3">
          <label className="block">
            <Label htmlFor="new-case-title">{t('cases.title')}</Label>
            <Input id="new-case-title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} maxLength={200} />
          </label>
          <label className="block">
            <Label htmlFor="new-case-priority">{t('cases.priority')}</Label>
            <Select id="new-case-priority" value={newPriority} onChange={(e) => setNewPriority(e.target.value as CasePriority)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{t(`cases.priorities.${p}` as never, { fallback: p })}</option>
              ))}
            </Select>
          </label>
          <div className="flex justify-end">
            <Button onClick={() => void createCase()} disabled={!newTitle.trim() || creating}>
              {creating ? t('saving') : t('cases.create')}
            </Button>
          </div>
        </div>
      </Dialog>

      <CaseDetail
        id={selectedId}
        canManage={canManage}
        canAssign={canAssign}
        canResolve={canResolve}
        canCctv={canCctv}
        onClose={() => setSelectedId(null)}
        onChanged={() => void load()}
        onError={(message) => errorToast(message)}
      />
    </section>
  );
}
