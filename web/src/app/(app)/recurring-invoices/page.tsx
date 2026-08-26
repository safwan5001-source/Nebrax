'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { AdvancedFilterDialog } from '@/components/data-explorer/advanced-filter-dialog';
import { DataTable } from '@/components/data-table';
import { ListToolbar, PageHeader, Pagination, type PageAction, type SortOption } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import { parseExplorerState, removeFilter, replaceFilter, serializeExplorerState } from '@/lib/data-explorer/url-state';
import { formatRiyal } from '@/lib/money';

interface Recurring {
  id: string;
  title: string | null;
  partner_id: string;
  frequency: string;
  next_run_date: string;
  generated_count: number;
  total: string;
  active: boolean;
}
interface Partner { id: string; name: string }

function filterValue(filter?: ActiveFilter): string {
  if (!filter || Array.isArray(filter.value)) return '';
  return String(filter.value).trim();
}

function isEmptyFilter(filter: ActiveFilter): boolean {
  return Array.isArray(filter.value)
    ? filter.value.every((value) => String(value).trim() === '')
    : String(filter.value).trim() === '';
}

export default function RecurringInvoicesPage() {
  const t = useTranslations('recurring');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? 'next_run_date' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [data, setData] = useState<Recurring[]>([]);
  const [partners, setPartners] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api<{ data: Recurring[] }>('/recurring-invoices'),
      api<{ data: Partner[] }>('/partners?type=customer'),
    ])
      .then(([rec, prt]) => {
        setData(rec.data);
        setPartners(Object.fromEntries(prt.data.map((p) => [p.id, p.name])));
      })
      .finally(() => setLoading(false));
  }, []);

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
    router.replace(url.toString() ? `/recurring-invoices?${url.toString()}` : '/recurring-invoices', { scroll: false });
  }, [explorer, router]);

  const customerOptions = useMemo(() => Object.entries(partners)
    .sort(([, left], [, right]) => left.localeCompare(right, 'ar'))
    .map(([value, label]) => ({ value, label })), [partners]);

  const frequencyOptions = useMemo(() => Array.from(new Set(data.map((item) => item.frequency).filter(Boolean)))
    .sort()
    .map((frequency) => ({ value: frequency, label: t(frequency) })), [data, t]);

  const definitions = useMemo<FilterDefinition[]>(() => [
    { key: 'partner_id', label: t('partner'), kind: 'entity', quick: true, searchPlaceholder: t('search'), emptyText: t('empty'), options: customerOptions },
    { key: 'frequency', label: t('frequency'), kind: 'select', quick: true, options: frequencyOptions },
    { key: 'active', label: t('status'), kind: 'select', quick: true, options: [{ value: '1', label: t('active') }, { value: '0', label: t('inactive') }] },
    { key: 'next_from', label: `${t('next_run')} ≥`, kind: 'date' },
    { key: 'next_to', label: `${t('next_run')} ≤`, kind: 'date' },
    { key: 'total_min', label: `${t('total')} ≥`, kind: 'money' },
    { key: 'total_max', label: `${t('total')} ≤`, kind: 'money' },
  ], [customerOptions, frequencyOptions, t]);

  const labelledFilters = useMemo(() => explorer.filters.map((filter) => ({
    ...filter,
    label: definitions.find((definition) => definition.key === filter.key)?.label ?? filter.label,
  })), [definitions, explorer.filters]);

  const filtered = useMemo(() => {
    const filters = new Map(explorer.filters.map((filter) => [filter.key, filter]));
    const query = explorer.search.trim().toLocaleLowerCase();
    const partnerId = filterValue(filters.get('partner_id'));
    const frequency = filterValue(filters.get('frequency'));
    const active = filterValue(filters.get('active'));
    const nextFrom = filterValue(filters.get('next_from'));
    const nextTo = filterValue(filters.get('next_to'));
    const totalMinText = filterValue(filters.get('total_min'));
    const totalMaxText = filterValue(filters.get('total_max'));
    const totalMin = Number(totalMinText);
    const totalMax = Number(totalMaxText);

    return data.filter((item) => {
      if (query) {
        const haystack = [item.title, partners[item.partner_id], item.frequency]
          .filter(Boolean).join(' ').toLocaleLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (partnerId && item.partner_id !== partnerId) return false;
      if (frequency && item.frequency !== frequency) return false;
      if (active && item.active !== (active === '1')) return false;
      if (nextFrom && item.next_run_date < nextFrom) return false;
      if (nextTo && item.next_run_date > nextTo) return false;
      const total = Number(item.total);
      if (totalMinText && Number.isFinite(totalMin) && total < totalMin) return false;
      if (totalMaxText && Number.isFinite(totalMax) && total > totalMax) return false;
      return true;
    });
  }, [data, explorer.filters, explorer.search, partners]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    const sort = explorer.sort ?? 'next_run_date';
    const desc = sort.startsWith('-');
    const key = sort.replace(/^-/, '');
    next.sort((left, right) => {
      let comparison = 0;
      if (key === 'title') comparison = (left.title ?? '').localeCompare(right.title ?? '', 'ar');
      else if (key === 'partner') comparison = (partners[left.partner_id] ?? '').localeCompare(partners[right.partner_id] ?? '', 'ar');
      else if (key === 'total') comparison = Number(left.total) - Number(right.total);
      else comparison = left.next_run_date.localeCompare(right.next_run_date);
      return desc ? -comparison : comparison;
    });
    return next;
  }, [explorer.sort, filtered, partners]);

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

  const columns = useMemo<ColumnDef<Recurring, unknown>[]>(() => [
    {
      accessorKey: 'title',
      header: t('template'),
      cell: ({ row }) => <Link href={`/recurring-invoices/${row.original.id}`} className="text-primary hover:underline">{row.original.title || (partners[row.original.partner_id] ?? '—')}</Link>,
    },
    { id: 'partner', header: t('partner'), accessorFn: (r) => partners[r.partner_id] ?? '—', cell: ({ row }) => partners[row.original.partner_id] ?? '—' },
    { accessorKey: 'frequency', header: t('frequency'), cell: ({ row }) => <Badge tone="neutral">{t(row.original.frequency)}</Badge> },
    { accessorKey: 'next_run_date', header: t('next_run'), cell: ({ row }) => <span className="num text-muted">{row.original.next_run_date}</span> },
    { accessorKey: 'total', header: t('total'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.total)}</div> },
    { accessorKey: 'active', header: t('status'), cell: ({ row }) => <Badge tone={row.original.active ? 'positive' : 'muted'}>{row.original.active ? t('active') : t('inactive')}</Badge> },
  ], [partners, t]);

  const sortOptions: SortOption[] = [
    { value: 'next_run_date', label: `${t('next_run')} ↑` },
    { value: '-next_run_date', label: `${t('next_run')} ↓` },
    { value: 'title', label: t('template') },
    { value: 'partner', label: t('partner') },
    { value: '-total', label: `${t('total')} ↓` },
    { value: 'total', label: `${t('total')} ↑` },
  ];

  const headerActions: PageAction[] = [
    { key: 'create', label: t('create'), icon: Plus, href: '/recurring-invoices/new', variant: 'primary' },
  ];

  return <div className="space-y-4">
    <PageHeader title={t('title')} actions={headerActions} />

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
      sort={{ value: explorer.sort ?? 'next_run_date', onChange: (value) => setExplorer((current) => ({ ...current, page: 1, sort: value })), options: sortOptions }}
      resultCount={sorted.length}
      totalCount={data.length}
    />

    <DataTable
      columns={columns}
      data={pageData}
      loading={loading}
      emptyLabel={t('empty')}
      exportName="recurring-invoices"
      showToolbar={false}
      mobileRecord={(item) => ({
        title: <Link href={`/recurring-invoices/${item.id}`} className="text-primary hover:underline">{item.title || (partners[item.partner_id] ?? '—')}</Link>,
        subtitle: partners[item.partner_id] ?? '—',
        amountLabel: t('total'),
        amount: formatRiyal(item.total),
        secondary: { label: t('frequency'), value: t(item.frequency) },
        status: <Badge tone={item.active ? 'positive' : 'muted'}>{item.active ? t('active') : t('inactive')}</Badge>,
        meta: item.next_run_date,
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
  </div>;
}
