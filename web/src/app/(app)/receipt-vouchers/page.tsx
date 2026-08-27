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
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { BranchViewToggle } from '@/components/ui/branch-view-toggle';
import { branchViewQuery, type BranchView } from '@/lib/branch-view';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import { parseExplorerState, removeFilter, replaceFilter, serializeExplorerState } from '@/lib/data-explorer/url-state';
import { formatRiyal } from '@/lib/money';

interface Voucher { id: string; number: string; partner_name?: string | null; method: string; payment_date: string; amount: string; status: string }
interface Partner { id: string; name: string }
interface PaginationMeta { current_page: number; last_page: number; per_page: number; total: number }
const tone: Record<string, 'positive' | 'warning' | 'muted'> = { posted: 'positive', draft: 'warning', cancelled: 'muted' };

function isEmptyFilter(filter: ActiveFilter): boolean {
  return Array.isArray(filter.value)
    ? filter.value.every((value) => String(value).trim() === '')
    : String(filter.value).trim() === '';
}

function paymentQuery(state: DataExplorerState, view: BranchView): string {
  const params = new URLSearchParams(branchViewQuery(view).replace(/^\?/, ''));
  params.set('direction', 'received');
  if (state.search.trim()) params.set('search', state.search.trim());
  if (state.sort) params.set('sort', state.sort);
  params.set('page', String(state.page ?? 1));
  params.set('per_page', String(state.perPage ?? 25));
  for (const filter of state.filters) {
    if (Array.isArray(filter.value) || String(filter.value).trim() === '') continue;
    if (['status', 'method', 'partner_name', 'date_from', 'date_to', 'amount_min', 'amount_max'].includes(filter.key)) {
      params.set(filter.key, String(filter.value));
    }
  }
  return params.toString();
}

