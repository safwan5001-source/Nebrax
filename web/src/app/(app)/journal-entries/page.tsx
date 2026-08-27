'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Eye, FilePlus, Link as LinkIcon } from 'lucide-react';
import { AdvancedFilterDialog } from '@/components/data-explorer/advanced-filter-dialog';
import { DataTable } from '@/components/data-table';
import { ListToolbar, PageHeader, Pagination, type PageAction, type SortOption } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { BranchViewToggle } from '@/components/ui/branch-view-toggle';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { branchViewQuery, type BranchView } from '@/lib/branch-view';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import { parseExplorerState, removeFilter, replaceFilter, serializeExplorerState } from '@/lib/data-explorer/url-state';
import { formatRiyal } from '@/lib/money';
import { useToast } from '@/components/ui/toast';

interface JournalEntry {
  id: string;
  number: string;
  entry_date: string;
  description?: string | null;
  status: string;
  entry_kind: 'manual' | 'automatic' | 'reversal';
  source_type?: string | null;
  source_id?: string | null;
  total: string;
}
interface PaginationMeta { current_page: number; last_page: number; per_page: number; total: number }

const sourcePath = (sourceType?: string | null, sourceId?: string | null): string | null => {
  if (!sourceType || !sourceId) return null;
  const name = sourceType.split('\\').pop();
  const paths: Record<string, string> = {
    Invoice: '/invoices', Purchase: '/purchases', Payment: '/payments', Expense: '/expenses',
    CreditNote: '/credit-notes', ReturnDocument: '/returns', Asset: '/assets', ManualJournal: '/manual-journals',
  };
  return paths[name ?? ''] ? `${paths[name ?? '']}/${sourceId}` : null;
};

const sourceOptions = ['Invoice', 'Purchase', 'Payment', 'Expense', 'CreditNote', 'ReturnDocument', 'Asset', 'ManualJournal']
  .map((value) => ({ value, label: value }));

function isEmptyFilter(filter: ActiveFilter): boolean {
  return Array.isArray(filter.value)
    ? filter.value.every((value) => String(value).trim() === '')
    : String(filter.value).trim() === '';
}

function journalQuery(state: DataExplorerState, view: BranchView): string {
  const params = new URLSearchParams(branchViewQuery(view).replace(/^\?/, ''));
  if (state.search.trim()) params.set('search', state.search.trim());
  if (state.sort) params.set('sort', state.sort);
  params.set('page', String(state.page ?? 1));
  params.set('per_page', String(state.perPage ?? 25));
  for (const filter of state.filters) {
    if (Array.isArray(filter.value) || String(filter.value).trim() === '') continue;
    if (['entry_kind', 'source_type', 'date_from', 'date_to', 'amount_min', 'amount_max'].includes(filter.key)) {
      params.set(filter.key, String(filter.value));
    }
  }
  return params.toString();
}

