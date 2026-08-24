'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Copy, Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import { AdvancedFilterDialog } from '@/components/data-explorer/advanced-filter-dialog';
import { DataExplorerToolbar } from '@/components/data-explorer/data-explorer-toolbar';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { BranchViewToggle } from '@/components/ui/branch-view-toggle';
import { branchViewQuery, type BranchView } from '@/lib/branch-view';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import { parseExplorerState, removeFilter, replaceFilter, serializeExplorerState } from '@/lib/data-explorer/url-state';
import { formatRiyal } from '@/lib/money';

interface Voucher { id: string; number: string; partner_name?: string | null; method: string; payment_date: string; amount: string; status: string }
const tone: Record<string, 'positive' | 'warning' | 'muted'> = { posted: 'positive', draft: 'warning', cancelled: 'muted' };

function filterValue(filter?: ActiveFilter): string {
  if (!filter || Array.isArray(filter.value)) return '';
  return String(filter.value).trim();
}

function isEmptyFilter(filter: ActiveFilter): boolean {
  return Array.isArray(filter.value)
    ? filter.value.every((value) => String(value).trim() === '')
    : String(filter.value).trim() === '';
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
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<BranchView>('current');
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: Voucher[] }>(`/payments?direction=received${branchViewQuery(view, true)}`)
      .then((response) => setData(response.data))
      .catch((err) => toastError(err instanceof ApiError ? err.message : t('load_list_failed')))
      .finally(() => setLoading(false));
  }, [toastError, t, view]);

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
    router.replace(url.toString() ? `/receipt-vouchers?${url.toString()}` : '/receipt-vouchers', { scroll: false });
  }, [explorer, router]);

  const duplicate = useCallback(async (id: string) => {
    setActing(id);
    try {
      const response = await api<{ data: Voucher }>(`/payments/${id}/duplicate`, { method: 'POST' });
      success(t('duplicate_success'));
      router.push(`/receipt-vouchers/new?edit=${response.data.id}`);
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally { setActing(null); }
  }, [router, success, t, tc, toastError]);

  const remove = useCallback(async (id: string) => {
    if (!window.confirm(t('confirm_delete'))) return;
    setActing(id);
    try {
      await api(`/payments/${id}`, { method: 'DELETE' });
      success(t('deleted_success'));
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally { setActing(null); }
  }, [load, success, t, tc, toastError]);

  const post = useCallback(async (id: string) => {
    if (!window.confirm(t('confirm_post'))) return;
    setActing(id);
    try {
      await api(`/payments/${id}/post`, { method: 'POST' });
      success(t('post_success'));
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally { setActing(null); }
  }, [load, success, t, tc, toastError]);

  const methodOptions = useMemo(() => Array.from(new Set(data.map((voucher) => voucher.method).filter(Boolean)))
    .sort()
    .map((method) => ({ value: method, label: t(method) })), [data, t]);

  const customerOptions = useMemo(() => Array.from(new Set(data.map((voucher) => voucher.partner_name?.trim()).filter((name): name is string => Boolean(name))))
    .sort((left, right) => left.localeCompare(right, 'ar'))
    .map((name) => ({ value: name, label: name })), [data]);

  const definitions = useMemo<FilterDefinition[]>(() => [
    {
      key: 'status', label: t('status'), kind: 'select', quick: true,
      options: [
        { value: 'draft', label: t('draft') },
        { value: 'posted', label: t('posted') },
        { value: 'cancelled', label: t('cancelled') },
      ],
    },
    { key: 'method', label: t('method'), kind: 'select', quick: true, options: methodOptions },
    {
      key: 'partner_name', label: t('customer'), kind: 'entity', quick: true,
      searchPlaceholder: t('search'), emptyText: t('empty'), options: customerOptions,
    },
    { key: 'date_from', label: `${t('date')} — من`, kind: 'date' },
    { key: 'date_to', label: `${t('date')} — إلى`, kind: 'date' },
    { key: 'amount_min', label: `${t('amount')} — الحد الأدنى`, kind: 'money' },
    { key: 'amount_max', label: `${t('amount')} — الحد الأعلى`, kind: 'money' },
  ], [customerOptions, methodOptions, t]);

  const labelledFilters = useMemo(() => explorer.filters.map((filter) => ({
    ...filter,
    label: definitions.find((definition) => definition.key === filter.key)?.label ?? filter.label,
  })), [definitions, explorer.filters]);

  const filtered = useMemo(() => {
    const filters = new Map(explorer.filters.map((filter) => [filter.key, filter]));
    const query = explorer.search.trim().toLocaleLowerCase();
    const status = filterValue(filters.get('status'));
    const method = filterValue(filters.get('method'));
    const partner = filterValue(filters.get('partner_name'));
    const dateFrom = filterValue(filters.get('date_from'));
    const dateTo = filterValue(filters.get('date_to'));
    const amountMinText = filterValue(filters.get('amount_min'));
    const amountMaxText = filterValue(filters.get('amount_max'));
    const amountMin = Number(amountMinText);
    const amountMax = Number(amountMaxText);

    return data.filter((voucher) => {
      if (query) {
        const haystack = [voucher.number, voucher.partner_name, voucher.method, voucher.status]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (status && voucher.status !== status) return false;
      if (method && voucher.method !== method) return false;
      if (partner && voucher.partner_name !== partner) return false;
      if (dateFrom && voucher.payment_date < dateFrom) return false;
      if (dateTo && voucher.payment_date > dateTo) return false;
      const amount = Number(voucher.amount);
      if (amountMinText && Number.isFinite(amountMin) && amount < amountMin) return false;
      if (amountMaxText && Number.isFinite(amountMax) && amount > amountMax) return false;
      return true;
    });
  }, [data, explorer.filters, explorer.search]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    const sort = explorer.sort ?? '-payment_date';
    const desc = sort.startsWith('-');
    const key = sort.replace(/^-/, '');
    next.sort((left, right) => {
      let comparison = 0;
      if (key === 'amount') comparison = Number(left.amount) - Number(right.amount);
      else if (key === 'number') comparison = left.number.localeCompare(right.number, 'ar', { numeric: true });
      else if (key === 'partner_name') comparison = (left.partner_name ?? '').localeCompare(right.partner_name ?? '', 'ar');
      else comparison = left.payment_date.localeCompare(right.payment_date);
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

  const columns = useMemo<ColumnDef<Voucher, unknown>[]>(() => [
    { accessorKey: 'number', header: t('number'), cell: ({ row }) => <Link href={`/receipt-vouchers/${row.original.id}`} className="num font-medium text-primary hover:underline">{row.original.number}</Link> },
    { accessorKey: 'partner_name', header: t('customer'), cell: ({ row }) => row.original.partner_name || '—' },
    { accessorKey: 'method', header: t('method'), cell: ({ row }) => t(row.original.method) },
    { accessorKey: 'payment_date', header: t('date'), cell: ({ row }) => <span className="num text-muted">{row.original.payment_date}</span> },
    { accessorKey: 'amount', header: t('amount'), cell: ({ row }) => <span className="num">{formatRiyal(row.original.amount)}</span> },
    { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={tone[row.original.status] ?? 'muted'}>{t(row.original.status)}</Badge> },
    { id: 'actions', header: t('actions'), cell: ({ row }) => {
      const voucher = row.original; const draft = voucher.status === 'draft'; const busy = acting === voucher.id;
      return <div className="flex justify-end gap-1">
        <Link href={`/receipt-vouchers/${voucher.id}`}><Button size="icon" variant="ghost" aria-label={t('view')}><Eye className="h-4 w-4" strokeWidth={1.7} /></Button></Link>
        {draft ? <Link href={`/receipt-vouchers/new?edit=${voucher.id}`}><Button size="icon" variant="ghost" aria-label={t('edit')}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Button></Link> : <Button size="icon" variant="ghost" disabled title={t('draft_action_only')} aria-label={t('edit')}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Button>}
        <Button size="icon" variant="ghost" disabled={busy} onClick={() => duplicate(voucher.id)} aria-label={t('duplicate')}><Copy className="h-4 w-4" strokeWidth={1.7} /></Button>
        <Button size="icon" variant="ghost" disabled={!draft || busy} title={!draft ? t('draft_action_only') : undefined} onClick={() => remove(voucher.id)} aria-label={t('delete')}><Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} /></Button>
        {draft && <Button size="sm" variant="outline" disabled={busy} onClick={() => post(voucher.id)}>{t('post')}</Button>}
      </div>;
    } },
  ], [acting, duplicate, post, remove, t]);

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 text-sm text-muted">{t('subtitle')}</p></div><div className="flex items-center gap-2"><BranchViewToggle value={view} onChange={(next) => { setView(next); setExplorer((current) => ({ ...current, page: 1 })); }} /><Link href="/receipt-vouchers/new"><Button><Plus className="h-4 w-4" strokeWidth={1.8} />{t('create')}</Button></Link></div></div>

    <DataExplorerToolbar
      search={searchInput}
      searchPlaceholder={`${t('search')} · ${t('number')} · ${t('customer')}`}
      onSearchChange={setSearchInput}
      definitions={definitions}
      filters={labelledFilters}
      onFilterChange={updateFilter}
      onRemoveFilter={(key) => setExplorer((current) => ({ ...current, page: 1, filters: removeFilter(current.filters, key) }))}
      onClearFilters={() => setExplorer((current) => ({ ...current, page: 1, filters: [] }))}
      onOpenAdvanced={() => setAdvancedOpen(true)}
      resultCount={sorted.length}
      totalCount={data.length}
    />

    <div className="flex items-center justify-end gap-2">
      <span className="text-xs text-muted">ترتيب حسب</span>
      <Select value={explorer.sort ?? '-payment_date'} onChange={(event) => setExplorer((current) => ({ ...current, page: 1, sort: event.target.value }))} className="h-9 min-w-44 bg-surface text-sm" aria-label="ترتيب سندات القبض">
        <option value="-payment_date">الأحدث أولًا</option>
        <option value="payment_date">الأقدم أولًا</option>
        <option value="number">رقم السند</option>
        <option value="partner_name">العميل</option>
        <option value="-amount">المبلغ: الأعلى</option>
        <option value="amount">المبلغ: الأقل</option>
      </Select>
    </div>

    <DataTable columns={columns} data={pageData} loading={loading} emptyLabel={t('empty')} exportName="receipt-vouchers" showToolbar={false} />

    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted">{sorted.length.toLocaleString('ar-SA')} سند · صفحة {page.toLocaleString('ar-SA')} من {totalPages.toLocaleString('ar-SA')}</p>
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
  </div>;
}
