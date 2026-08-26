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
import { BranchViewToggle } from '@/components/ui/branch-view-toggle';
import { api } from '@/lib/api';
import { branchViewQuery, type BranchView } from '@/lib/branch-view';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import { parseExplorerState, removeFilter, replaceFilter, serializeExplorerState } from '@/lib/data-explorer/url-state';
import { formatRiyal } from '@/lib/money';

interface Quote {
  id: string;
  number: string;
  partner_id: string;
  status: string;
  quote_date: string;
  valid_until: string | null;
  total: string;
}
interface Partner { id: string; name: string }

const statusTone: Record<string, 'positive' | 'warning' | 'muted' | 'negative' | 'neutral'> = {
  draft: 'muted',
  sent: 'neutral',
  accepted: 'positive',
  rejected: 'negative',
  converted: 'positive',
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

export default function QuotesPage() {
  const t = useTranslations('quotes');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? '-quote_date' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [data, setData] = useState<Quote[]>([]);
  const [partners, setPartners] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<BranchView>('current');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api<{ data: Quote[] }>(`/quotes${branchViewQuery(view)}`), api<{ data: Partner[] }>('/partners?type=customer')])
      .then(([q, prt]) => {
        setData(q.data);
        setPartners(Object.fromEntries(prt.data.map((p) => [p.id, p.name])));
      })
      .finally(() => setLoading(false));
  }, [view]);

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
    router.replace(url.toString() ? `/quotes?${url.toString()}` : '/quotes', { scroll: false });
  }, [explorer, router]);

  const partnerOptions = useMemo(() => Object.entries(partners)
    .sort(([, left], [, right]) => left.localeCompare(right, 'ar'))
    .map(([value, label]) => ({ value, label })), [partners]);

  const statusOptions = useMemo(() => Array.from(new Set(data.map((item) => item.status).filter(Boolean)))
    .sort()
    .map((status) => ({ value: status, label: t(status) })), [data, t]);

  const definitions = useMemo<FilterDefinition[]>(() => [
    { key: 'partner_id', label: t('partner'), kind: 'entity', quick: true, searchPlaceholder: t('search'), emptyText: t('empty'), options: partnerOptions },
    { key: 'status', label: t('status'), kind: 'select', quick: true, options: statusOptions },
    { key: 'date_from', label: `${t('date')} ≥`, kind: 'date' },
    { key: 'date_to', label: `${t('date')} ≤`, kind: 'date' },
    { key: 'valid_from', label: `${t('valid_until')} ≥`, kind: 'date' },
    { key: 'valid_to', label: `${t('valid_until')} ≤`, kind: 'date' },
    { key: 'total_min', label: `${t('total')} ≥`, kind: 'money' },
    { key: 'total_max', label: `${t('total')} ≤`, kind: 'money' },
  ], [partnerOptions, statusOptions, t]);

  const labelledFilters = useMemo(() => explorer.filters.map((filter) => ({
    ...filter,
    label: definitions.find((definition) => definition.key === filter.key)?.label ?? filter.label,
  })), [definitions, explorer.filters]);

  const filtered = useMemo(() => {
    const filters = new Map(explorer.filters.map((filter) => [filter.key, filter]));
    const query = explorer.search.trim().toLocaleLowerCase();
    const partnerId = filterValue(filters.get('partner_id'));
    const status = filterValue(filters.get('status'));
    const dateFrom = filterValue(filters.get('date_from'));
    const dateTo = filterValue(filters.get('date_to'));
    const validFrom = filterValue(filters.get('valid_from'));
    const validTo = filterValue(filters.get('valid_to'));
    const totalMinText = filterValue(filters.get('total_min'));
    const totalMaxText = filterValue(filters.get('total_max'));
    const totalMin = Number(totalMinText);
    const totalMax = Number(totalMaxText);

    return data.filter((quote) => {
      if (query) {
        const haystack = [quote.number, partners[quote.partner_id], quote.status]
          .filter(Boolean).join(' ').toLocaleLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (partnerId && quote.partner_id !== partnerId) return false;
      if (status && quote.status !== status) return false;
      if (dateFrom && quote.quote_date < dateFrom) return false;
      if (dateTo && quote.quote_date > dateTo) return false;
      if (validFrom && (!quote.valid_until || quote.valid_until < validFrom)) return false;
      if (validTo && (!quote.valid_until || quote.valid_until > validTo)) return false;
      const total = Number(quote.total);
      if (totalMinText && Number.isFinite(totalMin) && total < totalMin) return false;
      if (totalMaxText && Number.isFinite(totalMax) && total > totalMax) return false;
      return true;
    });
  }, [data, explorer.filters, explorer.search, partners]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    const sort = explorer.sort ?? '-quote_date';
    const desc = sort.startsWith('-');
    const key = sort.replace(/^-/, '');
    next.sort((left, right) => {
      let comparison = 0;
      if (key === 'number') comparison = left.number.localeCompare(right.number, 'ar', { numeric: true });
      else if (key === 'partner') comparison = (partners[left.partner_id] ?? '').localeCompare(partners[right.partner_id] ?? '', 'ar');
      else if (key === 'valid_until') comparison = (left.valid_until ?? '').localeCompare(right.valid_until ?? '');
      else if (key === 'total') comparison = Number(left.total) - Number(right.total);
      else if (key === 'status') comparison = left.status.localeCompare(right.status);
      else comparison = left.quote_date.localeCompare(right.quote_date);
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

  const columns = useMemo<ColumnDef<Quote, unknown>[]>(
    () => [
      {
        accessorKey: 'number',
        header: t('number'),
        cell: ({ row }) => (
          <Link href={`/quotes/${row.original.id}`} className="num text-primary hover:underline">
            {row.original.number}
          </Link>
        ),
      },
      {
        id: 'partner',
        header: t('partner'),
        accessorFn: (r) => partners[r.partner_id] ?? '—',
        cell: ({ row }) => partners[row.original.partner_id] ?? '—',
      },
      { accessorKey: 'quote_date', header: t('date'), cell: ({ row }) => <span className="num text-muted">{row.original.quote_date}</span> },
      { accessorKey: 'valid_until', header: t('valid_until'), cell: ({ row }) => <span className="num text-muted">{row.original.valid_until ?? '—'}</span> },
      { accessorKey: 'total', header: t('total'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.total)}</div> },
      { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={statusTone[row.original.status] ?? 'muted'}>{t(row.original.status)}</Badge> },
    ],
    [partners, t]
  );

  const sortOptions: SortOption[] = [
    { value: '-quote_date', label: `${t('date')} ↓` },
    { value: 'quote_date', label: `${t('date')} ↑` },
    { value: 'number', label: t('number') },
    { value: 'partner', label: t('partner') },
    { value: 'valid_until', label: t('valid_until') },
    { value: '-total', label: `${t('total')} ↓` },
    { value: 'total', label: `${t('total')} ↑` },
    { value: 'status', label: t('status') },
  ];

  const headerActions: PageAction[] = [
    { key: 'create', label: t('create'), icon: Plus, href: '/quotes/new', variant: 'primary' },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('title')}
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
        sort={{ value: explorer.sort ?? '-quote_date', onChange: (value) => setExplorer((current) => ({ ...current, page: 1, sort: value })), options: sortOptions }}
        resultCount={sorted.length}
        totalCount={data.length}
      />

      <DataTable
        columns={columns}
        data={pageData}
        loading={loading}
        emptyLabel={t('empty')}
        exportName="quotes"
        showToolbar={false}
        mobileRecord={(quote) => ({
          title: <Link href={`/quotes/${quote.id}`} className="num text-primary hover:underline">{quote.number}</Link>,
          subtitle: partners[quote.partner_id] ?? '—',
          amountLabel: t('total'),
          amount: formatRiyal(quote.total),
          status: <Badge tone={statusTone[quote.status] ?? 'muted'}>{t(quote.status)}</Badge>,
          secondary: quote.valid_until ? { label: t('valid_until'), value: quote.valid_until } : undefined,
          meta: quote.quote_date,
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
