'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { Pencil, Plus } from 'lucide-react';
import { AdvancedFilterDialog } from '@/components/data-explorer/advanced-filter-dialog';
import { DataTable } from '@/components/data-table';
import { ListToolbar, PageHeader, Pagination, type PageAction, type SortOption } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Partner } from '@/components/partners/partner-dialog';
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

function uniqueOptions(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))))
    .sort((left, right) => left.localeCompare(right, 'ar'))
    .map((value) => ({ value, label: value }));
}

export default function PartnersPage() {
  const tp = useTranslations('partners');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? 'name' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api<{ data: Partner[] }>('/partners?type=customer')
      .then((response) => setData(response.data))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : tp('load_error')))
      .finally(() => setLoading(false));
  }, [tp]);

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
    router.replace(url.toString() ? `/partners?${url.toString()}` : '/partners', { scroll: false });
  }, [explorer, router]);

  const cityOptions = useMemo(() => uniqueOptions(data.map((partner) => partner.city)), [data]);
  const definitions = useMemo<FilterDefinition[]>(() => [
    {
      key: 'entity_type', label: tp('entity_type_customer'), kind: 'select', quick: true,
      options: [
        { value: 'commercial', label: tp('commercial') },
        { value: 'individual', label: tp('individual') },
      ],
    },
    { key: 'city', label: tp('city'), kind: 'entity', quick: true, searchPlaceholder: tp('search'), emptyText: tp('empty'), options: cityOptions },
    { key: 'has_phone', label: tp('phone'), kind: 'select', options: [{ value: 'yes', label: tp('present') }, { value: 'no', label: tp('absent') }] },
    { key: 'has_email', label: tp('email'), kind: 'select', options: [{ value: 'yes', label: tp('present') }, { value: 'no', label: tp('absent') }] },
  ], [cityOptions, tp]);

  const labelledFilters = useMemo(() => explorer.filters.map((filter) => ({
    ...filter,
    label: definitions.find((definition) => definition.key === filter.key)?.label ?? filter.label,
  })), [definitions, explorer.filters]);

  const filtered = useMemo(() => {
    const filters = new Map(explorer.filters.map((filter) => [filter.key, filter]));
    const query = explorer.search.trim().toLocaleLowerCase();
    const entityType = filterValue(filters.get('entity_type'));
    const city = filterValue(filters.get('city'));
    const hasPhone = filterValue(filters.get('has_phone'));
    const hasEmail = filterValue(filters.get('has_email'));

    return data.filter((partner) => {
      if (query) {
        const haystack = [partner.name, partner.phone, partner.email, partner.city, partner.id]
          .filter(Boolean).join(' ').toLocaleLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (entityType && (partner.entity_type ?? 'commercial') !== entityType) return false;
      if (city && partner.city !== city) return false;
      if (hasPhone === 'yes' && !partner.phone) return false;
      if (hasPhone === 'no' && partner.phone) return false;
      if (hasEmail === 'yes' && !partner.email) return false;
      if (hasEmail === 'no' && partner.email) return false;
      return true;
    });
  }, [data, explorer.filters, explorer.search]);

  const sortOptions: SortOption[] = [
    { value: 'name', label: tp('sort_name_asc') },
    { value: '-name', label: tp('sort_name_desc') },
    { value: 'city', label: tp('city') },
    { value: 'phone', label: tp('phone') },
  ];

  const sorted = useMemo(() => {
    const next = [...filtered];
    const sort = explorer.sort ?? 'name';
    const desc = sort.startsWith('-');
    const key = sort.replace(/^-/, '');
    next.sort((left, right) => {
      let comparison = 0;
      if (key === 'city') comparison = (left.city ?? '').localeCompare(right.city ?? '', 'ar');
      else if (key === 'phone') comparison = (left.phone ?? '').localeCompare(right.phone ?? '', 'ar', { numeric: true });
      else comparison = left.name.localeCompare(right.name, 'ar', { numeric: true });
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

  // التعديل صفحةٌ كاملة: الحوار السريع يحمل ستة حقول من أصل أربعة وعشرين،
  // فتحريرُ طرفٍ منه كان يخفي الرقم الضريبي والائتمان والعنوان الوطني.
  const rowActions = useCallback((partner: Partner) => (
    <Button asChild variant="ghost" size="icon" aria-label={tp('edit')} title={tp('edit')}>
      <Link href={`/partners/${partner.id}/edit`}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Link>
    </Button>
  ), [tp]);

  const columns = useMemo<ColumnDef<Partner, unknown>[]>(() => [
    {
      accessorKey: 'name',
      header: tp('name'),
      cell: ({ row }) => <Link href={`/partners/${row.original.id}`} className="text-primary hover:underline">{row.original.name}</Link>,
    },
    {
      accessorKey: 'entity_type',
      header: tp('entity_type_customer'),
      cell: ({ row }) => <Badge tone="muted">{tp(row.original.entity_type ?? 'commercial')}</Badge>,
    },
    { accessorKey: 'city', header: tp('city'), cell: ({ row }) => row.original.city ?? '—' },
    { accessorKey: 'phone', header: tp('phone'), cell: ({ row }) => <span className="num text-muted">{row.original.phone ?? '—'}</span> },
    { accessorKey: 'email', header: tp('email'), cell: ({ row }) => <span className="num text-muted">{row.original.email ?? '—'}</span> },
    { id: 'actions', header: '', cell: ({ row }) => rowActions(row.original) },
  ], [rowActions, tp]);

  const headerActions: PageAction[] = [
    { key: 'add', label: tp('add'), icon: Plus, href: '/partners/new', variant: 'primary' },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={tp('title')} actions={headerActions} />

      <ListToolbar
        search={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder={`${tp('search')} · ${tp('name')} · ${tp('phone')} · ${tp('email')}`}
        searchLabel={tp('title')}
        definitions={definitions}
        filters={labelledFilters}
        onFilterChange={updateFilter}
        onRemoveFilter={(key) => setExplorer((current) => ({ ...current, page: 1, filters: removeFilter(current.filters, key) }))}
        onClearFilters={() => setExplorer((current) => ({ ...current, page: 1, filters: [] }))}
        onOpenAdvanced={() => setAdvancedOpen(true)}
        sort={{
          value: explorer.sort ?? 'name',
          onChange: (value) => setExplorer((current) => ({ ...current, page: 1, sort: value })),
          options: sortOptions,
        }}
        resultCount={sorted.length}
        totalCount={data.length}
      />

      <DataTable
        columns={columns}
        data={pageData}
        loading={loading}
        error={loadError}
        onRetry={load}
        emptyLabel={tp('empty')}
        exportName="partners"
        showToolbar={false}
        mobileRecord={(partner) => ({
          title: (
            <Link href={`/partners/${partner.id}`} className="text-primary hover:underline">
              {partner.name}
            </Link>
          ),
          subtitle: partner.phone ?? partner.email ?? partner.id,
          // المدينة سطر عنوان لا رقم مرجعي، فمكانها تحت الهاتف مباشرة لا خانة
          // `meta` (المصمَّمة بخط Mono للتواريخ والمراجع) بجانب شارة النوع.
          caption: partner.city ?? undefined,
          status: <Badge tone="muted">{tp(partner.entity_type ?? 'commercial')}</Badge>,
          actions: rowActions(partner),
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

      <AdvancedFilterDialog open={advancedOpen} onClose={() => setAdvancedOpen(false)} definitions={definitions} filters={labelledFilters} onApply={(filters) => setExplorer((current) => ({ ...current, page: 1, filters }))} />


    </div>
  );
}
