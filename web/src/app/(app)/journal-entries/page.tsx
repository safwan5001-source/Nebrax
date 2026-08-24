'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Eye, FilePlus, Link as LinkIcon } from 'lucide-react';
import { AdvancedFilterDialog } from '@/components/data-explorer/advanced-filter-dialog';
import { DataExplorerToolbar } from '@/components/data-explorer/data-explorer-toolbar';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { BranchViewToggle } from '@/components/ui/branch-view-toggle';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
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

const sourcePath = (sourceType?: string | null, sourceId?: string | null): string | null => {
  if (!sourceType || !sourceId) return null;
  const name = sourceType.split('\\').pop();
  const paths: Record<string, string> = {
    Invoice: '/invoices', Purchase: '/purchases', Payment: '/payments', Expense: '/expenses',
    CreditNote: '/credit-notes', ReturnDocument: '/returns', Asset: '/assets', ManualJournal: '/manual-journals',
  };
  return paths[name ?? ''] ? `${paths[name ?? '']}/${sourceId}` : null;
};

const sourceName = (sourceType?: string | null): string => sourceType?.split('\\').pop() ?? '';

function filterValue(filter?: ActiveFilter): string {
  if (!filter || Array.isArray(filter.value)) return '';
  return String(filter.value).trim();
}

