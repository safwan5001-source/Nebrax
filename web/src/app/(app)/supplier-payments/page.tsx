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
import { PaymentDialog } from '@/components/payments/payment-dialog';
import { api, ApiError } from '@/lib/api';
import { useBranches } from '@/lib/branch';
import { branchFilterDefinition } from '@/lib/branch-filter';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import { parseExplorerState, removeFilter, replaceFilter, serializeExplorerState } from '@/lib/data-explorer/url-state';
import { formatRiyal } from '@/lib/money';

interface Payment { id: string; number: string; partner_id: string; method: string; status: string; payment_date: string; amount: string }
interface Partner { id: string; name: string }

function filterValue(filter?: ActiveFilter): string {
  if (!filter || Array.isArray(filter.value)) return '';
  return String(filter.value).trim();
}
function isEmptyFilter(filter: ActiveFilter): boolean {
  return Array.isArray(filter.value) ? filter.value.every((value) => String(value).trim() === '') : String(filter.value).trim() === '';
}

/** مدفوعات الموردين — سندات الصرف (`direction=paid`). */
export default function SupplierPaymentsPage() {
  const t = useTranslations('payments');
  const tsp = useTranslations('supplierPayments');
  const ts = useTranslations('status');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { branches, active } = useBranches();
  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? '-payment_date' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [data, setData] = useState<Payment[]>([]);
  const [partnerList, setPartnerList] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const partners = useMemo(() => Object.fromEntries(partnerList.map((partner) => [partner.id, partner.name])), [partnerList]);
  const branchValue = useMemo(() => filterValue(explorer.filters.find((filter) => filter.key === 'branch')), [explorer.filters]);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    const params = new URLSearchParams({ direction: 'paid' });
    if (branchValue) params.set('branch', branchValue);
    Promise.all([
      api<{ data: Payment[] }>(`/payments?${params.toString()}`),
      api<{ data: Partner[] }>('/partners?type=supplier'),
    ])
      .then(([pay, prt]) => { setData(pay.data); setPartnerList(prt.data); })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : tsp('load_error')))
      .finally(() => setLoading(false));
  }, [branchValue, tsp]);

  useEffect(() => load(), [load]);
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
    branchFilterDefinition(branches, active?.name),
    { key: 'partner_id', label: tsp('supplier'), kind: 'entity', quick: true, searchPlaceholder: tsp('search'), emptyText: tsp('empty'), options: partnerList.map((partner) => ({ value: partner.id, label: partner.name })) },
    { key: 'method', label: t('method'), kind: 'select', quick: true, options: methodOptions },
    { key: 'status', label: t('status'), kind: 'select', quick: true, options: [{ value: 'draft', label: ts('draft') }, { value: 'posted', label: ts('posted') }, { value: 'cancelled', label: ts('cancelled') }] },
    { key: 'date_from', label: tsp('filter_date_from'), kind: 'date' },
    { key: 'date_to', label: tsp('filter_date_to'), kind: 'date' },
    { key: 'amount_min', label: tsp('filter_amount_min'), kind: 'money' },
    { key: 'amount_max', label: tsp('filter_amount_max'), kind: 'money' },
  ], [active?.name, branches, methodOptions, partnerList, t, tsp, ts]);

  const labelledFilters = useMemo(() => explorer.filters.map((filter) => ({ ...filter, label: definitions.find((definition) => definition.key === filter.key)?.label ?? filter.label })), [definitions, explorer.filters]);
  const filtered = useMemo(() => {
    const filters = new Map(explorer.filters.map((filter) => [filter.key, filter]));
    const query = explorer.search.trim().toLocaleLowerCase();
    const partnerId = filterValue(filters.get('partner_id'));
    const method = filterValue(filters.get('method'));
    const status = filterValue(filters.get('status'));
    const dateFrom = filterValue(filters.get('date_from'));
    const dateTo = filterValue(filters.get('date_to'));
    const minText = filterValue(filters.get('amount_min'));
    const maxText = filterValue(filters.get('amount_max'));
    const min = Number(minText); const max = Number(maxText);
    return data.filter((payment) => {
      if (query && ![payment.number, partners[payment.partner_id], payment.method, payment.status].filter(Boolean).join(' ').toLocaleLowerCase().includes(query)) return false;
      if (partnerId && payment.partner_id !== partnerId) return false;
      if (method && payment.method !== method) return false;
      if (status && payment.status !== status) return false;
      if (dateFrom && payment.payment_date < dateFrom) return false;
      if (dateTo && payment.payment_date > dateTo) return false;
      const amount = Number(payment.amount);
      if (minText && Number.isFinite(min) && amount < min) return false;
      if (maxText && Number.isFinite(max) && amount > max) return false;
      return true;
    });
  }, [data, explorer.filters, explorer.search, partners]);

  const sorted = useMemo(() => {
    const next = [...filtered]; const sort = explorer.sort ?? '-payment_date'; const desc = sort.startsWith('-'); const key = sort.replace(/^-/, '');
    next.sort((left, right) => {
      let comparison = 0;
      if (key === 'amount') comparison = Number(left.amount) - Number(right.amount);
      else if (key === 'number') comparison = left.number.localeCompare(right.number, 'ar', { numeric: true });
      else if (key === 'partner') comparison = (partners[left.partner_id] ?? '').localeCompare(partners[right.partner_id] ?? '', 'ar');
      else comparison = left.payment_date.localeCompare(right.payment_date);
      return desc ? -comparison : comparison;
    });
    return next;
  }, [explorer.sort, filtered, partners]);

  const perPage = explorer.perPage ?? 25; const totalPages = Math.max(1, Math.ceil(sorted.length / perPage)); const page = Math.min(explorer.page ?? 1, totalPages); const pageData = sorted.slice((page - 1) * perPage, page * perPage);
  function updateFilter(next: ActiveFilter) { setExplorer((current) => ({ ...current, page: 1, filters: isEmptyFilter(next) ? removeFilter(current.filters, next.key) : replaceFilter(current.filters, next) })); }

  const columns = useMemo<ColumnDef<Payment, unknown>[]>(() => [
    { accessorKey: 'number', header: t('number'), cell: ({ row }) => <Link href={`/payments/${row.original.id}`} className="num text-primary hover:underline">{row.original.number}</Link> },
    { id: 'partner', header: tsp('supplier'), accessorFn: (r) => partners[r.partner_id] ?? '—', cell: ({ row }) => partners[row.original.partner_id] ?? '—' },
    { accessorKey: 'payment_date', header: t('date'), cell: ({ row }) => <span className="num text-muted">{row.original.payment_date}</span> },
    { accessorKey: 'method', header: t('method'), cell: ({ row }) => <Badge tone="muted">{t(row.original.method)}</Badge> },
    { accessorKey: 'amount', header: t('amount'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.amount)}</div> },
    { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={row.original.status === 'posted' ? 'positive' : 'muted'}>{ts(row.original.status)}</Badge> },
  ], [partners, t, tsp, ts]);
  const sortOptions: SortOption[] = [{ value: '-payment_date', label: tsp('sort_date_desc') }, { value: 'payment_date', label: tsp('sort_date_asc') }, { value: 'number', label: t('number') }, { value: 'partner', label: tsp('supplier') }, { value: '-amount', label: tsp('sort_amount_desc') }, { value: 'amount', label: tsp('sort_amount_asc') }];
  const headerActions: PageAction[] = [{ key: 'create', label: tsp('create'), icon: Plus, onClick: () => setOpen(true), variant: 'primary' }];

  return <div className="space-y-4">
    <PageHeader title={tsp('title')} actions={headerActions} />
    <ListToolbar search={searchInput} searchPlaceholder={`${tsp('search')} · ${t('number')} · ${tsp('supplier')}`} searchLabel={tsp('title')} onSearchChange={setSearchInput}
      definitions={definitions} filters={labelledFilters} onFilterChange={updateFilter}
      onRemoveFilter={(key) => setExplorer((current) => ({ ...current, page: 1, filters: removeFilter(current.filters, key) }))} onClearFilters={() => setExplorer((current) => ({ ...current, page: 1, filters: [] }))}
      onOpenAdvanced={() => setAdvancedOpen(true)} sort={{ value: explorer.sort ?? '-payment_date', onChange: (value) => setExplorer((current) => ({ ...current, page: 1, sort: value })), options: sortOptions }} resultCount={sorted.length} totalCount={data.length} />
    <DataTable columns={columns} data={pageData} loading={loading} error={loadError} onRetry={load} emptyLabel={tsp('empty')} exportName="supplier-payments" showToolbar={false}
      mobileRecord={(payment) => ({ title: <Link href={`/payments/${payment.id}`} className="num text-primary hover:underline">{payment.number}</Link>, subtitle: partners[payment.partner_id] ?? '—', amountLabel: t('amount'), amount: formatRiyal(payment.amount), secondary: { label: t('method'), value: t(payment.method) }, status: <Badge tone={payment.status === 'posted' ? 'positive' : 'muted'}>{ts(payment.status)}</Badge>, meta: payment.payment_date })} />
    <Pagination page={page} lastPage={totalPages} perPage={perPage} total={sorted.length} disabled={loading} onPageChange={(next) => setExplorer((current) => ({ ...current, page: next }))} onPerPageChange={(next) => setExplorer((current) => ({ ...current, page: 1, perPage: next }))} />
    <AdvancedFilterDialog open={advancedOpen} onClose={() => setAdvancedOpen(false)} definitions={definitions} filters={labelledFilters} onApply={(filters) => setExplorer((current) => ({ ...current, page: 1, filters }))} />
    <PaymentDialog open={open} onClose={() => setOpen(false)} onSaved={load} fixedDirection="paid" />
  </div>;
}