export default function ReceiptVouchersPage() {
  const t = useTranslations('receiptVouchers');
  const tc = useTranslations('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { success, error: toastError } = useToast();
  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? '-payment_date' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [data, setData] = useState<Voucher[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [customers, setCustomers] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<BranchView>('current');
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api<{ data: Voucher[]; meta?: PaginationMeta }>(`/payments?${paymentQuery(explorer, view)}`)
      .then((response) => {
        const rows = Array.isArray(response.data) ? response.data : [];
        setData(rows);
        setPagination(response.meta ?? { current_page: 1, last_page: 1, per_page: explorer.perPage ?? 25, total: rows.length });
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : t('load_list_failed')))
      .finally(() => setLoading(false));
  }, [explorer, t, view]);

  useEffect(() => { api<{ data: Partner[] }>('/partners?type=customer').then((response) => setCustomers(response.data)).catch(() => setCustomers([])); }, []);
  useEffect(() => load(), [load]);
  useEffect(() => {
    const timer = window.setTimeout(() => setExplorer((current) => current.search === searchInput ? current : { ...current, search: searchInput, page: 1 }), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  useEffect(() => {
    const url = serializeExplorerState(explorer);
    router.replace(url.toString() ? `/receipt-vouchers?${url.toString()}` : '/receipt-vouchers', { scroll: false });
  }, [explorer, router]);

  const duplicate = useCallback(async (id: string) => {
    setActing(id);
    try { const response = await api<{ data: Voucher }>(`/payments/${id}/duplicate`, { method: 'POST' }); success(t('duplicate_success')); router.push(`/receipt-vouchers/new?edit=${response.data.id}`); }
    catch (err) { toastError(err instanceof ApiError ? err.message : tc('saveFailed')); }
    finally { setActing(null); }
  }, [router, success, t, tc, toastError]);

  const remove = useCallback(async (id: string) => {
    if (!window.confirm(t('confirm_delete'))) return;
    setActing(id);
    try { await api(`/payments/${id}`, { method: 'DELETE' }); success(t('deleted_success')); load(); }
    catch (err) { toastError(err instanceof ApiError ? err.message : tc('saveFailed')); }
    finally { setActing(null); }
  }, [load, success, t, tc, toastError]);

  const post = useCallback(async (id: string) => {
    if (!window.confirm(t('confirm_post'))) return;
    setActing(id);
    try { await api(`/payments/${id}/post`, { method: 'POST' }); success(t('post_success')); load(); }
    catch (err) { toastError(err instanceof ApiError ? err.message : tc('saveFailed')); }
    finally { setActing(null); }
  }, [load, success, t, tc, toastError]);

  const methodOptions = useMemo(() => Array.from(new Set(data.map((voucher) => voucher.method).filter(Boolean))).sort().map((method) => ({ value: method, label: t(method) })), [data, t]);
  const customerOptions = useMemo(() => customers.map((customer) => ({ value: customer.name, label: customer.name })), [customers]);
  const definitions = useMemo<FilterDefinition[]>(() => [
    { key: 'status', label: t('status'), kind: 'select', quick: true, options: [
      { value: 'draft', label: t('draft') }, { value: 'posted', label: t('posted') }, { value: 'cancelled', label: t('cancelled') },
    ] },
    { key: 'method', label: t('method'), kind: 'select', quick: true, options: methodOptions },
    { key: 'partner_name', label: t('customer'), kind: 'entity', quick: true, searchPlaceholder: t('search'), emptyText: t('empty'), options: customerOptions },
    { key: 'date_from', label: t('filter_date_from'), kind: 'date' }, { key: 'date_to', label: t('filter_date_to'), kind: 'date' },
    { key: 'amount_min', label: t('filter_amount_min'), kind: 'money' }, { key: 'amount_max', label: t('filter_amount_max'), kind: 'money' },
  ], [customerOptions, methodOptions, t]);
  const labelledFilters = useMemo(() => explorer.filters.map((filter) => ({ ...filter, label: definitions.find((definition) => definition.key === filter.key)?.label ?? filter.label })), [definitions, explorer.filters]);

  function updateFilter(next: ActiveFilter) {
    setExplorer((current) => ({ ...current, page: 1, filters: isEmptyFilter(next) ? removeFilter(current.filters, next.key) : replaceFilter(current.filters, next) }));
  }

  const rowActions = useCallback((voucher: Voucher) => {
    const draft = voucher.status === 'draft';
    const busy = acting === voucher.id;
    return <>
      <Button asChild size="icon" variant="ghost" aria-label={t('view')}><Link href={`/receipt-vouchers/${voucher.id}`}><Eye className="h-4 w-4" strokeWidth={1.7} /></Link></Button>
      {draft ? <Button asChild size="icon" variant="ghost" aria-label={t('edit')}><Link href={`/receipt-vouchers/new?edit=${voucher.id}`}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Link></Button> : <Button size="icon" variant="ghost" disabled title={t('draft_action_only')} aria-label={t('edit')}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Button>}
      <Button size="icon" variant="ghost" disabled={busy} onClick={() => duplicate(voucher.id)} aria-label={t('duplicate')}><Copy className="h-4 w-4" strokeWidth={1.7} /></Button>
      <Button size="icon" variant="ghost" disabled={!draft || busy} title={!draft ? t('draft_action_only') : undefined} onClick={() => remove(voucher.id)} aria-label={t('delete')}><Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} /></Button>
      {draft && <Button size="sm" variant="outline" disabled={busy} onClick={() => post(voucher.id)}>{t('post')}</Button>}
    </>;
  }, [acting, duplicate, post, remove, t]);

  const columns = useMemo<ColumnDef<Voucher, unknown>[]>(() => [
    { accessorKey: 'number', header: t('number'), cell: ({ row }) => <Link href={`/receipt-vouchers/${row.original.id}`} className="num font-medium text-primary hover:underline">{row.original.number}</Link> },
    { accessorKey: 'partner_name', header: t('customer'), cell: ({ row }) => row.original.partner_name || '—' },
    { accessorKey: 'method', header: t('method'), cell: ({ row }) => t(row.original.method) },
    { accessorKey: 'payment_date', header: t('date'), cell: ({ row }) => <span className="num text-muted">{row.original.payment_date}</span> },
    { accessorKey: 'amount', header: t('amount'), cell: ({ row }) => <span className="num">{formatRiyal(row.original.amount)}</span> },
    { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={tone[row.original.status] ?? 'muted'}>{t(row.original.status)}</Badge> },
    { id: 'actions', header: t('actions'), cell: ({ row }) => <div className="flex justify-end gap-1">{rowActions(row.original)}</div> },
  ], [rowActions, t]);

  const sortOptions: SortOption[] = [
    { value: '-payment_date', label: t('sort_date_desc') }, { value: 'payment_date', label: t('sort_date_asc') }, { value: 'number', label: t('number') },
    { value: 'partner_name', label: t('customer') }, { value: '-amount', label: t('sort_amount_desc') }, { value: 'amount', label: t('sort_amount_asc') },
  ];
  const headerActions: PageAction[] = [{ key: 'create', label: t('create'), icon: Plus, href: '/receipt-vouchers/new', variant: 'primary' }];
  const page = pagination?.current_page ?? explorer.page ?? 1;
  const lastPage = pagination?.last_page ?? 1;
  const perPage = pagination?.per_page ?? explorer.perPage ?? 25;
  const total = pagination?.total ?? data.length;

  return <div className="space-y-4">
    <PageHeader title={t('title')} description={t('subtitle')} context={<BranchViewToggle value={view} onChange={(next) => { setView(next); setExplorer((current) => ({ ...current, page: 1 })); }} />} actions={headerActions} />
    <ListToolbar
      search={searchInput} searchPlaceholder={`${t('search')} · ${t('number')} · ${t('customer')}`} searchLabel={t('title')} onSearchChange={setSearchInput}
      definitions={definitions} filters={labelledFilters} onFilterChange={updateFilter}
      onRemoveFilter={(key) => setExplorer((current) => ({ ...current, page: 1, filters: removeFilter(current.filters, key) }))}
      onClearFilters={() => setExplorer((current) => ({ ...current, page: 1, filters: [] }))} onOpenAdvanced={() => setAdvancedOpen(true)}
      sort={{ value: explorer.sort ?? '-payment_date', onChange: (value) => setExplorer((current) => ({ ...current, page: 1, sort: value })), options: sortOptions }}
      resultCount={data.length} totalCount={total}
    />
    <DataTable columns={columns} data={data} loading={loading} error={loadError} onRetry={load} retryLabel={tc('retry')} emptyLabel={t('empty')} exportName="receipt-vouchers" showToolbar={false}
      mobileRecord={(voucher) => ({
        title: <Link href={`/receipt-vouchers/${voucher.id}`} className="num text-primary hover:underline">{voucher.number}</Link>, subtitle: voucher.partner_name || '—',
        amountLabel: t('amount'), amount: formatRiyal(voucher.amount), secondary: { label: t('method'), value: t(voucher.method) },
        status: <Badge tone={tone[voucher.status] ?? 'muted'}>{t(voucher.status)}</Badge>, meta: voucher.payment_date, actions: rowActions(voucher),
      })}
    />
    <Pagination page={page} lastPage={lastPage} perPage={perPage} total={total} disabled={loading}
      onPageChange={(next) => setExplorer((current) => ({ ...current, page: next }))}
      onPerPageChange={(next) => setExplorer((current) => ({ ...current, page: 1, perPage: next }))} />
    <AdvancedFilterDialog open={advancedOpen} onClose={() => setAdvancedOpen(false)} definitions={definitions} filters={labelledFilters} onApply={(filters) => setExplorer((current) => ({ ...current, page: 1, filters }))} />
  </div>;
}
