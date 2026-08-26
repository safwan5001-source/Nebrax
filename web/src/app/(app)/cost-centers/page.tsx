'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { AdvancedFilterDialog } from '@/components/data-explorer/advanced-filter-dialog';
import { DataTable } from '@/components/data-table';
import { ListToolbar, PageHeader, Pagination, type PageAction, type SortOption } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { CostCenterDialog, type CostCenter } from '@/components/cost-centers/cost-center-dialog';
import { api, ApiError } from '@/lib/api';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import { parseExplorerState, removeFilter, replaceFilter, serializeExplorerState } from '@/lib/data-explorer/url-state';

function filterValue(filter?: ActiveFilter): string {
  if (!filter || Array.isArray(filter.value)) return '';
  return String(filter.value).trim();
}

function isEmptyFilter(filter: ActiveFilter): boolean {
  return Array.isArray(filter.value)
    ? filter.value.every((value) => String(value).trim() === '')
    : String(filter.value).trim() === '';
}

export default function CostCentersPage() {
  const t = useTranslations('costCenters');
  const tc = useTranslations('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { success, error: toastError } = useToast();
  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? 'code' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [data, setData] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<CostCenter | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: CostCenter[] }>('/cost-centers')
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
    router.replace(url.toString() ? `/cost-centers?${url.toString()}` : '/cost-centers', { scroll: false });
  }, [explorer, router]);

  const remove = useCallback(
    async (id: string) => {
      if (!confirm(t('confirm_delete'))) return;
      try {
        await api(`/cost-centers/${id}`, { method: 'DELETE' });
        success(tc('deleted'));
        load();
      } catch (err) {
        toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
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
      options: [
        { value: 'active', label: t('active') },
        { value: 'inactive', label: t('inactive') },
      ],
    },
  ], [t]);

  const labelledFilters = useMemo(() => explorer.filters.map((filter) => ({
    ...filter,
    label: definitions.find((definition) => definition.key === filter.key)?.label ?? filter.label,
  })), [definitions, explorer.filters]);

  const filtered = useMemo(() => {
    const query = explorer.search.trim().toLocaleLowerCase();
    const status = filterValue(explorer.filters.find((filter) => filter.key === 'status'));
    return data.filter((center) => {
      if (query && !`${center.code} ${center.name}`.toLocaleLowerCase().includes(query)) return false;
      if (status === 'active' && !center.is_active) return false;
      if (status === 'inactive' && center.is_active) return false;
      return true;
    });
  }, [data, explorer.filters, explorer.search]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    const sort = explorer.sort ?? 'code';
    const desc = sort.startsWith('-');
    const key = sort.replace(/^-/, '');
    next.sort((left, right) => {
      let comparison = 0;
      if (key === 'name') comparison = left.name.localeCompare(right.name, 'ar');
      else comparison = left.code.localeCompare(right.code, 'ar', { numeric: true });
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

  const columns = useMemo<ColumnDef<CostCenter, unknown>[]>(
    () => [
      { accessorKey: 'code', header: t('code'), cell: ({ row }) => <span className="num">{row.original.code}</span> },
      { accessorKey: 'name', header: t('name') },
      {
        accessorKey: 'is_active',
        header: t('status'),
        cell: ({ row }) => (
          <Badge tone={row.original.is_active ? 'positive' : 'muted'}>
            {row.original.is_active ? t('active') : t('inactive')}
          </Badge>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" aria-label={t('edit')} onClick={() => { setEditing(row.original); setDialog(true); }}>
              <Pencil className="h-4 w-4" strokeWidth={1.7} />
            </Button>
            <Button variant="ghost" size="icon" aria-label={t('delete')} onClick={() => remove(row.original.id)}>
              <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
            </Button>
          </div>
        ),
      },
    ],
    [t, remove],
  );

  const sortOptions: SortOption[] = [
    { value: 'code', label: t('code') },
    { value: '-code', label: `${t('code')} ↓` },
    { value: 'name', label: t('name') },
    { value: '-name', label: `${t('name')} ↓` },
  ];

  const headerActions: PageAction[] = [
    { key: 'create', label: t('add'), icon: Plus, onClick: () => { setEditing(null); setDialog(true); }, variant: 'primary' },
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
        sort={{ value: explorer.sort ?? 'code', onChange: (value) => setExplorer((current) => ({ ...current, page: 1, sort: value })), options: sortOptions }}
        resultCount={sorted.length}
        totalCount={data.length}
      />

      <DataTable
        columns={columns}
        data={pageData}
        loading={loading}
        emptyLabel={t('empty')}
        exportName="cost-centers"
        showToolbar={false}
        mobileRecord={(center) => ({
          title: center.name,
          subtitle: <span className="num">{center.code}</span>,
          badge: <Badge tone={center.is_active ? 'positive' : 'muted'}>{center.is_active ? t('active') : t('inactive')}</Badge>,
          actions: (
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" aria-label={t('edit')} onClick={() => { setEditing(center); setDialog(true); }}>
                <Pencil className="h-4 w-4" strokeWidth={1.7} />
              </Button>
              <Button variant="ghost" size="icon" aria-label={t('delete')} onClick={() => remove(center.id)}>
                <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
              </Button>
            </div>
          ),
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

      {dialog && (
        <CostCenterDialog
          key={editing?.id ?? 'new'}
          open={dialog}
          onClose={() => setDialog(false)}
          onSaved={load}
          center={editing}
        />
      )}
    </div>
  );
}