export default function JournalEntriesPage() {
  const t = useTranslations('journalEntries');
  const tc = useTranslations('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { error: toastError } = useToast();
  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? '-entry_date' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<BranchView>('current');

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api<{ data: JournalEntry[]; meta?: PaginationMeta }>(`/journal-entries?${journalQuery(explorer, view)}`)
      .then((response) => {
        const rows = Array.isArray(response.data) ? response.data : [];
        setEntries(rows);
        setPagination(response.meta ?? { current_page: 1, last_page: 1, per_page: explorer.perPage ?? 25, total: rows.length });
      })
      .catch((err) => {
        const message = err instanceof ApiError ? err.message : tc('loadFailed');
        setLoadError(message);
        toastError(message);
      })
      .finally(() => setLoading(false));
  }, [explorer, tc, toastError, view]);

  useEffect(() => load(), [load]);
  useEffect(() => {
    const timer = window.setTimeout(() => setExplorer((current) => current.search === searchInput ? current : { ...current, search: searchInput, page: 1 }), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  useEffect(() => {
    const url = serializeExplorerState(explorer);
    router.replace(url.toString() ? `/journal-entries?${url.toString()}` : '/journal-entries', { scroll: false });
  }, [explorer, router]);

  const definitions = useMemo<FilterDefinition[]>(() => [
    { key: 'entry_kind', label: t('type'), kind: 'select', quick: true, options: [
      { value: 'manual', label: t('manual') }, { value: 'automatic', label: t('automatic') }, { value: 'reversal', label: t('reversal') },
    ] },
    { key: 'source_type', label: t('source'), kind: 'select', quick: true, options: sourceOptions },
    { key: 'date_from', label: t('filter_date_from'), kind: 'date' }, { key: 'date_to', label: t('filter_date_to'), kind: 'date' },
    { key: 'amount_min', label: t('filter_amount_min'), kind: 'money' }, { key: 'amount_max', label: t('filter_amount_max'), kind: 'money' },
  ], [t]);
  const labelledFilters = useMemo(() => explorer.filters.map((filter) => ({ ...filter, label: definitions.find((definition) => definition.key === filter.key)?.label ?? filter.label })), [definitions, explorer.filters]);

  function updateFilter(next: ActiveFilter) {
    setExplorer((current) => ({ ...current, page: 1, filters: isEmptyFilter(next) ? removeFilter(current.filters, next.key) : replaceFilter(current.filters, next) }));
  }

  const rowActions = useCallback((entry: JournalEntry) => {
    const source = sourcePath(entry.source_type, entry.source_id);
    return <>
      <Button asChild size="icon" variant="ghost" aria-label={t('view')}><Link href={`/journal-entries/${entry.id}`}><Eye className="h-4 w-4" strokeWidth={1.7} /></Link></Button>
      {source && <Button asChild size="icon" variant="ghost" aria-label={t('viewSource')}><Link href={source}><LinkIcon className="h-4 w-4" strokeWidth={1.7} /></Link></Button>}
    </>;
  }, [t]);

  const columns = useMemo<ColumnDef<JournalEntry, unknown>[]>(() => [
    { accessorKey: 'number', header: t('number'), cell: ({ row }) => <Link href={`/journal-entries/${row.original.id}`} className="num font-medium text-primary hover:underline">{row.original.number}</Link> },
    { accessorKey: 'entry_date', header: t('date'), cell: ({ row }) => <span className="num text-muted">{row.original.entry_date}</span> },
    { accessorKey: 'description', header: t('source'), cell: ({ row }) => <span className="line-clamp-2 font-medium text-text">{row.original.description || t('noDescription')}</span> },
    { accessorKey: 'entry_kind', header: t('type'), cell: ({ row }) => <Badge tone={row.original.entry_kind === 'automatic' ? 'positive' : row.original.entry_kind === 'reversal' ? 'negative' : 'muted'}>{t(row.original.entry_kind)}</Badge> },
    { accessorKey: 'total', header: t('amount'), cell: ({ row }) => <span className="num block text-end font-medium text-text">{formatRiyal(row.original.total)}</span> },
    { id: 'actions', header: t('actions'), cell: ({ row }) => <div className="flex justify-end gap-1">{rowActions(row.original)}</div> },
  ], [rowActions, t]);

  const sortOptions: SortOption[] = [
    { value: '-entry_date', label: t('sort_date_desc') }, { value: 'entry_date', label: t('sort_date_asc') }, { value: 'number', label: t('number') },
    { value: '-total', label: t('sort_amount_desc') }, { value: 'total', label: t('sort_amount_asc') }, { value: 'entry_kind', label: t('type') },
  ];
  const headerActions: PageAction[] = [
    { key: 'drafts', label: t('drafts'), href: '/manual-journals', variant: 'outline', emphasis: 'secondary' },
    { key: 'newManual', label: t('newManual'), icon: FilePlus, href: '/manual-journals/new', variant: 'primary' },
  ];
  const page = pagination?.current_page ?? explorer.page ?? 1;
  const lastPage = pagination?.last_page ?? 1;
  const perPage = pagination?.per_page ?? explorer.perPage ?? 25;
  const total = pagination?.total ?? entries.length;

  return <div className="space-y-4">
    <PageHeader title={t('title')} description={t('subtitle')} context={<BranchViewToggle value={view} onChange={(next) => { setView(next); setExplorer((current) => ({ ...current, page: 1 })); }} />} actions={headerActions} />
    <ListToolbar
      search={searchInput} searchPlaceholder={`${t('search')} · ${t('number')} · ${t('source')}`} searchLabel={t('title')} onSearchChange={setSearchInput}
      definitions={definitions} filters={labelledFilters} onFilterChange={updateFilter}
      onRemoveFilter={(key) => setExplorer((current) => ({ ...current, page: 1, filters: removeFilter(current.filters, key) }))}
      onClearFilters={() => setExplorer((current) => ({ ...current, page: 1, filters: [] }))} onOpenAdvanced={() => setAdvancedOpen(true)}
      sort={{ value: explorer.sort ?? '-entry_date', onChange: (value) => setExplorer((current) => ({ ...current, page: 1, sort: value })), options: sortOptions }}
      resultCount={entries.length} totalCount={total}
    />
    <DataTable columns={columns} data={entries} loading={loading} error={loadError} onRetry={load} retryLabel={tc('retry')} emptyLabel={t('empty')} exportName="journal-entries" showToolbar={false}
      mobileRecord={(entry) => ({
        title: <Link href={`/journal-entries/${entry.id}`} className="num text-primary hover:underline">{entry.number}</Link>, subtitle: entry.description || t('noDescription'),
        amountLabel: t('amount'), amount: formatRiyal(entry.total),
        status: <Badge tone={entry.entry_kind === 'automatic' ? 'positive' : entry.entry_kind === 'reversal' ? 'negative' : 'muted'}>{t(entry.entry_kind)}</Badge>,
        meta: entry.entry_date, actions: rowActions(entry),
      })}
    />
    <Pagination page={page} lastPage={lastPage} perPage={perPage} total={total} disabled={loading}
      onPageChange={(next) => setExplorer((current) => ({ ...current, page: next }))}
      onPerPageChange={(next) => setExplorer((current) => ({ ...current, page: 1, perPage: next }))} />
    <AdvancedFilterDialog open={advancedOpen} onClose={() => setAdvancedOpen(false)} definitions={definitions} filters={labelledFilters} onApply={(filters) => setExplorer((current) => ({ ...current, page: 1, filters }))} />
  </div>;
}
