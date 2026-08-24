'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Copy, Eye, Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
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

interface Expense {
  id: string;
  number: string;
  account_name?: string | null;
  category_name?: string | null;
  vendor_name?: string | null;
  expense_date: string;
  payment_method: string;
  total: string;
  status: string;
}

const statusTone: Record<string, 'positive' | 'muted' | 'negative'> = {
  posted: 'positive',
  draft: 'muted',
  cancelled: 'negative',
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

function uniqueOptions(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))))
    .sort((left, right) => left.localeCompare(right, 'ar'))
    .map((value) => ({ value, label: value }));
}

export default function ExpensesPage() {
  const t = useTranslations('expenses');
  const tc = useTranslations('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { success, error: toastError } = useToast();
  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? '-expense_date' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [data, setData] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [view, setView] = useState<BranchView>('current');

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: Expense[] }>(`/expenses${branchViewQuery(view)}`)
      .then((response) => setData(response.data))
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
    router.replace(url.toString() ? `/expenses?${url.toString()}` : '/expenses', { scroll: false });
  }, [explorer, router]);

  const postExpense = useCallback(async (id: string) => {
    setPosting(id);
    try {
      await api(`/expenses/${id}/post`, { method: 'POST' });
      success(t('post_success'));
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setPosting(null);
    }
  }, [load, success, toastError, t, tc]);

  const duplicateExpense = useCallback(async (id: string) => {
    setActing(id);
    try {
      const response = await api<{ data: Expense }>(`/expenses/${id}/duplicate`, { method: 'POST' });
      success(t('duplicate_success'));
      router.push(`/expenses/new?edit=${response.data.id}`);
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setActing(null);
    }
  }, [router, success, t, tc, toastError]);

  const deleteExpense = useCallback(async (id: string) => {
    if (!window.confirm(t('confirm_delete_expense'))) return;
    setActing(id);
    try {
      await api(`/expenses/${id}`, { method: 'DELETE' });
      success(t('deleted_success'));
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setActing(null);
    }
  }, [load, success, t, tc, toastError]);

  const accountOptions = useMemo(() => uniqueOptions(data.map((expense) => expense.account_name)), [data]);
  const categoryOptions = useMemo(() => uniqueOptions(data.map((expense) => expense.category_name)), [data]);
  const vendorOptions = useMemo(() => uniqueOptions(data.map((expense) => expense.vendor_name)), [data]);
  const methodOptions = useMemo(() => Array.from(new Set(data.map((expense) => expense.payment_method).filter(Boolean)))
    .sort()
    .map((method) => ({ value: method, label: t(`method.${method}`) })), [data, t]);

  const definitions = useMemo<FilterDefinition[]>(() => [
    {
      key: 'status', label: t('status'), kind: 'select', quick: true,
      options: [
        { value: 'draft', label: t('draft') },
        { value: 'posted', label: t('posted') },
        { value: 'cancelled', label: t('cancelled') },
      ],
    },
    { key: 'payment_method', label: t('payment_method'), kind: 'select', quick: true, options: methodOptions },
    { key: 'category_name', label: t('category'), kind: 'entity', quick: true, searchPlaceholder: t('search'), emptyText: t('empty'), options: categoryOptions },
    { key: 'vendor_name', label: t('vendor_name'), kind: 'entity', quick: true, searchPlaceholder: t('search'), emptyText: t('empty'), options: vendorOptions },
    { key: 'account_name', label: t('account'), kind: 'entity', searchPlaceholder: t('search'), emptyText: t('empty'), options: accountOptions },
    { key: 'date_from', label: `${t('date')} — من`, kind: 'date' },
    { key: 'date_to', label: `${t('date')} — إلى`, kind: 'date' },
    { key: 'amount_min', label: `${t('total')} — الحد الأدنى`, kind: 'money' },
    { key: 'amount_max', label: `${t('total')} — الحد الأعلى`, kind: 'money' },
  ], [accountOptions, categoryOptions, methodOptions, t, vendorOptions]);

  const labelledFilters = useMemo(() => explorer.filters.map((filter) => ({
    ...filter,
    label: definitions.find((definition) => definition.key === filter.key)?.label ?? filter.label,
  })), [definitions, explorer.filters]);

  const filtered = useMemo(() => {
    const filters = new Map(explorer.filters.map((filter) => [filter.key, filter]));
    const query = explorer.search.trim().toLocaleLowerCase();
    const status = filterValue(filters.get('status'));
    const method = filterValue(filters.get('payment_method'));
    const category = filterValue(filters.get('category_name'));
    const vendor = filterValue(filters.get('vendor_name'));
    const account = filterValue(filters.get('account_name'));
    const dateFrom = filterValue(filters.get('date_from'));
    const dateTo = filterValue(filters.get('date_to'));
    const amountMinText = filterValue(filters.get('amount_min'));
    const amountMaxText = filterValue(filters.get('amount_max'));
    const amountMin = Number(amountMinText);
    const amountMax = Number(amountMaxText);

    return data.filter((expense) => {
      if (query) {
        const haystack = [
          expense.number,
          expense.account_name,
          expense.category_name,
          expense.vendor_name,
          expense.payment_method,
          expense.status,
        ].filter(Boolean).join(' ').toLocaleLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (status && expense.status !== status) return false;
      if (method && expense.payment_method !== method) return false;
      if (category && expense.category_name !== category) return false;
      if (vendor && expense.vendor_name !== vendor) return false;
      if (account && expense.account_name !== account) return false;
      if (dateFrom && expense.expense_date < dateFrom) return false;
      if (dateTo && expense.expense_date > dateTo) return false;
      const total = Number(expense.total);
      if (amountMinText && Number.isFinite(amountMin) && total < amountMin) return false;
      if (amountMaxText && Number.isFinite(amountMax) && total > amountMax) return false;
      return true;
    });
  }, [data, explorer.filters, explorer.search]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    const sort = explorer.sort ?? '-expense_date';
    const desc = sort.startsWith('-');
    const key = sort.replace(/^-/, '');
    next.sort((left, right) => {
      let comparison = 0;
      if (key === 'total') comparison = Number(left.total) - Number(right.total);
      else if (key === 'number') comparison = left.number.localeCompare(right.number, 'ar', { numeric: true });
      else if (key === 'vendor_name') comparison = (left.vendor_name ?? '').localeCompare(right.vendor_name ?? '', 'ar');
      else if (key === 'category_name') comparison = (left.category_name ?? '').localeCompare(right.category_name ?? '', 'ar');
      else comparison = left.expense_date.localeCompare(right.expense_date);
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

  const columns = useMemo<ColumnDef<Expense, unknown>[]>(() => [
    { accessorKey: 'number', header: t('number'), cell: ({ row }) => <Link href={`/expenses/${row.original.id}`} className="num font-medium text-primary hover:underline">{row.original.number}</Link> },
    { id: 'account', header: t('account'), accessorFn: (r) => r.account_name ?? '—', cell: ({ row }) => row.original.account_name ?? '—' },
    { id: 'category', header: t('category'), accessorFn: (r) => r.category_name ?? '—', cell: ({ row }) => row.original.category_name ?? '—' },
    { id: 'vendor', header: t('vendor_name'), accessorFn: (r) => r.vendor_name ?? '—', cell: ({ row }) => row.original.vendor_name ?? '—' },
    { accessorKey: 'expense_date', header: t('date'), cell: ({ row }) => <span className="num text-muted">{row.original.expense_date}</span> },
    { id: 'method', header: t('payment_method'), accessorFn: (r) => r.payment_method, cell: ({ row }) => t(`method.${row.original.payment_method}`) },
    { accessorKey: 'total', header: t('total'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.total)}</div> },
    { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={statusTone[row.original.status] ?? 'muted'}>{t(row.original.status)}</Badge> },
    {
      id: 'actions',
      header: t('actions'),
      cell: ({ row }) => {
        const expense = row.original;
        const isDraft = expense.status === 'draft';
        const busy = acting === expense.id || posting === expense.id;
        return <div className="flex justify-end gap-1">
          <Link href={`/expenses/${expense.id}`}><Button size="icon" variant="ghost" aria-label={t('view')}><Eye className="h-4 w-4" strokeWidth={1.7} /></Button></Link>
          {isDraft ? <Link href={`/expenses/new?edit=${expense.id}`}><Button size="icon" variant="ghost" aria-label={t('edit')}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Button></Link> : <Button size="icon" variant="ghost" disabled title={t('draft_action_only')} aria-label={t('edit')}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Button>}
          <Button size="icon" variant="ghost" disabled={busy} onClick={() => duplicateExpense(expense.id)} aria-label={t('duplicate')}><Copy className="h-4 w-4" strokeWidth={1.7} /></Button>
          <Button size="icon" variant="ghost" disabled={!isDraft || busy} title={!isDraft ? t('draft_action_only') : undefined} onClick={() => deleteExpense(expense.id)} aria-label={t('delete')}><Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} /></Button>
          {isDraft && <Button size="sm" variant="outline" disabled={busy} onClick={() => postExpense(expense.id)}>{t('post')}</Button>}
        </div>;
      },
    },
  ], [acting, deleteExpense, duplicateExpense, postExpense, posting, t]);

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
      <div className="flex flex-wrap items-center gap-2">
        <BranchViewToggle value={view} onChange={(next) => { setView(next); setExplorer((current) => ({ ...current, page: 1 })); }} />
        <Link href="/expenses/categories"><Button variant="outline"><Settings2 className="h-4 w-4" strokeWidth={1.8} />{t('manage_categories')}</Button></Link>
        <Link href="/expenses/new"><Button><Plus className="h-4 w-4" strokeWidth={1.8} />{t('create')}</Button></Link>
      </div>
    </div>

    <DataExplorerToolbar
      search={searchInput}
      searchPlaceholder={`${t('search')} · ${t('number')} · ${t('vendor_name')}`}
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
      <Select value={explorer.sort ?? '-expense_date'} onChange={(event) => setExplorer((current) => ({ ...current, page: 1, sort: event.target.value }))} className="h-9 min-w-44 bg-surface text-sm" aria-label="ترتيب المصروفات">
        <option value="-expense_date">الأحدث أولًا</option>
        <option value="expense_date">الأقدم أولًا</option>
        <option value="number">رقم المصروف</option>
        <option value="vendor_name">المورد</option>
        <option value="category_name">التصنيف</option>
        <option value="-total">المبلغ: الأعلى</option>
        <option value="total">المبلغ: الأقل</option>
      </Select>
    </div>

    <DataTable columns={columns} data={pageData} loading={loading} emptyLabel={t('empty')} exportName="expenses" showToolbar={false} />

    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted">{sorted.length.toLocaleString('ar-SA')} مصروف · صفحة {page.toLocaleString('ar-SA')} من {totalPages.toLocaleString('ar-SA')}</p>
      <div className="flex items-center gap-2">
        <Select value={String(perPage)} onChange={(event) => setExplorer((current) => ({ ...current, page: 1, perPage: Number(event.target.value) }))} className="h-9 w-24 bg-surface text-sm" aria-label="عدد النتائج في الصفحة">
          <option value="25">25</option><option value="50">50</option><option value="100">100</option>
        </Select>
        <Button variant="outline" size="icon" aria-label="الصفحة السابقة" disabled={loading || page <= 1} onClick={() => setExplorer((current) => ({ ...current, page: Math.max(1, page - 1) }))}><ChevronRight className="h-4 w-4" /></Button>
        <Button variant="outline" size="icon" aria-label="الصفحة التالية" disabled={loading || page >= totalPages} onClick={() => setExplorer((current) => ({ ...current, page: Math.min(totalPages, page + 1) }))}><ChevronLeft className="h-4 w-4" /></Button>
      </div>
    </div>

    <AdvancedFilterDialog open={advancedOpen} onClose={() => setAdvancedOpen(false)} definitions={definitions} filters={labelledFilters} onApply={(filters) => setExplorer((current) => ({ ...current, page: 1, filters }))} />
  </div>;
}
