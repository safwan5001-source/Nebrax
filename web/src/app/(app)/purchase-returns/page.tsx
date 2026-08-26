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
import { CreateReturnDialog } from '@/components/returns/create-return-dialog';
import { Badge } from '@/components/ui/badge';
import { BranchViewToggle } from '@/components/ui/branch-view-toggle';
import { api } from '@/lib/api';
import { branchViewQuery, type BranchView } from '@/lib/branch-view';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import { parseExplorerState, removeFilter, replaceFilter, serializeExplorerState } from '@/lib/data-explorer/url-state';
import { formatRiyal } from '@/lib/money';

interface ReturnDoc {
  id: string;
  number: string;
  partner_id: string;
  return_date: string;
  total: string;
  status: string;
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

/**
 * مرتجعات المشتريات — تصفيةٌ على المرتجعات بالنوع (`type=purchase`).
 * التفاصيل تُفتح على شاشة المرتجع المشتركة `/returns/[id]`.
 */
export default function PurchaseReturnsPage() {
  const t = useTranslations('returns');
  const tp = useTranslations('purchaseReturns');
  const ts = useTranslations('status');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? '-return_date' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [data, setData] = useState<ReturnDoc[]>([]);
  const [partners, setPartners] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<BranchView>('current');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api<{ data: ReturnDoc[] }>(`/returns?type=purchase${branchViewQuery(view, true)}`),
      api<{ data: Partner[] }>('/partners?type=supplier'),
    ])
      .then(([ret, prt]) => {
        setData(ret.data);
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
    router.replace(url.toString() ? `/purchase-returns?${url.toString()}` : '/purchase-returns', { scroll: false });
  }, [explorer, router]);

  const supplierOptions = useMemo(() => Object.entries(partners)
    .sort(([, left], [, right]) => left.localeCompare(right, 'ar'))
    .map(([value, label]) => ({ value, label })), [partners]);

  const statusOptions = useMemo(() => Array.from(new Set(data.map((item) => item.status).filter(Boolean)))
    .sort()
    .map((status) => ({ value: status, label: ts(status) })), [data, ts]);

  const definitions = useMemo<FilterDefinition[]>(() => [
    { key: 'partner_id', label: tp('supplier'), kind: 'entity', quick: true, searchPlaceholder: t('search'), emptyText: t('empty'), options: supplierOptions },
    { key: 'status', label: t('status'), kind: 'select', quick: true, options: statusOptions },
    { key: 'date_from', label: `${t('date')} ≥`, kind: 'date' },
    { key: 'date_to', label: `${t('date')} ≤`, kind: 'date' },
    { key: 'total_min', label: `${t('total')} ≥`, kind: 'money' },
    { key: 'total_max', label: `${t('total')} ≤`, kind: 'money' },
  ], [statusOptions, supplierOptions, t, tp]);

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
    const totalMinText = filterValue(filters.get('total_min'));
    const totalMaxText = filterValue(filters.get('total_max'));
    const totalMin = Number(totalMinText);
    const totalMax = Number(totalMaxText);

    return data.filter((item) => {
      if (query) {
        const haystack = [item.number, partners[item.partner_id], item.status]
          .filter(Boolean).join(' ').toLocaleLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (partnerId && item.partner_id !== partnerId) return false;
      if (status && item.status !== status) return false;
      if (dateFrom && item.return_date < dateFrom) return false;
      if (dateTo && item.return_date > dateTo) return false;
      const total = Number(item.total);
      if (totalMinText && Number.isFinite(totalMin) && total < totalMin) return false;
      if (totalMaxText && Number.isFinite(totalMax) && total > totalMax) return false;
      return true;
    });
  }, [data, explorer.filters, explorer.search, partners]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    const sort = explorer.sort ?? '-return_date';
    const desc = sort.startsWith('-');
    const key = sort.replace(/^-/, '');
    next.sort((left, right) => {
      let comparison = 0;
      if (key === 'number') comparison = left.number.localeCompare(right.number, 'ar', { numeric: true });
      else if (key === 'partner') comparison = (partners[left.partner_id] ?? '').localeCompare(partners[right.partner_id] ?? '', 'ar');
      else if (key === 'total') comparison = Number(left.total) - Number(right.total);
      else comparison = left.return_date.localeCompare(right.return_date);
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

  const columns = useMemo<ColumnDef<ReturnDoc, unknown>[]>(() => [
    {
      accessorKey: 'number',
      header: t('number'),
      cell: ({ row }) => <Link href={`/returns/${row.original.id}`} className="num text-primary hover:underline">{row.original.number}</Link>,
    },
    { id: 'partner', header: tp('supplier'), accessorFn: (r) => partners[r.partner_id] ?? '—', cell: ({ row }) => partners[row.original.partner_id] ?? '—' },
    { accessorKey: 'return_date', header: t('date'), cell: ({ row }) => <span className="num text-muted">{row.original.return_date}</span> },
    { accessorKey: 'total', header: t('total'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.total)}</div> },
    { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={row.original.status === 'posted' ? 'positive' : 'muted'}>{ts(row.original.status)}</Badge> },
  ], [partners, t, tp, ts]);

  const sortOptions: SortOption[] = [
    { value: '-return_date', label: `${t('date')} ↓` },
    { value: 'return_date', label: `${t('date')} ↑` },
    { value: 'number', label: t('number') },
    { value: 'partner', label: tp('supplier') },
    { value: '-total', label: `${t('total')} ↓` },
    { value: 'total', label: `${t('total')} ↑` },
  ];

  const headerActions: PageAction[] = [
    { key: 'create', label: t('create'), icon: Plus, onClick: () => setOpen(true), variant: 'primary' },
  ];

  return <div className="space-y-4">
    <PageHeader
      title={tp('title')}
      context={<BranchViewToggle value={view} onChange={(next) => { setView(next); setExplorer((current) => ({ ...current, page: 1 })); }} />}
      actions={headerActions}
    />

    <ListToolbar
      search={searchInput}
      searchPlaceholder={t('search')}
      searchLabel={tp('title')}
      onSearchChange={setSearchInput}
      definitions={definitions}
      filters={labelledFilters}
      onFilterChange={updateFilter}
      onRemoveFilter={(key) => setExplorer((current) => ({ ...current, page: 1, filters: removeFilter(current.filters, key) }))}
      onClearFilters={() => setExplorer((current) => ({ ...current, page: 1, filters: [] }))}
      onOpenAdvanced={() => setAdvancedOpen(true)}
      sort={{ value: explorer.sort ?? '-return_date', onChange: (value) => setExplorer((current) => ({ ...current, page: 1, sort: value })), options: sortOptions }}
      resultCount={sorted.length}
      totalCount={data.length}
    />

    <DataTable
      columns={columns}
      data={pageData}
      loading={loading}
      emptyLabel={t('empty')}
      exportName="purchase-returns"
      showToolbar={false}
      mobileRecord={(item) => ({
        title: <Link href={`/returns/${item.id}`} className="num text-primary hover:underline">{item.number}</Link>,
        subtitle: partners[item.partner_id] ?? '—',
        amountLabel: t('total'),
        amount: formatRiyal(item.total),
        status: <Badge tone={item.status === 'posted' ? 'positive' : 'muted'}>{ts(item.status)}</Badge>,
        meta: item.return_date,
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

    <CreateReturnDialog open={open} onClose={() => setOpen(false)} onCreated={load} fixedType="purchase" />
  </div>;
}
