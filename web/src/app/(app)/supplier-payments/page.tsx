'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { AdvancedFilterDialog } from '@/components/data-explorer/advanced-filter-dialog';
import { DataTable } from '@/components/data-table';
import { ListToolbar, PageHeader, Pagination, type PageAction, type SortOption } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { BranchViewToggle } from '@/components/ui/branch-view-toggle';
import { PaymentDialog } from '@/components/payments/payment-dialog';
import { api, ApiError } from '@/lib/api';
import { branchViewQuery, type BranchView } from '@/lib/branch-view';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import { parseExplorerState, removeFilter, replaceFilter, serializeExplorerState } from '@/lib/data-explorer/url-state';
import { formatRiyal } from '@/lib/money';

interface Payment {
  id: string;
  number: string;
  partner_id: string;
  partner_name?: string | null;
  method: string;
  status: string;
  payment_date: string;
  amount: string;
}
interface Partner { id: string; name: string }
interface PaginationMeta { current_page: number; last_page: number; per_page: number; total: number }

function isEmptyFilter(filter: ActiveFilter): boolean {
  return Array.isArray(filter.value)
    ? filter.value.every((value) => String(value).trim() === '')
    : String(filter.value).trim() === '';
}

function paymentQuery(state: DataExplorerState, view: BranchView): string {
  const params = new URLSearchParams(branchViewQuery(view).replace(/^\?/, ''));
  params.set('direction', 'paid');
  if (state.search.trim()) params.set('search', state.search.trim());
  if (state.sort) params.set('sort', state.sort === 'partner' ? 'partner_name' : state.sort);
  params.set('page', String(state.page ?? 1));
  params.set('per_page', String(state.perPage ?? 25));
  for (const filter of state.filters) {
    if (Array.isArray(filter.value) || String(filter.value).trim() === '') continue;
    if (['partner_name', 'method', 'status', 'date_from', 'date_to', 'amount_min', 'amount_max'].includes(filter.key)) {
      params.set(filter.key, String(filter.value));
    }
  }
  return params.toString();
}

