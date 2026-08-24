'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { BookOpen, ChevronLeft, ChevronRight, FileText, Plus, Pencil } from 'lucide-react';
import { AdvancedFilterDialog } from '@/components/data-explorer/advanced-filter-dialog';
import { DataExplorerToolbar } from '@/components/data-explorer/data-explorer-toolbar';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { PartnerDialog, type Partner } from '@/components/partners/partner-dialog';
import { api } from '@/lib/api';
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

/**
 * إدارة الموردين — يعيد استخدام بنية الأطراف بالكامل: الطرف كيان واحد، والمورّد
 * تصفيةٌ بالنوع (`type=supplier`). ملف المورّد وتعديله هما شاشتا الطرف نفسهما.
 */
export default function SuppliersPage() {
  const ts = useTranslations('suppliers');
  const tp = useTranslations('partners');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Partner | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? 'name' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: Partner[] }>('/partners?type=supplier')
      .then((response) => setData(response.data))
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
    router.replace(url.toString() ? `/suppliers?${url.toString()}` : '/suppliers', { scroll: false });
  }, [explorer, router]);

  const cityOptions = useMemo(() => uniqueOptions(data.map((partner) => partner.city)), [data]);
  const definitions = useMemo<FilterDefinition[]>(() => [
    {
      key: 'entity_type', label: tp('entity_type_supplier'), kind: 'select', quick: true,
      options: [
        { value: 'commercial', label: tp('commercial') },
        { value: 'individual', label: tp('individual') },
      ],
    },
    { key: 'city', label: tp('city'), kind: 'entity', quick: true, searchPlaceholder: ts('search'), emptyText: ts('empty'), options: cityOptions },
    { key: 'has_phone', label: tp('phone'), kind: 'select', options: [{ value: 'yes', label: 'يوجد' }, { value: 'no', label: 'غير موجود' }] },
    { key: 'has_email', label: tp('email'), kind: 'select', options: [{ value: 'yes', label: 'يوجد' }, { value: 'no', label: 'غير موجود' }] },
  ], [cityOptions, tp, ts]);

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

  const columns = useMemo<ColumnDef<Partner, unknown>[]>(() => [
    {
      accessorKey: 'name',
      header: tp('name'),
      cell: ({ row }) => <Link href={`/partners/${row.original.id}`} className="text-primary hover:underline">{row.original.name}</Link>,
    },
    {
      accessorKey: 'entity_type',
      header: tp('entity_type_supplier'),
      cell: ({ row }) => <Badge tone="muted">{tp(row.original.entity_type ?? 'commercial')}</Badge>,
    },
    { accessorKey: 'city', header: tp('city'), cell: ({ row }) => row.original.city ?? '—' },
    { accessorKey: 'phone', header: tp('phone'), cell: ({ row }) => <span className="num text-muted">{row.original.phone ?? '—'}</span> },
    { accessorKey: 'email', header: tp('email'), cell: ({ row }) => <span className="num text-muted">{row.original.email ?? '—'}</span> },
    {
      id: 'actions', header: '', cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Link href={`/suppliers/${row.original.id}/statement`} className="inline-flex h-9 w-9 items-center justify-center rounded text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={ts('statement')} title={ts('statement')}>
            <FileText className="h-4 w-4" strokeWidth={1.7} />
          </Link>
          <Link href={`/suppliers/${row.original.id}/ledger`} className="inline-flex h-9 w-9 items-center justify-center rounded text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={ts('ledger')} title={ts('ledger')}>
            <BookOpen className="h-4 w-4" strokeWidth={1.7} />
          </Link>
          <Button variant="ghost" size="icon" aria-label={tp('edit')} onClick={() => { setEditing(row.original); setDialogOpen(true); }}>
            <Pencil className="h-4 w-4" strokeWidth={1.7} />
          </Button>
        </div>
      ),
    },
  ], [tp, ts]);

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold text-text">{ts('title')}</h1>
      <Button onClick={() => { setEditing(null); setDialogOpen(true); }}><Plus className="h-4 w-4" strokeWidth={1.8} />{ts('add')}</Button>
    </div>

    <DataExplorerToolbar
      search={searchInput}
      searchPlaceholder={`${ts('search')} · ${tp('name')} · ${tp('phone')} · ${tp('email')}`}
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
      <Select value={explorer.sort ?? 'name'} onChange={(event) => setExplorer((current) => ({ ...current, page: 1, sort: event.target.value }))} className="h-9 min-w-44 bg-surface text-sm" aria-label="ترتيب الموردين">
        <option value="name">الاسم: أ–ي</option>
        <option value="-name">الاسم: ي–أ</option>
        <option value="city">المدينة</option>
        <option value="phone">الهاتف</option>
      </Select>
    </div>

    <DataTable columns={columns} data={pageData} loading={loading} emptyLabel={ts('empty')} exportName="suppliers" showToolbar={false} />

    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted">{sorted.length.toLocaleString('ar-SA')} مورد · صفحة {page.toLocaleString('ar-SA')} من {totalPages.toLocaleString('ar-SA')}</p>
      <div className="flex items-center gap-2">
        <Select value={String(perPage)} onChange={(event) => setExplorer((current) => ({ ...current, page: 1, perPage: Number(event.target.value) }))} className="h-9 w-24 bg-surface text-sm" aria-label="عدد النتائج في الصفحة">
          <option value="25">25</option><option value="50">50</option><option value="100">100</option>
        </Select>
        <Button variant="outline" size="icon" aria-label="الصفحة السابقة" disabled={loading || page <= 1} onClick={() => setExplorer((current) => ({ ...current, page: Math.max(1, page - 1) }))}><ChevronRight className="h-4 w-4" /></Button>
        <Button variant="outline" size="icon" aria-label="الصفحة التالية" disabled={loading || page >= totalPages} onClick={() => setExplorer((current) => ({ ...current, page: Math.min(totalPages, page + 1) }))}><ChevronLeft className="h-4 w-4" /></Button>
      </div>
    </div>

    <AdvancedFilterDialog open={advancedOpen} onClose={() => setAdvancedOpen(false)} definitions={definitions} filters={labelledFilters} onApply={(filters) => setExplorer((current) => ({ ...current, page: 1, filters }))} />

    <PartnerDialog key={editing?.id ?? 'new'} open={dialogOpen} onClose={() => setDialogOpen(false)} onSaved={load} partner={editing} defaultType="supplier" addTitle={ts('add')} editTitle={ts('edit')} />
  </div>;
}
