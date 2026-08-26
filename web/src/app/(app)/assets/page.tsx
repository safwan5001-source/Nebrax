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
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import { parseExplorerState, removeFilter, replaceFilter, serializeExplorerState } from '@/lib/data-explorer/url-state';
import { formatRiyal } from '@/lib/money';

interface Asset {
  id: string;
  number: string;
  name: string;
  account_name?: string | null;
  total: string;
  accumulated_depreciation: string;
  book_value: string;
  status: string;
}

const statusTone: Record<string, 'positive' | 'muted' | 'negative'> = {
  active: 'positive',
  draft: 'muted',
  disposed: 'negative',
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

export default function AssetsPage() {
  const t = useTranslations('assets');
  const tc = useTranslations('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { success, error: toastError } = useToast();
  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? 'number' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [data, setData] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: Asset[] }>('/assets')
      .then((r) => setData(r.data))
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
    router.replace(url.toString() ? `/assets?${url.toString()}` : '/assets', { scroll: false });
  }, [explorer, router]);

  const act = useCallback(
    async (id: string, action: 'post' | 'depreciate') => {
      setBusy(id);
      try {
        await api(`/assets/${id}/${action}`, { method: 'POST' });
        success(action === 'post' ? t('post_success') : t('depreciate_success'));
        load();
      } catch (err) {
        toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
      } finally {
        setBusy(null);
      }
    },
    [load, success, toastError, t, tc],
  );

  const definitions = useMemo<FilterDefinition[]>(() => [
    {
      key: 'status',
      label: t('status'),
      kind: 'select',
      quick: true,
      options: ['draft', 'active', 'disposed'].map((value) => ({ value, label: t(value) })),
    },
    { key: 'cost_min', label: `${t('cost')} ≥`, kind: 'money' },
    { key: 'cost_max', label: `${t('cost')} ≤`, kind: 'money' },
    { key: 'book_value_min', label: `${t('book_value')} ≥`, kind: 'money' },
    { key: 'book_value_max', label: `${t('book_value')} ≤`, kind: 'money' },
  ], [t]);

  const labelledFilters = useMemo(() => explorer.filters.map((filter) => ({
    ...filter,
    label: definitions.find((definition) => definition.key === filter.key)?.label ?? filter.label,
  })), [definitions, explorer.filters]);

  const filtered = useMemo(() => {
    const filters = new Map(explorer.filters.map((filter) => [filter.key, filter]));
    const query = explorer.search.trim().toLocaleLowerCase();
    const status = filterValue(filters.get('status'));
    const costMinText = filterValue(filters.get('cost_min'));
    const costMaxText = filterValue(filters.get('cost_max'));
    const bookMinText = filterValue(filters.get('book_value_min'));
    const bookMaxText = filterValue(filters.get('book_value_max'));
    const costMin = Number(costMinText);
    const costMax = Number(costMaxText);
    const bookMin = Number(bookMinText);
    const bookMax = Number(bookMaxText);

    return data.filter((asset) => {
      if (query) {
        const haystack = [asset.number, asset.name, asset.account_name, asset.status]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (status && asset.status !== status) return false;
      const cost = Number(asset.total);
      const bookValue = Number(asset.book_value);
      if (costMinText && Number.isFinite(costMin) && cost < costMin) return false;
      if (costMaxText && Number.isFinite(costMax) && cost > costMax) return false;
      if (bookMinText && Number.isFinite(bookMin) && bookValue < bookMin) return false;
      if (bookMaxText && Number.isFinite(bookMax) && bookValue > bookMax) return false;
      return true;
    });
  }, [data, explorer.filters, explorer.search]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    const sort = explorer.sort ?? 'number';
    const desc = sort.startsWith('-');
    const key = sort.replace(/^-/, '');
    next.sort((left, right) => {
      let comparison = 0;
      if (key === 'name') comparison = left.name.localeCompare(right.name, 'ar');
      else if (key === 'cost') comparison = Number(left.total) - Number(right.total);
      else if (key === 'book_value') comparison = Number(left.book_value) - Number(right.book_value);
      else if (key === 'status') comparison = left.status.localeCompare(right.status);
      else comparison = left.number.localeCompare(right.number, 'ar', { numeric: true });
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

  const renderAction = useCallback((asset: Asset) => {
    if (asset.status === 'draft') {
      return <Button size="sm" variant="outline" disabled={busy === asset.id} onClick={() => act(asset.id, 'post')}>{t('post')}</Button>;
    }
    if (asset.status === 'active') {
      return <Button size="sm" variant="outline" disabled={busy === asset.id} onClick={() => act(asset.id, 'depreciate')}>{t('depreciate')}</Button>;
    }
    return null;
  }, [act, busy, t]);

  const columns = useMemo<ColumnDef<Asset, unknown>[]>(
    () => [
      { accessorKey: 'number', header: t('number'), cell: ({ row }) => <span className="num">{row.original.number}</span> },
      { accessorKey: 'name', header: t('name') },
      { id: 'account', header: t('account'), accessorFn: (r) => r.account_name ?? '—', cell: ({ row }) => row.original.account_name ?? '—' },
      { accessorKey: 'total', header: t('cost'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.total)}</div> },
      { accessorKey: 'accumulated_depreciation', header: t('accumulated'), cell: ({ row }) => <div className="num text-end text-muted">{formatRiyal(row.original.accumulated_depreciation)}</div> },
      { accessorKey: 'book_value', header: t('book_value'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.book_value)}</div> },
      { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={statusTone[row.original.status] ?? 'muted'}>{t(row.original.status)}</Badge> },
      { id: 'actions', header: '', cell: ({ row }) => <div className="flex justify-end">{renderAction(row.original)}</div> },
    ],
    [renderAction, t],
  );

  const sortOptions: SortOption[] = [
    { value: 'number', label: t('number') },
    { value: '-number', label: `${t('number')} ↓` },
    { value: 'name', label: t('name') },
    { value: '-cost', label: `${t('cost')} ↓` },
    { value: 'cost', label: `${t('cost')} ↑` },
    { value: '-book_value', label: `${t('book_value')} ↓` },
    { value: 'book_value', label: `${t('book_value')} ↑` },
    { value: 'status', label: t('status') },
  ];

  const headerActions: PageAction[] = [
    { key: 'create', label: t('create'), icon: Plus, href: '/assets/new', variant: 'primary' },
  ];

  return (
    <div className="space-y-4">
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
        sort={{ value: explorer.sort ?? 'number', onChange: (value) => setExplorer((current) => ({ ...current, page: 1, sort: value })), options: sortOptions }}
        resultCount={sorted.length}
        totalCount={data.length}
      />

      <DataTable
        columns={columns}
        data={pageData}
        loading={loading}
        emptyLabel={t('empty')}
        exportName="assets"
        showToolbar={false}
        mobileRecord={(asset) => ({
          title: asset.name,
          subtitle: <span className="num">{asset.number}</span>,
          caption: asset.account_name ?? undefined,
          amountLabel: t('book_value'),
          amount: formatRiyal(asset.book_value),
          badge: <Badge tone={statusTone[asset.status] ?? 'muted'}>{t(asset.status)}</Badge>,
          secondary: { label: t('cost'), value: formatRiyal(asset.total) },
          actions: renderAction(asset),
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
