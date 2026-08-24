'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { AdvancedFilterDialog } from '@/components/data-explorer/advanced-filter-dialog';
import { DataExplorerToolbar } from '@/components/data-explorer/data-explorer-toolbar';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import { BranchViewToggle } from '@/components/ui/branch-view-toggle';
import { branchViewQuery, type BranchView } from '@/lib/branch-view';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import { parseExplorerState, removeFilter, replaceFilter, serializeExplorerState } from '@/lib/data-explorer/url-state';
import { formatRiyal } from '@/lib/money';

interface CreditNote {
  id: string;
  number: string;
  partner_id: string;
  status: string;
  note_date: string;
  total: string;
}
interface Partner { id: string; name: string }

const statusTone: Record<string, 'positive' | 'muted' | 'negative'> = { posted: 'positive', draft: 'muted', cancelled: 'negative' };

function filterValue(filter?: ActiveFilter): string {
  if (!filter || Array.isArray(filter.value)) return '';
  return String(filter.value).trim();
}

function isEmptyFilter(filter: ActiveFilter): boolean {
  return Array.isArray(filter.value)
    ? filter.value.every((value) => String(value).trim() === '')
    : String(filter.value).trim() === '';
}

export default function CreditNotesPage() {
  const t = useTranslations('creditNotes');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<CreditNote[]>([]);
  const [partners, setPartners] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? '-note_date' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);

  // نطاق العرض: الفرع النشط افتراضياً؛ لا يُحفظ فيبدأ كل فتح من الافتراضي.
  const [view, setView] = useState<BranchView>('current');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api<{ data: CreditNote[] }>(`/credit-notes?type=sales${branchViewQuery(view, true)}`),
      api<{ data: Partner[] }>('/partners?type=customer'),
    ])
      .then(([cn, prt]) => {
        setData(cn.data);
        setPartners(Object.fromEntries(prt.data.map((p) => [p.id, p.name])));
      })
      .finally(() => setLoading(false));
  }, [view]);

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
    router.replace(url.toString() ? `/credit-notes?${url.toString()}` : '/credit-notes', { scroll: false });
  }, [explorer, router]);

  const partnerOptions = useMemo(() => Object.entries(partners)
    .sort((left, right) => left[1].localeCompare(right[1], 'ar'))
    .map(([value, label]) => ({ value, label })), [partners]);

  const definitions = useMemo<FilterDefinition[]>(() => [
    {
      key: 'status',
      label: t('status'),
      kind: 'select',
      quick: true,
      options: [
        { value: 'draft', label: t('draft') },
        { value: 'posted', label: t('posted') },
        { value: 'cancelled', label: t('cancelled') },
      ],
    },
    {
      key: 'partner_id',
      label: t('partner'),
      kind: 'entity',
      quick: true,
      searchPlaceholder: t('search'),
      emptyText: t('empty'),
      options: partnerOptions,
    },
    { key: 'date_from', label: `${t('date')} — من`, kind: 'date' },
    { key: 'date_to', label: `${t('date')} — إلى`, kind: 'date' },
    { key: 'amount_min', label: `${t('total')} — الحد الأدنى`, kind: 'money' },
    { key: 'amount_max', label: `${t('total')} — الحد الأعلى`, kind: 'money' },
  ], [partnerOptions, t]);

  const labelledFilters = useMemo(() => explorer.filters.map((filter) => ({
    ...filter,
    label: definitions.find((definition) => definition.key === filter.key)?.label ?? filter.label,
  })), [definitions, explorer.filters]);

  const filtered = useMemo(() => {
    const filters = new Map(explorer.filters.map((filter) => [filter.key, filter]));
    const query = explorer.search.trim().toLocaleLowerCase();
    const status = filterValue(filters.get('status'));
    const partnerId = filterValue(filters.get('partner_id'));
    const dateFrom = filterValue(filters.get('date_from'));
    const dateTo = filterValue(filters.get('date_to'));
    const amountMinValue = filterValue(filters.get('amount_min'));
    const amountMaxValue = filterValue(filters.get('amount_max'));
    const amountMin = Number(amountMinValue);
    const amountMax = Number(amountMaxValue);

    return data.filter((note) => {
      if (query) {
        const haystack = [note.number, partners[note.partner_id], note.status, note.note_date]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (status && note.status !== status) return false;
      if (partnerId && note.partner_id !== partnerId) return false;
      if (dateFrom && note.note_date < dateFrom) return false;
      if (dateTo && note.note_date > dateTo) return false;

      const total = Number(note.total);
      if (amountMinValue && Number.isFinite(amountMin) && total < amountMin) return false;
      if (amountMaxValue && Number.isFinite(amountMax) && total > amountMax) return false;
      return true;
    });
  }, [data, explorer.filters, explorer.search, partners]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    const sort = explorer.sort ?? '-note_date';
    const desc = sort.startsWith('-');
    const key = sort.replace(/^-/, '');
    next.sort((left, right) => {
      let comparison = 0;
      if (key === 'number') comparison = left.number.localeCompare(right.number, 'ar', { numeric: true });
      else if (key === 'partner') comparison = (partners[left.partner_id] ?? '').localeCompare(partners[right.partner_id] ?? '', 'ar');
      else if (key === 'total') comparison = Number(left.total) - Number(right.total);
      else if (key === 'status') comparison = left.status.localeCompare(right.status, 'ar');
      else comparison = left.note_date.localeCompare(right.note_date);
      return desc ? -comparison : comparison;
    });
    return next;
  }, [explorer.sort, filtered, partners]);

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

  const columns = useMemo<ColumnDef<CreditNote, unknown>[]>(
    () => [
      {
        accessorKey: 'number',
        header: t('number'),
        cell: ({ row }) => (
          <Link href={`/credit-notes/${row.original.id}`} className="num text-primary hover:underline">
            {row.original.number}
          </Link>
        ),
      },
      {
        id: 'partner',
        header: t('partner'),
        accessorFn: (r) => partners[r.partner_id] ?? '—',
        cell: ({ row }) => partners[row.original.partner_id] ?? '—',
      },
      { accessorKey: 'note_date', header: t('date'), cell: ({ row }) => <span className="num text-muted">{row.original.note_date}</span> },
      { accessorKey: 'total', header: t('total'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.total)}</div> },
      { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={statusTone[row.original.status] ?? 'muted'}>{t(row.original.status)}</Badge> },
    ],
    [partners, t]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <BranchViewToggle value={view} onChange={(next) => { setView(next); setExplorer((current) => ({ ...current, page: 1 })); }} />
          <Button asChild>
            <Link href="/credit-notes/new">
              <Plus className="h-4 w-4" strokeWidth={1.8} />
              {t('create')}
            </Link>
          </Button>
        </div>
      </div>

      <DataExplorerToolbar
        search={searchInput}
        searchPlaceholder={`${t('search')} · ${t('number')} · ${t('partner')}`}
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
        <Select value={explorer.sort ?? '-note_date'} onChange={(event) => setExplorer((current) => ({ ...current, page: 1, sort: event.target.value }))} className="h-9 min-w-44 bg-surface text-sm" aria-label="ترتيب الإشعارات الدائنة">
          <option value="-note_date">الأحدث أولًا</option>
          <option value="note_date">الأقدم أولًا</option>
          <option value="number">الرقم</option>
          <option value="partner">العميل</option>
          <option value="-total">الإجمالي: الأعلى</option>
          <option value="total">الإجمالي: الأقل</option>
          <option value="status">الحالة</option>
        </Select>
      </div>

      <DataTable columns={columns} data={pageData} loading={loading} emptyLabel={t('empty')} exportName="credit-notes" showToolbar={false} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">{sorted.length.toLocaleString('ar-SA')} · صفحة {page.toLocaleString('ar-SA')} من {totalPages.toLocaleString('ar-SA')}</p>
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
    </div>
  );
}
