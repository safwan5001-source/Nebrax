'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Building2, Eye, Landmark, MoreHorizontal, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { AdvancedFilterDialog } from '@/components/data-explorer/advanced-filter-dialog';
import { DataTable } from '@/components/data-table';
import { ListToolbar, PageHeader, Pagination, type SortOption } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { type CashBankAccount } from '@/lib/cash-bank';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import { parseExplorerState, removeFilter, replaceFilter, serializeExplorerState } from '@/lib/data-explorer/url-state';
import { formatRiyal } from '@/lib/money';

function filterValue(filter?: ActiveFilter): string {
  if (!filter || Array.isArray(filter.value)) return '';
  return String(filter.value).trim();
}

function isEmptyFilter(filter: ActiveFilter): boolean {
  return Array.isArray(filter.value)
    ? filter.value.every((value) => String(value).trim() === '')
    : String(filter.value).trim() === '';
}

export default function CashAndBankPage() {
  const t = useTranslations('cashBank');
  const tc = useTranslations('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { success, error: toastError } = useToast();
  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? 'name' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [items, setItems] = useState<CashBankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: CashBankAccount[] }>('/cash-bank-accounts')
      .then((response) => setItems(response.data))
      .catch((err) => toastError(err instanceof ApiError ? err.message : t('load_list_failed')))
      .finally(() => setLoading(false));
  }, [t, toastError]);

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
    router.replace(url.toString() ? `/cash-and-bank?${url.toString()}` : '/cash-and-bank', { scroll: false });
  }, [explorer, router]);

  const deactivate = useCallback(async (item: CashBankAccount) => {
    if (!window.confirm(t('confirm_deactivate'))) return;
    setActing(item.id);
    try {
      await api(`/cash-bank-accounts/${item.id}/deactivate`, { method: 'POST' });
      success(t('deactivated'));
      load();
    } catch (err) { toastError(err instanceof ApiError ? err.message : tc('saveFailed')); }
    finally { setActing(null); }
  }, [load, success, t, tc, toastError]);

  const makeMain = useCallback(async (item: CashBankAccount) => {
    setActing(item.id);
    try {
      await api(`/cash-bank-accounts/${item.id}/make-main`, { method: 'POST' });
      success(t('main_updated'));
      load();
    } catch (err) { toastError(err instanceof ApiError ? err.message : tc('saveFailed')); }
    finally { setActing(null); }
  }, [load, success, t, tc, toastError]);

  const remove = useCallback(async (item: CashBankAccount) => {
    if (!window.confirm(t('confirm_delete'))) return;
    setActing(item.id);
    try {
      await api(`/cash-bank-accounts/${item.id}`, { method: 'DELETE' });
      success(t('deleted'));
      load();
    } catch (err) { toastError(err instanceof ApiError ? err.message : tc('saveFailed')); }
    finally { setActing(null); }
  }, [load, success, t, tc, toastError]);

  const definitions = useMemo<FilterDefinition[]>(() => [
    {
      key: 'type',
      label: t('type'),
      kind: 'select',
      quick: true,
      options: [
        { value: 'bank', label: t('bank') },
        { value: 'cash', label: t('cash') },
      ],
    },
    {
      key: 'status',
      label: t('status'),
      kind: 'select',
      quick: true,
      options: [
        { value: 'active', label: t('active') },
        { value: 'inactive', label: t('inactive') },
      ],
    },
    {
      key: 'main',
      label: t('main'),
      kind: 'select',
      options: [{ value: 'main', label: t('main') }],
    },
    { key: 'balance_min', label: `${t('balance')} ≥`, kind: 'money' },
    { key: 'balance_max', label: `${t('balance')} ≤`, kind: 'money' },
  ], [t]);

  const labelledFilters = useMemo(() => explorer.filters.map((filter) => ({
    ...filter,
    label: definitions.find((definition) => definition.key === filter.key)?.label ?? filter.label,
  })), [definitions, explorer.filters]);

  const filtered = useMemo(() => {
    const filters = new Map(explorer.filters.map((filter) => [filter.key, filter]));
    const query = explorer.search.trim().toLocaleLowerCase();
    const type = filterValue(filters.get('type'));
    const status = filterValue(filters.get('status'));
    const main = filterValue(filters.get('main'));
    const balanceMinText = filterValue(filters.get('balance_min'));
    const balanceMaxText = filterValue(filters.get('balance_max'));
    const balanceMin = Number(balanceMinText);
    const balanceMax = Number(balanceMaxText);

    return items.filter((item) => {
      if (query) {
        const haystack = [item.name, item.account_code, item.account_name, item.bank_name, item.account_number, item.type]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (type && item.type !== type) return false;
      if (status === 'active' && !item.is_active) return false;
      if (status === 'inactive' && item.is_active) return false;
      if (main === 'main' && !item.is_main) return false;
      const balance = Number(item.balance);
      if (balanceMinText && Number.isFinite(balanceMin) && balance < balanceMin) return false;
      if (balanceMaxText && Number.isFinite(balanceMax) && balance > balanceMax) return false;
      return true;
    });
  }, [explorer.filters, explorer.search, items]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    const sort = explorer.sort ?? 'name';
    const desc = sort.startsWith('-');
    const key = sort.replace(/^-/, '');
    next.sort((left, right) => {
      let comparison = 0;
      if (key === 'balance') comparison = Number(left.balance) - Number(right.balance);
      else if (key === 'type') comparison = left.type.localeCompare(right.type);
      else if (key === 'account_code') comparison = (left.account_code ?? '').localeCompare(right.account_code ?? '', 'ar', { numeric: true });
      else comparison = left.name.localeCompare(right.name, 'ar');
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

  const renderActions = useCallback((item: CashBankAccount) => {
    const busy = acting === item.id;
    return (
      <div className="flex justify-end gap-1">
        <Button asChild size="icon" variant="ghost" aria-label={t('view')}>
          <Link href={`/cash-and-bank/${item.id}`}><Eye className="h-4 w-4" strokeWidth={1.7} /></Link>
        </Button>
        <Button asChild size="icon" variant="ghost" aria-label={t('edit')}>
          <Link href={`/cash-and-bank/new?edit=${item.id}`}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Link>
        </Button>
        <Dropdown align="end" menuLabel={t('actions')} triggerClassName="h-9 w-9 justify-center rounded border border-border bg-surface text-text hover:bg-primary-soft" trigger={<MoreHorizontal className="h-4 w-4" strokeWidth={1.7} />}>
          <DropdownItem icon={Building2} href={`/cash-and-bank/transfer?source=${item.id}`}>{t('transfer')}</DropdownItem>
          {!item.is_main && item.is_active && <DropdownItem icon={Building2} onClick={() => makeMain(item)}>{t('make_main')}</DropdownItem>}
          {item.is_active && <DropdownItem icon={Building2} onClick={() => deactivate(item)} disabled={busy}>{t('deactivate')}</DropdownItem>}
          <DropdownItem icon={Trash2} onClick={() => remove(item)} disabled={busy} tone="danger">{t('delete')}</DropdownItem>
        </Dropdown>
      </div>
    );
  }, [acting, deactivate, makeMain, remove, t]);

  const columns = useMemo<ColumnDef<CashBankAccount, unknown>[]>(() => [
    { id: 'name', header: t('name'), cell: ({ row }) => {
      const item = row.original; const Icon = item.type === 'bank' ? Landmark : Wallet;
      return <Link href={`/cash-and-bank/${item.id}`} className="flex items-center gap-2 text-primary hover:underline"><Icon className="h-4 w-4 shrink-0" strokeWidth={1.7} /><span className="font-medium">{item.name}</span></Link>;
    } },
    { accessorKey: 'type', header: t('type'), cell: ({ row }) => t(row.original.type) },
    { accessorKey: 'account_code', header: t('ledger_account'), cell: ({ row }) => <span className="num text-muted">{row.original.account_code ?? '—'}</span> },
    { accessorKey: 'balance', header: t('balance'), cell: ({ row }) => <span className="num font-medium">{formatRiyal(row.original.balance)}</span> },
    { id: 'status', header: t('status'), cell: ({ row }) => <div className="flex flex-wrap items-center gap-1"><Badge tone={row.original.is_active ? 'positive' : 'muted'}>{t(row.original.is_active ? 'active' : 'inactive')}</Badge>{row.original.is_main && <Badge tone="warning">{t('main')}</Badge>}</div> },
    { id: 'actions', header: '', cell: ({ row }) => renderActions(row.original) },
  ], [renderActions, t]);

  const sortOptions: SortOption[] = [
    { value: 'name', label: t('name') },
    { value: '-name', label: `${t('name')} ↓` },
    { value: 'type', label: t('type') },
    { value: 'account_code', label: t('ledger_account') },
    { value: '-balance', label: `${t('balance')} ↓` },
    { value: 'balance', label: `${t('balance')} ↑` },
  ];

  const addActions = (
    <Dropdown align="end" menuLabel={t('add')} triggerClassName="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" trigger={<><Plus className="h-4 w-4" strokeWidth={1.8} />{t('add')}</>}>
      <DropdownItem icon={Landmark} href="/cash-and-bank/new?type=bank">{t('add_bank')}</DropdownItem>
      <DropdownItem icon={Wallet} href="/cash-and-bank/new?type=cash">{t('add_cash')}</DropdownItem>
    </Dropdown>
  );

  return <div className="space-y-4">
    <PageHeader title={t('title')} description={t('subtitle')} actionsSlot={addActions} />

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
      sort={{ value: explorer.sort ?? 'name', onChange: (value) => setExplorer((current) => ({ ...current, page: 1, sort: value })), options: sortOptions }}
      resultCount={sorted.length}
      totalCount={items.length}
    />

    <DataTable
      columns={columns}
      data={pageData}
      loading={loading}
      emptyLabel={t('empty')}
      exportName="cash-bank-accounts"
      showToolbar={false}
      mobileRecord={(item) => ({
        title: <Link href={`/cash-and-bank/${item.id}`} className="text-primary hover:underline">{item.name}</Link>,
        subtitle: t(item.type),
        caption: item.account_code ? <span className="num">{item.account_code}</span> : undefined,
        amountLabel: t('balance'),
        amount: formatRiyal(item.balance),
        badge: <div className="flex flex-wrap gap-1"><Badge tone={item.is_active ? 'positive' : 'muted'}>{t(item.is_active ? 'active' : 'inactive')}</Badge>{item.is_main && <Badge tone="warning">{t('main')}</Badge>}</div>,
        actions: renderActions(item),
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
