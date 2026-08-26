'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Pencil, SlidersHorizontal } from 'lucide-react';
import { AdvancedFilterDialog } from '@/components/data-explorer/advanced-filter-dialog';
import { DataTable } from '@/components/data-table';
import { ListToolbar, PageHeader, Pagination, type PageAction, type SortOption } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { Branch } from '@/lib/branch';
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

export default function BranchesPage() {
  const t = useTranslations('branches');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? 'name' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [data, setData] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: Branch[] }>('/branches')
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
    router.replace(url.toString() ? `/branches?${url.toString()}` : '/branches', { scroll: false });
  }, [explorer, router]);

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
    {
      key: 'main',
      label: t('main'),
      kind: 'select',
      options: [
        { value: 'main', label: t('main') },
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
    const main = filterValue(explorer.filters.find((filter) => filter.key === 'main'));
    return data.filter((branch) => {
      if (query) {
        const haystack = [branch.name, branch.code, branch.phone, branch.city]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (status === 'active' && !branch.is_active) return false;
      if (status === 'inactive' && branch.is_active) return false;
      if (main === 'main' && !branch.is_main) return false;
      return true;
    });
  }, [data, explorer.filters, explorer.search]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    const sort = explorer.sort ?? 'name';
    const desc = sort.startsWith('-');
    const key = sort.replace(/^-/, '');
    next.sort((left, right) => {
      let comparison = 0;
      if (key === 'code') comparison = left.code.localeCompare(right.code, 'ar', { numeric: true });
      else if (key === 'city') comparison = (left.city ?? '').localeCompare(right.city ?? '', 'ar');
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

  const columns = useMemo<ColumnDef<Branch, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('name'),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Link href={`/branches/${row.original.id}`} className="font-medium text-primary hover:underline">
              {row.original.name}
            </Link>
            {row.original.is_main && <Badge tone="positive">{t('main')}</Badge>}
          </div>
        ),
      },
      { accessorKey: 'code', header: t('code'), cell: ({ row }) => <span className="num text-muted">{row.original.code}</span> },
      { accessorKey: 'phone', header: t('phone'), cell: ({ row }) => <span className="num text-muted">{row.original.phone || '—'}</span> },
      { accessorKey: 'city', header: t('city'), cell: ({ row }) => row.original.city || '—' },
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
          <Button asChild variant="ghost" size="icon" aria-label={t('edit_title')}>
            <Link href={`/branches/${row.original.id}`}>
              <Pencil className="h-4 w-4" strokeWidth={1.7} />
            </Link>
          </Button>
        ),
      },
    ],
    [t],
  );

  const sortOptions: SortOption[] = [
    { value: 'name', label: t('name') },
    { value: '-name', label: `${t('name')} ↓` },
    { value: 'code', label: t('code') },
    { value: 'city', label: t('city') },
  ];

  const headerActions: PageAction[] = [
    { key: 'settings', label: t('settings_title'), icon: SlidersHorizontal, href: '/branches/settings', variant: 'outline' },
    { key: 'create', label: t('add'), icon: Plus, href: '/branches/new', variant: 'primary' },
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
        sort={{ value: explorer.sort ?? 'name', onChange: (value) => setExplorer((current) => ({ ...current, page: 1, sort: value })), options: sortOptions }}
        resultCount={sorted.length}
        totalCount={data.length}
      />

      <DataTable
        columns={columns}
        data={pageData}
        loading={loading}
        emptyLabel={t('empty')}
        exportName="branches"
        showToolbar={false}
        mobileRecord={(branch) => ({
          title: <Link href={`/branches/${branch.id}`} className="text-primary hover:underline">{branch.name}</Link>,
          subtitle: <span className="num">{branch.code}</span>,
          caption: branch.city || undefined,
          badge: <Badge tone={branch.is_active ? 'positive' : 'muted'}>{branch.is_active ? t('active') : t('inactive')}</Badge>,
          secondary: { label: t('phone'), value: branch.phone || '—' },
          meta: branch.is_main ? t('main') : undefined,
          actions: (
            <Button asChild variant="ghost" size="icon" aria-label={t('edit_title')}>
              <Link href={`/branches/${branch.id}`}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Link>
            </Button>
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
    </div>
  );
}
