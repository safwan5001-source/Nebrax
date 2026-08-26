'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Copy, Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import { AdvancedFilterDialog } from '@/components/data-explorer/advanced-filter-dialog';
import { DataTable } from '@/components/data-table';
import { ListToolbar, PageHeader, Pagination, type PageAction, type SortOption } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { BranchViewToggle } from '@/components/ui/branch-view-toggle';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { branchViewQuery, type BranchView } from '@/lib/branch-view';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import { parseExplorerState, removeFilter, replaceFilter, serializeExplorerState } from '@/lib/data-explorer/url-state';
import { type EmployeeCustody } from '@/lib/employee-custody';
import { formatRiyal } from '@/lib/money';

const tone: Record<EmployeeCustody['status'], 'positive' | 'warning'> = {
  draft: 'warning',
  posted: 'positive',
};

function filterValue(filter?: ActiveFilter): string {
  if (!filter || Array.isArray(filter.value)) return '';
  return String(filter.value).trim();
}

function isEmptyFilter(filter: ActiveFilter): boolean {
  return Array.isArray(filter.value)
    ? filter.value.every((value) => String(value).trim() === '')
    : String(filter.value).trim() === '';
}

export default function EmployeeCustodiesPage() {
  const t = useTranslations('employeeCustodies');
  const tc = useTranslations('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { success, error: toastError } = useToast();
  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? '-custody_date' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [data, setData] = useState<EmployeeCustody[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<BranchView>('current');
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: EmployeeCustody[] }>(`/employee-custodies${branchViewQuery(view, true)}`)
      .then((response) => setData(response.data))
      .catch((err) => toastError(err instanceof ApiError ? err.message : t('loadListFailed')))
      .finally(() => setLoading(false));
  }, [t, toastError, view]);

  useEffect(() => load(), [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setExplorer((current) => current.search === searchInput
        ? current
        : { ...current, search: searchInput, page: 1 });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const url = serializeExplorerState(explorer);
    router.replace(url.toString() ? `/employee-custodies?${url.toString()}` : '/employee-custodies', { scroll: false });
  }, [explorer, router]);

  const duplicate = useCallback(async (id: string) => {
    setActing(id);
    try {
      const response = await api<{ data: EmployeeCustody }>(`/employee-custodies/${id}/duplicate`, { method: 'POST' });
      success(t('duplicateSuccess'));
      router.push(`/employee-custodies/new?edit=${response.data.id}`);
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setActing(null);
    }
  }, [router, success, t, tc, toastError]);

  const remove = useCallback(async (id: string) => {
    if (!window.confirm(t('confirmDelete'))) return;
    setActing(id);
    try {
      await api(`/employee-custodies/${id}`, { method: 'DELETE' });
      success(t('deletedSuccess'));
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setActing(null);
    }
  }, [load, success, t, tc, toastError]);

  const post = useCallback(async (id: string) => {
    if (!window.confirm(t('confirmPost'))) return;
    setActing(id);
    try {
      await api(`/employee-custodies/${id}/post`, { method: 'POST' });
      success(t('postSuccess'));
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setActing(null);
    }
  }, [load, success, t, tc, toastError]);

  const employeeOptions = useMemo(() => Array.from(new Map(data
    .filter((item) => item.employee_id)
    .map((item) => [item.employee_id, item.employee_name || item.employee_no || item.employee_id])).entries())
    .sort(([, left], [, right]) => left.localeCompare(right, 'ar'))
    .map(([value, label]) => ({ value, label })), [data]);

  const statusOptions = useMemo(() => Array.from(new Set(data.map((item) => item.status)))
    .sort()
    .map((status) => ({ value: status, label: t(status) })), [data, t]);

  const definitions = useMemo<FilterDefinition[]>(() => [
    { key: 'employee_id', label: t('employee'), kind: 'entity', quick: true, searchPlaceholder: t('search'), emptyText: t('empty'), options: employeeOptions },
    { key: 'status', label: t('status'), kind: 'select', quick: true, options: statusOptions },
    { key: 'settled', label: t('settled'), kind: 'select', quick: true, options: [{ value: 'yes', label: t('settled') }, { value: 'no', label: t('remaining') }] },
    { key: 'date_from', label: `${t('date')} ≥`, kind: 'date' },
    { key: 'date_to', label: `${t('date')} ≤`, kind: 'date' },
    { key: 'amount_min', label: `${t('amount')} ≥`, kind: 'money' },
    { key: 'amount_max', label: `${t('amount')} ≤`, kind: 'money' },
  ], [employeeOptions, statusOptions, t]);

  const labelledFilters = useMemo(() => explorer.filters.map((filter) => ({
    ...filter,
    label: definitions.find((definition) => definition.key === filter.key)?.label ?? filter.label,
  })), [definitions, explorer.filters]);

  const filtered = useMemo(() => {
    const filters = new Map(explorer.filters.map((filter) => [filter.key, filter]));
    const query = explorer.search.trim().toLocaleLowerCase();
    const employeeId = filterValue(filters.get('employee_id'));
    const status = filterValue(filters.get('status'));
    const settled = filterValue(filters.get('settled'));
    const dateFrom = filterValue(filters.get('date_from'));
    const dateTo = filterValue(filters.get('date_to'));
    const amountMinText = filterValue(filters.get('amount_min'));
    const amountMaxText = filterValue(filters.get('amount_max'));
    const amountMin = Number(amountMinText);
    const amountMax = Number(amountMaxText);

    return data.filter((custody) => {
      if (query) {
        const haystack = [
          custody.number,
          custody.employee_name,
          custody.employee_no,
          custody.status,
          custody.method,
          custody.notes,
          custody.custody_account_name,
          custody.cash_account_name,
        ].filter(Boolean).join(' ').toLocaleLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (employeeId && custody.employee_id !== employeeId) return false;
      if (status && custody.status !== status) return false;
      if (settled === 'yes' && !custody.is_settled) return false;
      if (settled === 'no' && custody.is_settled) return false;
      if (dateFrom && custody.custody_date < dateFrom) return false;
      if (dateTo && custody.custody_date > dateTo) return false;
      const amount = Number(custody.amount);
      if (amountMinText && Number.isFinite(amountMin) && amount < amountMin) return false;
      if (amountMaxText && Number.isFinite(amountMax) && amount > amountMax) return false;
      return true;
    });
  }, [data, explorer.filters, explorer.search]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    const sort = explorer.sort ?? '-custody_date';
    const desc = sort.startsWith('-');
    const key = sort.replace(/^-/, '');
    next.sort((left, right) => {
      let comparison = 0;
      if (key === 'number') comparison = left.number.localeCompare(right.number, 'ar', { numeric: true });
      else if (key === 'employee') comparison = (left.employee_name ?? left.employee_no ?? '').localeCompare(right.employee_name ?? right.employee_no ?? '', 'ar');
      else if (key === 'amount') comparison = Number(left.amount) - Number(right.amount);
      else if (key === 'remaining') comparison = Number(left.remaining_amount ?? left.amount) - Number(right.remaining_amount ?? right.amount);
      else if (key === 'status') comparison = left.status.localeCompare(right.status);
      else comparison = left.custody_date.localeCompare(right.custody_date);
      return desc ? -comparison : comparison;
    });
    return next;
  }, [explorer.sort, filtered]);

  const perPage = explorer.perPage ?? 25;
  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const page = Math.min(explorer.page ?? 1, totalPages);
  const pageData = sorted.slice((page - 1) * perPage, page * perPage);

  function updateFilter(next: ActiveFilter) {
    setExplorer((current) => ({
      ...current,
      page: 1,
      filters: isEmptyFilter(next) ? removeFilter(current.filters, next.key) : replaceFilter(current.filters, next),
    }));
  }

  const renderActions = useCallback((custody: EmployeeCustody) => {
    const draft = custody.status === 'draft';
    const busy = acting === custody.id;
    return (
      <div className="flex justify-end gap-1">
        <Button asChild size="icon" variant="ghost" aria-label={t('view')}><Link href={`/employee-custodies/${custody.id}`}><Eye className="h-4 w-4" strokeWidth={1.7} /></Link></Button>
        {draft ? (
          <Button asChild size="icon" variant="ghost" aria-label={t('edit')}><Link href={`/employee-custodies/new?edit=${custody.id}`}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Link></Button>
        ) : (
          <Button size="icon" variant="ghost" disabled title={t('draftActionOnly')} aria-label={t('edit')}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Button>
        )}
        <Button size="icon" variant="ghost" disabled={busy} onClick={() => duplicate(custody.id)} aria-label={t('duplicate')}><Copy className="h-4 w-4" strokeWidth={1.7} /></Button>
        <span title={draft ? t('settlementDraftOnly') : custody.is_settled ? t('settlementNoRemaining') : undefined}>
          {draft || custody.is_settled || busy ? (
            <Button size="sm" variant="outline" disabled aria-label={t('addSettlement')}><Plus className="h-4 w-4" strokeWidth={1.7} />{t('addSettlement')}</Button>
          ) : (
            <Button asChild size="sm" variant="outline" aria-label={t('addSettlement')}>
              <Link href={`/employee-custodies/${custody.id}?settlement=1`}><Plus className="h-4 w-4" strokeWidth={1.7} />{t('addSettlement')}</Link>
            </Button>
          )}
        </span>
        <Button size="icon" variant="ghost" disabled={!draft || busy} title={!draft ? t('draftActionOnly') : undefined} onClick={() => remove(custody.id)} aria-label={t('delete')}><Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} /></Button>
        {draft && <Button size="sm" variant="outline" disabled={busy} onClick={() => post(custody.id)}>{t('post')}</Button>}
      </div>
    );
  }, [acting, duplicate, post, remove, t]);

  const columns = useMemo<ColumnDef<EmployeeCustody, unknown>[]>(() => [
    {
      accessorKey: 'number',
      header: t('number'),
      cell: ({ row }) => <Link href={`/employee-custodies/${row.original.id}`} className="num font-medium text-primary hover:underline">{row.original.number}</Link>,
    },
    {
      accessorKey: 'employee_name',
      header: t('employee'),
      cell: ({ row }) => (
        <div className="min-w-32">
          <p className="text-sm text-text">{row.original.employee_name || '—'}</p>
          {row.original.employee_no && <p className="num text-xs text-muted">{row.original.employee_no}</p>}
        </div>
      ),
    },
    { accessorKey: 'custody_date', header: t('date'), cell: ({ row }) => <span className="num text-muted">{row.original.custody_date}</span> },
    { accessorKey: 'due_date', header: t('dueDate'), cell: ({ row }) => <span className="num text-muted">{row.original.due_date || '—'}</span> },
    { accessorKey: 'amount', header: t('amount'), cell: ({ row }) => <span className="num font-medium">{formatRiyal(row.original.amount)}</span> },
    { accessorKey: 'remaining_amount', header: t('remaining'), cell: ({ row }) => <span className="num font-medium text-text">{row.original.status === 'posted' ? formatRiyal(row.original.remaining_amount ?? row.original.amount) : '—'}</span> },
    { accessorKey: 'status', header: t('status'), cell: ({ row }) => <div className="flex flex-wrap gap-1"><Badge tone={tone[row.original.status]}>{t(row.original.status)}</Badge>{row.original.is_settled && <Badge tone="positive">{t('settled')}</Badge>}</div> },
    { id: 'actions', header: t('actions'), cell: ({ row }) => renderActions(row.original) },
  ], [renderActions, t]);

  const sortOptions: SortOption[] = [
    { value: '-custody_date', label: `${t('date')} ↓` },
    { value: 'custody_date', label: `${t('date')} ↑` },
    { value: 'number', label: t('number') },
    { value: 'employee', label: t('employee') },
    { value: '-amount', label: `${t('amount')} ↓` },
    { value: 'amount', label: `${t('amount')} ↑` },
    { value: '-remaining', label: `${t('remaining')} ↓` },
    { value: 'remaining', label: `${t('remaining')} ↑` },
    { value: 'status', label: t('status') },
  ];

  const headerActions: PageAction[] = [
    { key: 'create', label: t('create'), icon: Plus, href: '/employee-custodies/new', variant: 'primary' },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        context={<BranchViewToggle value={view} onChange={(next) => { setView(next); setExplorer((current) => ({ ...current, page: 1 })); }} />}
        actions={headerActions}
      />

      <ListToolbar
        search={searchInput}
        searchPlaceholder={t('search')}
        searchLabel={t('title')}
        onSearchChange={setSearchInput}
        definitions={definitions}
        filters={labelledFilters}
        onFilterChange={updateFilter}
        onRemoveFilter={(key) => setExplorer((current) => ({ ...current, page: 1, filters: removeFilter(current.filters, key) }))}
        onClearFilters={() => setExplorer((current) => ({ ...current, page: 1, filters: [] }))}
        onOpenAdvanced={() => setAdvancedOpen(true)}
        sort={{ value: explorer.sort ?? '-custody_date', onChange: (value) => setExplorer((current) => ({ ...current, page: 1, sort: value })), options: sortOptions }}
        resultCount={sorted.length}
        totalCount={data.length}
      />

      <DataTable
        columns={columns}
        data={pageData}
        loading={loading}
        emptyLabel={t('empty')}
        exportName="employee-custodies"
        showToolbar={false}
        mobileRecord={(custody) => ({
          title: <Link href={`/employee-custodies/${custody.id}`} className="num font-medium text-primary hover:underline">{custody.number}</Link>,
          subtitle: custody.employee_name || custody.employee_no || '—',
          amountLabel: t('amount'),
          amount: formatRiyal(custody.amount),
          status: <div className="flex flex-wrap gap-1"><Badge tone={tone[custody.status]}>{t(custody.status)}</Badge>{custody.is_settled && <Badge tone="positive">{t('settled')}</Badge>}</div>,
          secondary: custody.status === 'posted' ? { label: t('remaining'), value: formatRiyal(custody.remaining_amount ?? custody.amount) } : undefined,
          meta: custody.custody_date,
          actions: renderActions(custody),
        })}
      />

      <Pagination
        page={page}
        lastPage={totalPages}
        perPage={perPage}
        total={sorted.length}
        disabled={loading}
        onPageChange={(next) => setExplorer((current) => ({ ...current, page: next }))}
        onPerPageChange={(next) => setExplorer((current) => ({ ...current, page: 1, perPage: next }))}
      />

      <AdvancedFilterDialog
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        definitions={definitions}
        filters={labelledFilters}
        onApply={(filters) => setExplorer((current) => ({ ...current, page: 1, filters }))}
      />
    </div>
  );
}