/** مدفوعات الموردين — سندات الصرف (`direction=paid`). */
export default function SupplierPaymentsPage() {
  const t = useTranslations('payments');
  const tsp = useTranslations('supplierPayments');
  const ts = useTranslations('status');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? '-payment_date' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [data, setData] = useState<Payment[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [partnerList, setPartnerList] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<BranchView>('current');

  const partners = useMemo(() => Object.fromEntries(partnerList.map((partner) => [partner.id, partner.name])), [partnerList]);

  const loadPayments = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api<{ data: Payment[]; meta?: PaginationMeta }>(`/payments?${paymentQuery(explorer, view)}`)
      .then((response) => {
        const rows = Array.isArray(response.data) ? response.data : [];
        setData(rows);
        setPagination(response.meta ?? { current_page: 1, last_page: 1, per_page: explorer.perPage ?? 25, total: rows.length });
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : tsp('load_error')))
      .finally(() => setLoading(false));
  }, [explorer, tsp, view]);

  const load = useCallback(() => loadPayments(), [loadPayments]);
  useEffect(() => { api<{ data: Partner[] }>('/partners?type=supplier').then((response) => setPartnerList(response.data)).catch(() => setPartnerList([])); }, []);
  useEffect(() => loadPayments(), [loadPayments]);
  useEffect(() => {
    const timer = window.setTimeout(() => setExplorer((current) => current.search === searchInput ? current : { ...current, search: searchInput, page: 1 }), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  useEffect(() => {
    const url = serializeExplorerState(explorer);
    router.replace(url.toString() ? `/supplier-payments?${url.toString()}` : '/supplier-payments', { scroll: false });
  }, [explorer, router]);

  const methodOptions = useMemo(() => Array.from(new Set(data.map((payment) => payment.method).filter(Boolean))).sort().map((method) => ({ value: method, label: t(method) })), [data, t]);
  const definitions = useMemo<FilterDefinition[]>(() => [
    {
      key: 'partner_name', label: tsp('supplier'), kind: 'entity', quick: true,
      searchPlaceholder: tsp('search'), emptyText: tsp('empty'),
      options: partnerList.map((partner) => ({ value: partner.name, label: partner.name })),
    },
    { key: 'method', label: t('method'), kind: 'select', quick: true, options: methodOptions },
    { key: 'status', label: t('status'), kind: 'select', quick: true, options: [
      { value: 'draft', label: ts('draft') }, { value: 'posted', label: ts('posted') }, { value: 'cancelled', label: ts('cancelled') },
    ] },
    { key: 'date_from', label: tsp('filter_date_from'), kind: 'date' }, { key: 'date_to', label: tsp('filter_date_to'), kind: 'date' },
    { key: 'amount_min', label: tsp('filter_amount_min'), kind: 'money' }, { key: 'amount_max', label: tsp('filter_amount_max'), kind: 'money' },
  ], [methodOptions, partnerList, t, tsp, ts]);
  const labelledFilters = useMemo(() => explorer.filters.map((filter) => ({ ...filter, label: definitions.find((definition) => definition.key === filter.key)?.label ?? filter.label })), [definitions, explorer.filters]);

  function updateFilter(next: ActiveFilter) {
    setExplorer((current) => ({ ...current, page: 1, filters: isEmptyFilter(next) ? removeFilter(current.filters, next.key) : replaceFilter(current.filters, next) }));
  }

  const columns = useMemo<ColumnDef<Payment, unknown>[]>(() => [
    { accessorKey: 'number', header: t('number'), cell: ({ row }) => <Link href={`/payments/${row.original.id}`} className="num text-primary hover:underline">{row.original.number}</Link> },
    { id: 'partner', header: tsp('supplier'), accessorFn: (r) => r.partner_name ?? partners[r.partner_id] ?? '—', cell: ({ row }) => row.original.partner_name ?? partners[row.original.partner_id] ?? '—' },
    { accessorKey: 'payment_date', header: t('date'), cell: ({ row }) => <span className="num text-muted">{row.original.payment_date}</span> },
    { accessorKey: 'method', header: t('method'), cell: ({ row }) => <Badge tone="muted">{t(row.original.method)}</Badge> },
    { accessorKey: 'amount', header: t('amount'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.amount)}</div> },
    { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={row.original.status === 'posted' ? 'positive' : 'muted'}>{ts(row.original.status)}</Badge> },
  ], [partners, t, tsp, ts]);

  const sortOptions: SortOption[] = [
    { value: '-payment_date', label: tsp('sort_date_desc') }, { value: 'payment_date', label: tsp('sort_date_asc') },
    { value: 'number', label: t('number') }, { value: 'partner', label: tsp('supplier') },
    { value: '-amount', label: tsp('sort_amount_desc') }, { value: 'amount', label: tsp('sort_amount_asc') },
  ];
  const headerActions: PageAction[] = [{ key: 'create', label: tsp('create'), icon: Plus, onClick: () => setOpen(true), variant: 'primary' }];
  const page = pagination?.current_page ?? explorer.page ?? 1;
  const lastPage = pagination?.last_page ?? 1;
  const perPage = pagination?.per_page ?? explorer.perPage ?? 25;
  const total = pagination?.total ?? data.length;

  return <div className="space-y-4">
    <PageHeader title={tsp('title')} context={<BranchViewToggle value={view} onChange={(next) => { setView(next); setExplorer((current) => ({ ...current, page: 1 })); }} />} actions={headerActions} />
    <ListToolbar
      search={searchInput} searchPlaceholder={`${tsp('search')} · ${t('number')} · ${tsp('supplier')}`} searchLabel={tsp('title')} onSearchChange={setSearchInput}
      definitions={definitions} filters={labelledFilters} onFilterChange={updateFilter}
      onRemoveFilter={(key) => setExplorer((current) => ({ ...current, page: 1, filters: removeFilter(current.filters, key) }))}
      onClearFilters={() => setExplorer((current) => ({ ...current, page: 1, filters: [] }))} onOpenAdvanced={() => setAdvancedOpen(true)}
      sort={{ value: explorer.sort ?? '-payment_date', onChange: (value) => setExplorer((current) => ({ ...current, page: 1, sort: value })), options: sortOptions }}
      resultCount={data.length} totalCount={total}
    />
    <DataTable columns={columns} data={data} loading={loading} error={loadError} onRetry={load} emptyLabel={tsp('empty')} exportName="supplier-payments" showToolbar={false}
      mobileRecord={(payment) => ({
        title: <Link href={`/payments/${payment.id}`} className="num text-primary hover:underline">{payment.number}</Link>,
        subtitle: payment.partner_name ?? partners[payment.partner_id] ?? '—', amountLabel: t('amount'), amount: formatRiyal(payment.amount),
        secondary: { label: t('method'), value: t(payment.method) }, status: <Badge tone={payment.status === 'posted' ? 'positive' : 'muted'}>{ts(payment.status)}</Badge>, meta: payment.payment_date,
      })}
    />
    <Pagination page={page} lastPage={lastPage} perPage={perPage} total={total} disabled={loading}
      onPageChange={(next) => setExplorer((current) => ({ ...current, page: next }))}
      onPerPageChange={(next) => setExplorer((current) => ({ ...current, page: 1, perPage: next }))} />
    <AdvancedFilterDialog open={advancedOpen} onClose={() => setAdvancedOpen(false)} definitions={definitions} filters={labelledFilters} onApply={(filters) => setExplorer((current) => ({ ...current, page: 1, filters }))} />
    <PaymentDialog open={open} onClose={() => setOpen(false)} onSaved={load} fixedDirection="paid" />
  </div>;
}
