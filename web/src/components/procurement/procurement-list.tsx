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
import { BranchViewToggle } from '@/components/ui/branch-view-toggle';
import { api } from '@/lib/api';
import { branchViewQuery, type BranchView } from '@/lib/branch-view';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import { parseExplorerState, removeFilter, replaceFilter, serializeExplorerState } from '@/lib/data-explorer/url-state';
import { formatRiyal } from '@/lib/money';
import { PROCUREMENT_ROUTE, statusTone, type ProcurementStatus, type ProcurementType } from '@/lib/procurement';

export interface ProcurementDocument {
  id: string;
  type: ProcurementType;
  number: string;
  partner_id: string | null;
  partner_name?: string | null;
  status: ProcurementStatus;
  doc_date: string;
  due_date: string | null;
  requested_by: string | null;
  total: string;
}

function filterValue(filter?: ActiveFilter): string {
  if (!filter || Array.isArray(filter.value)) return '';
  return String(filter.value).trim();
}

function isEmptyFilter(filter: ActiveFilter): boolean {
  return Array.isArray(filter.value)
    ? filter.value.every((value) => String(value).trim() === '')
    : String(filter.value).trim() === '';
}

/** قائمة مستندات دورة الشراء — مكوّن موحّد للأنواع الأربعة. */
export function ProcurementList({ type }: { type: ProcurementType }) {
  const t = useTranslations('procurement');
  const router = useRouter();
  const searchParams = useSearchParams();
  const route = PROCUREMENT_ROUTE[type];
  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? '-doc_date' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [data, setData] = useState<ProcurementDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<BranchView>('current');

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: ProcurementDocument[] }>(`/procurement?type=${type}${branchViewQuery(view, true)}`)
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, [type, view]);

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
    router.replace(url.toString() ? `${route}?${url.toString()}` : route, { scroll: false });
  }, [explorer, route, router]);

  const supplierOptions = useMemo(() => {
    const suppliers = new Map<string, string>();
    for (const document of data) {
      if (document.partner_id && document.partner_name) suppliers.set(document.partner_id, document.partner_name);
    }
    return Array.from(suppliers.entries())
      .sort(([, left], [, right]) => left.localeCompare(right, 'ar'))
      .map(([value, label]) => ({ value, label }));
  }, [data]);

  const statusOptions = useMemo(() => Array.from(new Set(data.map((document) => document.status)))
    .sort()
    .map((status) => ({ value: status, label: t(`status_${status}`) })), [data, t]);

  const definitions = useMemo<FilterDefinition[]>(() => [
    ...(type === 'request' ? [] : [{
      key: 'partner_id', label: t('supplier'), kind: 'entity' as const, quick: true,
      searchPlaceholder: t('search'), emptyText: t(`${type}.empty`), options: supplierOptions,
    }]),
    { key: 'status', label: t('status'), kind: 'select', quick: true, options: statusOptions },
    { key: 'date_from', label: `${t('date')} ≥`, kind: 'date' },
    { key: 'date_to', label: `${t('date')} ≤`, kind: 'date' },
    { key: 'total_min', label: `${t('total')} ≥`, kind: 'money' },
    { key: 'total_max', label: `${t('total')} ≤`, kind: 'money' },
  ], [statusOptions, supplierOptions, t, type]);

  const labelledFilters = useMemo(() => explorer.filters.map((filter) => ({
    ...filter,
    label: definitions.find((definition) => definition.key === filter.key)?.label ?? filter.label,
  })), [definitions, explorer.filters]);

  const filtered = useMemo(() => {
    const filters = new Map(explorer.filters.map((filter) => [filter.key, filter]));
    const query = explorer.search.trim().toLocaleLowerCase();
    const partnerId = filterValue(filters.get('partner_id'));
    const status = filterValue(filters.get('status'));
    const dateFrom = filterValue(filters.get('date_from'));
    const dateTo = filterValue(filters.get('date_to'));
    const totalMinText = filterValue(filters.get('total_min'));
    const totalMaxText = filterValue(filters.get('total_max'));
    const totalMin = Number(totalMinText);
    const totalMax = Number(totalMaxText);

    return data.filter((document) => {
      const party = type === 'request' ? document.requested_by : document.partner_name;
      if (query) {
        const haystack = [document.number, party, document.status]
          .filter(Boolean).join(' ').toLocaleLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (partnerId && document.partner_id !== partnerId) return false;
      if (status && document.status !== status) return false;
      if (dateFrom && document.doc_date < dateFrom) return false;
      if (dateTo && document.doc_date > dateTo) return false;
      const total = Number(document.total);
      if (totalMinText && Number.isFinite(totalMin) && total < totalMin) return false;
      if (totalMaxText && Number.isFinite(totalMax) && total > totalMax) return false;
      return true;
    });
  }, [data, explorer.filters, explorer.search, type]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    const sort = explorer.sort ?? '-doc_date';
    const desc = sort.startsWith('-');
    const key = sort.replace(/^-/, '');
    next.sort((left, right) => {
      let comparison = 0;
      if (key === 'number') comparison = left.number.localeCompare(right.number, 'ar', { numeric: true });
      else if (key === 'party') {
        const leftParty = (type === 'request' ? left.requested_by : left.partner_name) ?? '';
        const rightParty = (type === 'request' ? right.requested_by : right.partner_name) ?? '';
        comparison = leftParty.localeCompare(rightParty, 'ar');
      } else if (key === 'total') comparison = Number(left.total) - Number(right.total);
      else comparison = left.doc_date.localeCompare(right.doc_date);
      return desc ? -comparison : comparison;
    });
    return next;
  }, [explorer.sort, filtered, type]);

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

  const columns = useMemo<ColumnDef<ProcurementDocument, unknown>[]>(() => [
    {
      accessorKey: 'number',
      header: t('number'),
      cell: ({ row }) => <Link href={`${route}/${row.original.id}`} className="num text-primary hover:underline">{row.original.number}</Link>,
    },
    {
      id: 'party',
      header: type === 'request' ? t('requested_by') : t('supplier'),
      accessorFn: (r) => (type === 'request' ? r.requested_by : r.partner_name) ?? '—',
      cell: ({ row }) => (type === 'request' ? row.original.requested_by : row.original.partner_name) ?? '—',
    },
    { accessorKey: 'doc_date', header: t('date'), cell: ({ row }) => <span className="num text-muted">{row.original.doc_date}</span> },
    { accessorKey: 'total', header: t('total'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.total)}</div> },
    { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={statusTone(row.original.status)}>{t(`status_${row.original.status}`)}</Badge> },
  ], [route, t, type]);

  const sortOptions: SortOption[] = [
    { value: '-doc_date', label: `${t('date')} ↓` },
    { value: 'doc_date', label: `${t('date')} ↑` },
    { value: 'number', label: t('number') },
    { value: 'party', label: type === 'request' ? t('requested_by') : t('supplier') },
    { value: '-total', label: `${t('total')} ↓` },
    { value: 'total', label: `${t('total')} ↑` },
  ];

  const headerActions: PageAction[] = [
    { key: 'create', label: t(`${type}.create`), icon: Plus, href: `${route}/new`, variant: 'primary' },
  ];

  return <div className="space-y-4">
    <PageHeader
      title={t(`${type}.title`)}
      context={<BranchViewToggle value={view} onChange={(next) => { setView(next); setExplorer((current) => ({ ...current, page: 1 })); }} />}
      actions={headerActions}
    />

    <ListToolbar
      search={searchInput}
      searchPlaceholder={t('search')}
      searchLabel={t(`${type}.title`)}
      onSearchChange={setSearchInput}
      definitions={definitions}
      filters={labelledFilters}
      onFilterChange={updateFilter}
      onRemoveFilter={(key) => setExplorer((current) => ({ ...current, page: 1, filters: removeFilter(current.filters, key) }))}
      onClearFilters={() => setExplorer((current) => ({ ...current, page: 1, filters: [] }))}
      onOpenAdvanced={() => setAdvancedOpen(true)}
      sort={{ value: explorer.sort ?? '-doc_date', onChange: (value) => setExplorer((current) => ({ ...current, page: 1, sort: value })), options: sortOptions }}
      resultCount={sorted.length}
      totalCount={data.length}
    />

    <DataTable
      columns={columns}
      data={pageData}
      loading={loading}
      emptyLabel={t(`${type}.empty`)}
      exportName={route.slice(1)}
      showToolbar={false}
      mobileRecord={(document) => ({
        title: <Link href={`${route}/${document.id}`} className="num text-primary hover:underline">{document.number}</Link>,
        subtitle: (type === 'request' ? document.requested_by : document.partner_name) ?? '—',
        amountLabel: t('total'),
        amount: formatRiyal(document.total),
        secondary: { label: t('status'), value: t(`status_${document.status}`) },
        meta: document.doc_date,
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
