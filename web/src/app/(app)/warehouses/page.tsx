'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Pencil, Boxes } from 'lucide-react';
import { AdvancedFilterDialog } from '@/components/data-explorer/advanced-filter-dialog';
import { DataTable } from '@/components/data-table';
import { ListToolbar, PageHeader, Pagination, type PageAction, type SortOption } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { Branch } from '@/lib/branch';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import { parseExplorerState, removeFilter, replaceFilter, serializeExplorerState } from '@/lib/data-explorer/url-state';
import type { Warehouse } from '@/lib/warehouse';

function filterValue(filter?: ActiveFilter): string {
  if (!filter || Array.isArray(filter.value)) return '';
  return String(filter.value).trim();
}

function isEmptyFilter(filter: ActiveFilter): boolean {
  return Array.isArray(filter.value)
    ? filter.value.every((value) => String(value).trim() === '')
    : String(filter.value).trim() === '';
}

export default function WarehousesPage() {
  const t = useTranslations('warehouses');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? 'name' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [data, setData] = useState<Warehouse[]>([]);
  const [branches, setBranches] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api<{ data: Warehouse[] }>('/warehouses'),
      api<{ data: Branch[] }>('/branches'),
    ])
      .then(([warehouses, branchResponse]) => {
        setData(warehouses.data);
        setBranches(Object.fromEntries(branchResponse.data.map((branch) => [branch.id, branch.name])));
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
    router.replace(url.toString() ? `/warehouses?${url.toString()}` : '/warehouses', { scroll: false });
  }, [explorer, router]);

  const branchOptions = useMemo(() => Object.entries(branches)
    .sort(([, left], [, right]) => left.localeCompare(right, 'ar'))
    .map(([value, label]) => ({ value, label })), [branches]);

  const definitions = useMemo<FilterDefinition[]>(() => [
    {
      key: 'branch_id',
      label: t('branch'),
      kind: 'entity',
      quick: true,
      searchPlaceholder: t('search'),
      emptyText: t('central'),
      options: branchOptions,
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
      key: 'default',
      label: t('default'),
      kind: 'select',
      options: [{ value: 'default', label: t('default') }],
    },
  ], [branchOptions, t]);

  const labelledFilters = useMemo(() => explorer.filters.map((filter) => ({
    ...filter,
    label: definitions.find((definition) => definition.key === filter.key)?.label ?? filter.label,
  })), [definitions, explorer.filters]);

  const filtered = useMemo(() => {
    const query = explorer.search.trim().toLocaleLowerCase();
    const branchId = filterValue(explorer.filters.find((filter) => filter.key === 'branch_id'));
    const status = filterValue(explorer.filters.find((filter) => filter.key === 'status'));
    const defaultFilter = filterValue(explorer.filters.find((filter) => filter.key === 'default'));
    return data.filter((warehouse) => {
      if (query) {
        const haystack = [warehouse.name, warehouse.code, warehouse.city, warehouse.branch_id ? branches[warehouse.branch_id] : t('central')]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (branchId && warehouse.branch_id !== branchId) return false;
      if (status === 'active' && !warehouse.is_active) return false;
      if (status === 'inactive' && warehouse.is_active) return false;
      if (defaultFilter === 'default' && !warehouse.is_default) return false;
      return true;
    });
  }, [branches, data, explorer.filters, explorer.search, t]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    const sort = explorer.sort ?? 'name';
    const desc = sort.startsWith('-');
    const key = sort.replace(/^-/, '');
    next.sort((left, right) => {
      let comparison = 0;
      if (key === 'code') comparison = left.code.localeCompare(right.code, 'ar', { numeric: true });
      else if (key === 'branch') comparison = (left.branch_id ? branches[left.branch_id] ?? '' : '').localeCompare(right.branch_id ? branches[right.branch_id] ?? '' : '', 'ar');
      else if (key === 'city') comparison = (left.city ?? '').localeCompare(right.city ?? '', 'ar');
      else comparison = left.name.localeCompare(right.name, 'ar');
      return desc ? -comparison : comparison;
    });
    return next;
  }, [branches, explorer.sort, filtered]);

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

  const renderActions = useCallback((warehouse: Warehouse) => (
    <div className="flex items-center justify-end gap-1">
      <Button asChild variant="ghost" size="icon" aria-label={t('stock')}>
        <Link href={`/warehouses/${warehouse.id}/stock`}><Boxes className="h-4 w-4" strokeWidth={1.7} /></Link>
      </Button>
      <Button asChild variant="ghost" size="icon" aria-label={t('edit_title')}>
        <Link href={`/warehouses/${warehouse.id}`}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Link>
      </Button>
    </div>
  ), [t]);

  const columns = useMemo<ColumnDef<Warehouse, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('name'),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Link href={`/warehouses/${row.original.id}`} className="font-medium text-primary hover:underline">{row.original.name}</Link>
            {row.original.is_default && <Badge tone="positive">{t('default')}</Badge>}
          </div>
        ),
      },
      { accessorKey: 'code', header: t('code'), cell: ({ row }) => <span className="num text-muted">{row.original.code}</span> },
      {
        id: 'branch',
        header: t('branch'),
        accessorFn: (r) => (r.branch_id ? branches[r.branch_id] ?? '—' : ''),
        cell: ({ row }) => (row.original.branch_id ? branches[row.original.branch_id] ?? '—' : <span className="text-muted">{t('central')}</span>),
      },
      { accessorKey: 'city', header: t('city'), cell: ({ row }) => row.original.city || '—' },
      {
        accessorKey: 'is_active',
        header: t('status'),
        cell: ({ row }) => <Badge tone={row.original.is_active ? 'positive' : 'muted'}>{row.original.is_active ? t('active') : t('inactive')}</Badge>,
      },
      { id: 'actions', header: '', cell: ({ row }) => renderActions(row.original) },
    ],
    [branches, renderActions, t],
  );

  const sortOptions: SortOption[] = [
    { value: 'name', label: t('name') },
    { value: '-name', label: `${t('name')} ↓` },
    { value: 'code', label: t('code') },
    { value: 'branch', label: t('branch') },
    { value: 'city', label: t('city') },
  ];

  const headerActions: PageAction[] = [
    { key: 'create', label: t('add'), icon: Plus, href: '/warehouses/new', variant: 'primary' },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('subtitle')} actions={headerActions} />

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
        totalCount={data.length}
      />

      <DataTable
        columns={columns}
        data={pageData}
        loading={loading}
        emptyLabel={t('empty')}
        exportName="warehouses"
        showToolbar={false}
        mobileRecord={(warehouse) => ({
          title: <Link href={`/warehouses/${warehouse.id}`} className="text-primary hover:underline">{warehouse.name}</Link>,
          subtitle: <span className="num">{warehouse.code}</span>,
          caption: warehouse.city || undefined,
          badge: <div className="flex flex-wrap gap-1"><Badge tone={warehouse.is_active ? 'positive' : 'muted'}>{warehouse.is_active ? t('active') : t('inactive')}</Badge>{warehouse.is_default && <Badge tone="positive">{t('default')}</Badge>}</div>,
          secondary: { label: t('branch'), value: warehouse.branch_id ? branches[warehouse.branch_id] ?? '—' : t('central') },
          actions: renderActions(warehouse),
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