function isEmptyFilter(filter: ActiveFilter): boolean {
  return Array.isArray(filter.value)
    ? filter.value.every((value) => String(value).trim() === '')
    : String(filter.value).trim() === '';
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
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<BranchView>('current');

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: JournalEntry[] }>(`/journal-entries${branchViewQuery(view)}`)
      .then((response) => setEntries(response.data))
      .catch((err) => toastError(err instanceof ApiError ? err.message : tc('loadFailed')))
      .finally(() => setLoading(false));
  }, [tc, toastError, view]);

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
    router.replace(url.toString() ? `/journal-entries?${url.toString()}` : '/journal-entries', { scroll: false });
  }, [explorer, router]);

  const sourceOptions = useMemo(() => {
    const names = Array.from(new Set(entries.map((entry) => sourceName(entry.source_type)).filter(Boolean))).sort();
    return names.map((name) => ({ value: name, label: name }));
  }, [entries]);

  const definitions = useMemo<FilterDefinition[]>(() => [
    {
      key: 'entry_kind',
      label: t('type'),
      kind: 'select',
      quick: true,
      options: [
        { value: 'manual', label: t('manual') },
        { value: 'automatic', label: t('automatic') },
        { value: 'reversal', label: t('reversal') },
      ],
    },
    {
      key: 'source_type',
      label: t('source'),
      kind: 'select',
      quick: true,
      options: sourceOptions,
    },
    { key: 'date_from', label: `${t('date')} — من`, kind: 'date' },
    { key: 'date_to', label: `${t('date')} — إلى`, kind: 'date' },
    { key: 'amount_min', label: `${t('amount')} — الحد الأدنى`, kind: 'money' },
    { key: 'amount_max', label: `${t('amount')} — الحد الأعلى`, kind: 'money' },
  ], [sourceOptions, t]);

  const labelledFilters = useMemo(() => explorer.filters.map((filter) => ({
    ...filter,
    label: definitions.find((definition) => definition.key === filter.key)?.label ?? filter.label,
  })), [definitions, explorer.filters]);

  const filtered = useMemo(() => {
    const filters = new Map(explorer.filters.map((filter) => [filter.key, filter]));
    const query = explorer.search.trim().toLocaleLowerCase();
    const dateFrom = filterValue(filters.get('date_from'));
    const dateTo = filterValue(filters.get('date_to'));
    const amountMin = Number(filterValue(filters.get('amount_min')));
    const amountMax = Number(filterValue(filters.get('amount_max')));
    const kind = filterValue(filters.get('entry_kind'));
    const source = filterValue(filters.get('source_type'));

    return entries.filter((entry) => {
      if (query) {
        const haystack = [entry.number, entry.description, sourceName(entry.source_type), entry.status]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (kind && entry.entry_kind !== kind) return false;
      if (source && sourceName(entry.source_type) !== source) return false;
      if (dateFrom && entry.entry_date < dateFrom) return false;
      if (dateTo && entry.entry_date > dateTo) return false;

      const total = Number(entry.total);
      if (Number.isFinite(amountMin) && filterValue(filters.get('amount_min')) && total < amountMin) return false;
      if (Number.isFinite(amountMax) && filterValue(filters.get('amount_max')) && total > amountMax) return false;
      return true;
    });
  }, [entries, explorer.filters, explorer.search]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    const sort = explorer.sort ?? '-entry_date';
    const desc = sort.startsWith('-');
    const key = sort.replace(/^-/, '');
    next.sort((left, right) => {
      let comparison = 0;
      if (key === 'total') comparison = Number(left.total) - Number(right.total);
      else if (key === 'number') comparison = left.number.localeCompare(right.number, 'ar', { numeric: true });
      else if (key === 'entry_kind') comparison = left.entry_kind.localeCompare(right.entry_kind, 'ar');
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
    setExplorer((current) => ({
      ...current,
      page: 1,
      filters: isEmptyFilter(next) ? removeFilter(current.filters, next.key) : replaceFilter(current.filters, next),
    }));
  }

  const columns = useMemo<ColumnDef<JournalEntry, unknown>[]>(() => [
    { accessorKey: 'number', header: t('number'), cell: ({ row }) => <Link href={`/journal-entries/${row.original.id}`} className="num font-medium text-primary hover:underline">{row.original.number}</Link> },
    { accessorKey: 'entry_date', header: t('date'), cell: ({ row }) => <span className="num text-muted">{row.original.entry_date}</span> },
    { accessorKey: 'description', header: t('source'), cell: ({ row }) => <span className="line-clamp-2 font-medium text-text">{row.original.description || t('noDescription')}</span> },
    { accessorKey: 'entry_kind', header: t('type'), cell: ({ row }) => <Badge tone={row.original.entry_kind === 'automatic' ? 'positive' : row.original.entry_kind === 'reversal' ? 'negative' : 'muted'}>{t(row.original.entry_kind)}</Badge> },
    { accessorKey: 'total', header: t('amount'), cell: ({ row }) => <span className="num block text-end font-medium text-text">{formatRiyal(row.original.total)}</span> },
    { id: 'actions', header: t('actions'), cell: ({ row }) => {
      const entry = row.original;
      const source = sourcePath(entry.source_type, entry.source_id);
      return <div className="flex justify-end gap-1"><Link href={`/journal-entries/${entry.id}`}><Button size="icon" variant="ghost" aria-label={t('view')}><Eye className="h-4 w-4" strokeWidth={1.7} /></Button></Link>{source && <Link href={source}><Button size="icon" variant="ghost" aria-label={t('viewSource')}><LinkIcon className="h-4 w-4" strokeWidth={1.7} /></Button></Link>}</div>;
    } },
  ], [t]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 text-sm text-muted">{t('subtitle')}</p></div>
        <div className="flex flex-wrap items-center gap-2"><BranchViewToggle value={view} onChange={(next) => { setView(next); setExplorer((current) => ({ ...current, page: 1 })); }} /><Link href="/manual-journals"><Button variant="outline">{t('drafts')}</Button></Link><Link href="/manual-journals/new"><Button><FilePlus className="h-4 w-4" strokeWidth={1.8} />{t('newManual')}</Button></Link></div>
      </div>

      <DataExplorerToolbar
        search={searchInput}
        searchPlaceholder={`${t('search')} · ${t('number')} · ${t('source')}`}
        onSearchChange={setSearchInput}
        definitions={definitions}
        filters={labelledFilters}
        onFilterChange={updateFilter}
        onRemoveFilter={(key) => setExplorer((current) => ({ ...current, page: 1, filters: removeFilter(current.filters, key) }))}
        onClearFilters={() => setExplorer((current) => ({ ...current, page: 1, filters: [] }))}
        onOpenAdvanced={() => setAdvancedOpen(true)}
        resultCount={sorted.length}
        totalCount={entries.length}
      />

      <div className="flex items-center justify-end gap-2">
        <span className="text-xs text-muted">ترتيب حسب</span>
        <Select value={explorer.sort ?? '-entry_date'} onChange={(event) => setExplorer((current) => ({ ...current, page: 1, sort: event.target.value }))} className="h-9 min-w-44 bg-surface text-sm" aria-label="ترتيب القيود">
          <option value="-entry_date">الأحدث أولًا</option>
          <option value="entry_date">الأقدم أولًا</option>
          <option value="number">رقم القيد</option>
          <option value="-total">المبلغ: الأعلى</option>
          <option value="total">المبلغ: الأقل</option>
          <option value="entry_kind">نوع القيد</option>
        </Select>
      </div>

      <DataTable columns={columns} data={pageData} loading={loading} emptyLabel={t('empty')} exportName="journal-entries" showToolbar={false} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">{sorted.length.toLocaleString('ar-SA')} قيد · صفحة {page.toLocaleString('ar-SA')} من {totalPages.toLocaleString('ar-SA')}</p>
        <div className="flex items-center gap-2">
          <Select value={String(perPage)} onChange={(event) => setExplorer((current) => ({ ...current, page: 1, perPage: Number(event.target.value) }))} className="h-9 w-24 bg-surface text-sm" aria-label="عدد النتائج في الصفحة">
            <option value="25">25</option><option value="50">50</option><option value="100">100</option>
          </Select>
          <Button variant="outline" size="icon" aria-label="الصفحة السابقة" disabled={loading || page <= 1} onClick={() => setExplorer((current) => ({ ...current, page: Math.max(1, page - 1) }))}><ChevronRight className="h-4 w-4" strokeWidth={1.7} /></Button>
          <Button variant="outline" size="icon" aria-label="الصفحة التالية" disabled={loading || page >= totalPages} onClick={() => setExplorer((current) => ({ ...current, page: Math.min(totalPages, page + 1) }))}><ChevronLeft className="h-4 w-4" strokeWidth={1.7} /></Button>
        </div>
      </div>

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
