'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Copy, Eye, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { AdvancedFilterDialog } from '@/components/data-explorer/advanced-filter-dialog';
import { DataTable } from '@/components/data-table';
import { ListToolbar, PageHeader, Pagination, type PageAction, type SortOption } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { useBranches } from '@/lib/branch';
import { branchFilterDefinition } from '@/lib/branch-filter';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import { parseExplorerState, removeFilter, replaceFilter, serializeExplorerState } from '@/lib/data-explorer/url-state';

interface ManualJournal {
  id: string;
  number: string;
  entry_date: string;
  description?: string | null;
  status: string;
  journal_entry_id?: string | null;
}

const statusTone: Record<string, 'positive' | 'muted' | 'negative'> = {
  draft: 'muted', posted: 'positive', reversed: 'negative',
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

export default function ManualJournalsPage() {
  const t = useTranslations('manualJournals');
  const tc = useTranslations('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { success, error: toastError } = useToast();
  const { branches, active } = useBranches();
  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? '-entry_date' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [data, setData] = useState<ManualJournal[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const branchValue = useMemo(() => filterValue(explorer.filters.find((filter) => filter.key === 'branch')), [explorer.filters]);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (branchValue) params.set('branch', branchValue);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    api<{ data: ManualJournal[] }>(`/manual-journals${suffix}`)
      .then((response) => setData(response.data))
      .catch((err) => toastError(err instanceof ApiError ? err.message : t('loadFailed')))
      .finally(() => setLoading(false));
  }, [branchValue, t, toastError]);

  useEffect(() => load(), [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setExplorer((current) => current.search === searchInput ? current : { ...current, search: searchInput, page: 1 });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const url = serializeExplorerState(explorer);
    router.replace(url.toString() ? `/manual-journals?${url.toString()}` : '/manual-journals', { scroll: false });
  }, [explorer, router]);

  const duplicate = useCallback(async (id: string) => {
    setActing(id);
    try {
      const response = await api<{ data: ManualJournal }>(`/manual-journals/${id}/duplicate`, { method: 'POST' });
      success(t('duplicateSuccess'));
      router.push(`/manual-journals/new?edit=${response.data.id}`);
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally { setActing(null); }
  }, [router, success, t, tc, toastError]);

  const remove = useCallback(async (id: string) => {
    if (!window.confirm(t('confirmDelete'))) return;
    setActing(id);
    try {
      await api(`/manual-journals/${id}`, { method: 'DELETE' });
      success(t('deletedSuccess'));
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally { setActing(null); }
  }, [load, success, t, tc, toastError]);

  const statusOptions = useMemo(() => Array.from(new Set(data.map((item) => item.status).filter(Boolean)))
    .sort().map((status) => ({ value: status, label: t(status) })), [data, t]);

  const definitions = useMemo<FilterDefinition[]>(() => [
    branchFilterDefinition(branches, active?.name),
    { key: 'status', label: t('status'), kind: 'select', quick: true, options: statusOptions },
    { key: 'date_from', label: `${t('entryDate')} ≥`, kind: 'date' },
    { key: 'date_to', label: `${t('entryDate')} ≤`, kind: 'date' },
  ], [active?.name, branches, statusOptions, t]);

  const labelledFilters = useMemo(() => explorer.filters.map((filter) => ({
    ...filter,
    label: definitions.find((definition) => definition.key === filter.key)?.label ?? filter.label,
  })), [definitions, explorer.filters]);

  const filtered = useMemo(() => {
    const filters = new Map(explorer.filters.map((filter) => [filter.key, filter]));
    const query = explorer.search.trim().toLocaleLowerCase();
    const status = filterValue(filters.get('status'));
    const dateFrom = filterValue(filters.get('date_from'));
    const dateTo = filterValue(filters.get('date_to'));
    return data.filter((journal) => {
      if (query) {
        const haystack = [journal.number, journal.description, journal.status].filter(Boolean).join(' ').toLocaleLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (status && journal.status !== status) return false;
      if (dateFrom && journal.entry_date < dateFrom) return false;
      if (dateTo && journal.entry_date > dateTo) return false;
      return true;
    });
  }, [data, explorer.filters, explorer.search]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    const sort = explorer.sort ?? '-entry_date';
    const desc = sort.startsWith('-');
    const key = sort.replace(/^-/, '');
    next.sort((left, right) => {
      let comparison = 0;
      if (key === 'number') comparison = left.number.localeCompare(right.number, 'ar', { numeric: true });
      else if (key === 'description') comparison = (left.description ?? '').localeCompare(right.description ?? '', 'ar');
      else if (key === 'status') comparison = left.status.localeCompare(right.status);
      else comparison = left.entry_date.localeCompare(right.entry_date);
      return desc ? -comparison : comparison;
    });
    return next;
  }, [explorer.sort, filtered]);

  const perPage = explorer.perPage ?? 25;
  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const page = Math.min(explorer.page ?? 1, totalPages);
  const pageData = sorted.slice((page - 1) * perPage, page * perPage);

  function updateFilter(next: ActiveFilter) {
    setExplorer((current) => ({ ...current, page: 1, filters: isEmptyFilter(next) ? removeFilter(current.filters, next.key) : replaceFilter(current.filters, next) }));
  }

  const renderActions = useCallback((journal: ManualJournal) => {
    const busy = acting === journal.id;
    const isDraft = journal.status === 'draft';
    return <div className="flex justify-end gap-1">
      <Button asChild size="icon" variant="ghost" aria-label={t('view')}><Link href={`/manual-journals/${journal.id}`}><Eye className="h-4 w-4" strokeWidth={1.7} /></Link></Button>
      {isDraft ? <Button asChild size="icon" variant="ghost" aria-label={t('edit')}><Link href={`/manual-journals/new?edit=${journal.id}`}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Link></Button> : <Button size="icon" variant="ghost" disabled title={t('draftOnly')} aria-label={t('edit')}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Button>}
      <Button size="icon" variant="ghost" disabled={busy} onClick={() => duplicate(journal.id)} aria-label={t('duplicate')}><Copy className="h-4 w-4" strokeWidth={1.7} /></Button>
      <Button size="icon" variant="ghost" disabled={!isDraft || busy} title={!isDraft ? t('draftOnly') : undefined} onClick={() => remove(journal.id)} aria-label={t('delete')}><Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} /></Button>
      {journal.status === 'posted' && <Button asChild size="icon" variant="ghost" aria-label={t('reverse')}><Link href={`/manual-journals/${journal.id}`}><RotateCcw className="h-4 w-4" strokeWidth={1.7} /></Link></Button>}
    </div>;
  }, [acting, duplicate, remove, t]);

  const columns = useMemo<ColumnDef<ManualJournal, unknown>[]>(() => [
    { accessorKey: 'number', header: t('number'), cell: ({ row }) => <Link href={`/manual-journals/${row.original.id}`} className="num font-medium text-primary hover:underline">{row.original.number}</Link> },
    { accessorKey: 'entry_date', header: t('entryDate'), cell: ({ row }) => <span className="num text-muted">{row.original.entry_date}</span> },
    { accessorKey: 'description', header: t('description'), cell: ({ row }) => row.original.description || '—' },
    { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={statusTone[row.original.status] ?? 'muted'}>{t(row.original.status)}</Badge> },
    { id: 'actions', header: t('actions'), cell: ({ row }) => renderActions(row.original) },
  ], [renderActions, t]);

  const sortOptions: SortOption[] = [
    { value: '-entry_date', label: `${t('entryDate')} ↓` }, { value: 'entry_date', label: `${t('entryDate')} ↑` },
    { value: 'number', label: t('number') }, { value: 'description', label: t('description') }, { value: 'status', label: t('status') },
  ];
  const headerActions: PageAction[] = [{ key: 'create', label: t('create'), icon: Plus, href: '/manual-journals/new', variant: 'primary' }];

  return <div className="space-y-4">
    <PageHeader title={t('title')} description={t('subtitle')} actions={headerActions} />
    <ListToolbar search={searchInput} searchPlaceholder={t('search')} searchLabel={t('title')} onSearchChange={setSearchInput}
      definitions={definitions} filters={labelledFilters} onFilterChange={updateFilter}
      onRemoveFilter={(key) => setExplorer((current) => ({ ...current, page: 1, filters: removeFilter(current.filters, key) }))}
      onClearFilters={() => setExplorer((current) => ({ ...current, page: 1, filters: [] }))} onOpenAdvanced={() => setAdvancedOpen(true)}
      sort={{ value: explorer.sort ?? '-entry_date', onChange: (value) => setExplorer((current) => ({ ...current, page: 1, sort: value })), options: sortOptions }} resultCount={sorted.length} totalCount={data.length} />
    <DataTable columns={columns} data={pageData} loading={loading} emptyLabel={t('empty')} exportName="manual-journals" showToolbar={false}
      mobileRecord={(journal) => ({ title: <Link href={`/manual-journals/${journal.id}`} className="num font-medium text-primary hover:underline">{journal.number}</Link>, subtitle: journal.description || '—', status: <Badge tone={statusTone[journal.status] ?? 'muted'}>{t(journal.status)}</Badge>, meta: journal.entry_date, actions: renderActions(journal) })} />
    <Pagination page={page} lastPage={totalPages} perPage={perPage} total={sorted.length} disabled={loading}
      onPageChange={(next) => setExplorer((current) => ({ ...current, page: next }))} onPerPageChange={(next) => setExplorer((current) => ({ ...current, page: 1, perPage: next }))} />
    <AdvancedFilterDialog open={advancedOpen} onClose={() => setAdvancedOpen(false)} definitions={definitions} filters={labelledFilters} onApply={(filters) => setExplorer((current) => ({ ...current, page: 1, filters }))} />
  </div>;
}
