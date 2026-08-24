'use client';
import { ARABIC_DISPLAY_LOCALE } from '@/lib/formatting';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { AdvancedFilterDialog } from '@/components/data-explorer/advanced-filter-dialog';
import { DataExplorerToolbar } from '@/components/data-explorer/data-explorer-toolbar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { BranchViewToggle, type BranchView } from '@/components/ui/branch-view-toggle';
import { formatRiyal } from '@/lib/money';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import {
  parseExplorerState,
  removeFilter,
  replaceFilter,
  serializeExplorerState,
} from '@/lib/data-explorer/url-state';

interface Purchase {
  id: string;
  number: string;
  partner_id: string;
  classification_id?: string | null;
  purchase_date: string;
  due_date?: string | null;
  total: string;
  remaining?: string;
  status: string;
  payment_status: string;
}
interface Partner {
  id: string;
  name: string;
  phone?: string | null;
  vat_number?: string | null;
}
interface Classification { id: string; name: string; is_active?: boolean }
interface PaginationMeta {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
}
interface PurchaseResponse { data: Purchase[]; meta?: PaginationMeta }

const statusTone: Record<string, 'positive' | 'muted' | 'negative'> = { posted: 'positive', draft: 'muted', cancelled: 'negative' };
const payTone: Record<string, 'positive' | 'warning' | 'muted'> = { paid: 'positive', partial: 'warning', unpaid: 'muted' };

function isEmptyFilter(filter: ActiveFilter): boolean {
  return Array.isArray(filter.value)
    ? filter.value.every((value) => String(value).trim() === '')
    : String(filter.value).trim() === '';
}

function appendMoneyFilter(params: URLSearchParams, key: 'total' | 'remaining', filter?: ActiveFilter) {
  if (!filter || Array.isArray(filter.value)) return;
  const value = String(filter.value);
  if (filter.operator === 'eq') {
    params.set(`${key}_gte`, value);
    params.set(`${key}_lte`, value);
  } else if (filter.operator === 'lte' || filter.operator === 'lt') {
    params.set(`${key}_lte`, value);
  } else {
    params.set(`${key}_gte`, value);
  }
}

export default function PurchasesPage() {
  const t = useTranslations('purchases');
  const ts = useTranslations('status');
  const tc = useTranslations('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { success, error: errorToast } = useToast();

  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? '-purchase_date' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [data, setData] = useState<Purchase[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [classifications, setClassifications] = useState<Classification[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ current_page: 1, last_page: 1, per_page: 25, total: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<BranchView>('current');
  const [toDelete, setToDelete] = useState<Purchase | null>(null);
  const [deleting, setDeleting] = useState(false);

  const partnerNames = useMemo(
    () => Object.fromEntries(partners.map((partner) => [partner.id, partner.name])),
    [partners]
  );

  const definitions = useMemo<FilterDefinition[]>(() => [
    {
      key: 'status', label: t('status'), kind: 'select', quick: true,
      options: [
        { value: 'draft', label: ts('draft') },
        { value: 'posted', label: ts('posted') },
        { value: 'cancelled', label: ts('cancelled') },
      ],
    },
    {
      key: 'payment_status', label: t('payment_status'), kind: 'select', quick: true,
      options: [
        { value: 'unpaid', label: ts('unpaid') },
        { value: 'partial', label: ts('partial') },
        { value: 'paid', label: ts('paid') },
      ],
    },
    {
      key: 'partner_id', label: t('supplier'), kind: 'entity', quick: true,
      searchPlaceholder: 'ابحث باسم المورد، الهاتف أو الرقم التعريفي',
      emptyText: 'لا يوجد مورد مطابق',
      options: partners.map((partner) => ({
        value: partner.id,
        label: partner.name,
        sub: partner.vat_number ?? partner.id,
        hint: partner.phone ?? undefined,
      })),
    },
    {
      key: 'classification_id', label: 'التصنيف', kind: 'entity', quick: true,
      searchPlaceholder: 'ابحث باسم التصنيف',
      emptyText: 'لا يوجد تصنيف مطابق',
      options: classifications.map((classification) => ({ value: classification.id, label: classification.name })),
    },
    { key: 'purchase_date', label: t('date'), kind: 'dateRange' },
    { key: 'due_date', label: 'تاريخ الاستحقاق', kind: 'dateRange' },
    { key: 'total', label: t('total'), kind: 'money', operators: ['gte', 'lte', 'eq'] },
    { key: 'remaining', label: 'المتبقي', kind: 'money', operators: ['gte', 'lte', 'eq'] },
  ], [classifications, partners, t, ts]);

  const labelledFilters = useMemo(
    () => explorer.filters.map((filter) => ({
      ...filter,
      label: definitions.find((definition) => definition.key === filter.key)?.label ?? filter.label,
    })),
    [definitions, explorer.filters]
  );

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
    router.replace(url.toString() ? `/purchases?${url.toString()}` : '/purchases', { scroll: false });
  }, [explorer, router]);

  useEffect(() => {
    Promise.all([
      api<{ data: Partner[] }>('/partners'),
      api<{ data: Classification[] }>('/classifications?scope=purchase_invoice'),
    ]).then(([partnerResponse, classificationResponse]) => {
      setPartners(partnerResponse.data);
      setClassifications(classificationResponse.data.filter((classification) => classification.is_active !== false));
    }).catch(() => undefined);
  }, []);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (view === 'all') params.set('branch', 'all');
    if (explorer.search.trim()) params.set('search', explorer.search.trim());
    params.set('per_page', String(explorer.perPage ?? 25));
    params.set('page', String(explorer.page ?? 1));
    params.set('sort', explorer.sort ?? '-purchase_date');

    const byKey = new Map(explorer.filters.map((filter) => [filter.key, filter]));
    for (const key of ['status', 'payment_status', 'partner_id', 'classification_id'] as const) {
      const filter = byKey.get(key);
      if (filter && !Array.isArray(filter.value) && String(filter.value)) params.set(key, String(filter.value));
    }

    const purchaseDate = byKey.get('purchase_date');
    if (purchaseDate && Array.isArray(purchaseDate.value)) {
      if (purchaseDate.value[0]) params.set('date_from', String(purchaseDate.value[0]));
      if (purchaseDate.value[1]) params.set('date_to', String(purchaseDate.value[1]));
    }
    const dueDate = byKey.get('due_date');
    if (dueDate && Array.isArray(dueDate.value)) {
      if (dueDate.value[0]) params.set('due_from', String(dueDate.value[0]));
      if (dueDate.value[1]) params.set('due_to', String(dueDate.value[1]));
    }
    appendMoneyFilter(params, 'total', byKey.get('total'));
    appendMoneyFilter(params, 'remaining', byKey.get('remaining'));

    setLoading(true);
    setLoadError(null);
    api<PurchaseResponse>(`/purchases?${params.toString()}`)
      .then((response) => {
        setData(response.data);
        setMeta(response.meta ?? {
          current_page: 1,
          last_page: 1,
          per_page: response.data.length || 25,
          total: response.data.length,
        });
      })
      .catch(() => setLoadError('تعذر تحميل فواتير المشتريات.'))
      .finally(() => setLoading(false));
  }, [explorer, view]);

  useEffect(() => load(), [load]);

  function updateFilter(next: ActiveFilter) {
    setExplorer((current) => ({
      ...current,
      page: 1,
      filters: isEmptyFilter(next) ? removeFilter(current.filters, next.key) : replaceFilter(current.filters, next),
    }));
  }

  const columns = useMemo<ColumnDef<Purchase, unknown>[]>(() => [
    {
      accessorKey: 'number', header: t('number'), enableSorting: false,
      cell: ({ row }) => <Link href={`/purchases/${row.original.id}`} className="num text-primary hover:underline">{row.original.number}</Link>,
    },
    {
      id: 'partner', header: t('supplier'), enableSorting: false,
      accessorFn: (row) => partnerNames[row.partner_id] ?? '—',
      cell: ({ row }) => partnerNames[row.original.partner_id] ?? '—',
    },
    {
      accessorKey: 'purchase_date', header: t('date'), enableSorting: false,
      cell: ({ row }) => <span className="num text-muted">{row.original.purchase_date}</span>,
    },
    {
      accessorKey: 'total', header: t('total'), enableSorting: false,
      cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.total)}</div>,
    },
    {
      accessorKey: 'remaining', header: 'المتبقي', enableSorting: false,
      cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.remaining ?? '0.00')}</div>,
    },
    {
      accessorKey: 'status', header: t('status'), enableSorting: false,
      cell: ({ row }) => <Badge tone={statusTone[row.original.status] ?? 'muted'}>{ts(row.original.status)}</Badge>,
    },
    {
      accessorKey: 'payment_status', header: t('payment_status'), enableSorting: false,
      cell: ({ row }) => <Badge tone={payTone[row.original.payment_status] ?? 'muted'}>{ts(row.original.payment_status)}</Badge>,
    },
    {
      id: 'actions', header: '', enableSorting: false,
      cell: ({ row }) => {
        const purchase = row.original;
        const isDraft = purchase.status === 'draft';
        return (
          <div className="flex items-center justify-end gap-0.5">
            <Button asChild variant="ghost" size="icon" aria-label={t('view')}><Link href={`/purchases/${purchase.id}`}>
              <Eye className="h-4 w-4" strokeWidth={1.7} />
            </Link></Button>
            {isDraft ? (
              <Button asChild variant="ghost" size="icon" aria-label={t('edit')} title={t('edit')}>
                <Link href={`/purchases/${purchase.id}/edit`}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Link>
              </Button>
            ) : (
              <Button variant="ghost" size="icon" aria-label={t('edit')} disabled title={t('posted_locked')}>
                <Pencil className="h-4 w-4" strokeWidth={1.7} />
              </Button>
            )}
            <Button variant="ghost" size="icon" aria-label={t('delete')} disabled={!isDraft} title={isDraft ? t('delete') : t('posted_locked')} onClick={() => setToDelete(purchase)}>
              <Trash2 className={`h-4 w-4 ${isDraft ? 'text-negative' : ''}`} strokeWidth={1.7} />
            </Button>
          </div>
        );
      },
    },
  ], [partnerNames, router, t, ts]);

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api(`/purchases/${toDelete.id}`, { method: 'DELETE' });
      success(t('deleted'));
      setToDelete(null);
      load();
    } catch (e) {
      errorToast(e instanceof ApiError ? e.message : tc('saveFailed'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <BranchViewToggle value={view} onChange={(next) => { setView(next); setExplorer((current) => ({ ...current, page: 1 })); }} />
        <Button asChild className="ms-auto"><Link href='/purchases/new'>
          <Plus className="h-4 w-4" strokeWidth={1.8} />
          {t('create')}
        </Link></Button>
      </div>

      <div className="rounded border border-border bg-surface p-3 sm:p-4">
        <DataExplorerToolbar
          search={searchInput}
          onSearchChange={setSearchInput}
          searchPlaceholder="ابحث برقم فاتورة الشراء، رقم فاتورة المورد، اسم المورد، الهاتف أو الرقم التعريفي"
          definitions={definitions}
          filters={labelledFilters}
          onFilterChange={updateFilter}
          onRemoveFilter={(key) => setExplorer((current) => ({ ...current, page: 1, filters: removeFilter(current.filters, key) }))}
          onClearFilters={() => setExplorer((current) => ({ ...current, page: 1, filters: [] }))}
          onOpenAdvanced={() => setAdvancedOpen(true)}
          resultCount={meta.total}
        />

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="text-xs text-muted">ترتيب حسب</span>
          <Select
            value={explorer.sort ?? '-purchase_date'}
            onChange={(event) => setExplorer((current) => ({ ...current, page: 1, sort: event.target.value }))}
            className="h-9 min-w-44 bg-surface text-sm"
            aria-label="ترتيب فواتير المشتريات"
          >
            <option value="-purchase_date">الأحدث أولًا</option>
            <option value="purchase_date">الأقدم أولًا</option>
            <option value="-due_date">الاستحقاق الأبعد</option>
            <option value="due_date">الاستحقاق الأقرب</option>
            <option value="-total">الإجمالي: الأعلى</option>
            <option value="total">الإجمالي: الأقل</option>
            <option value="-remaining">المتبقي: الأعلى</option>
            <option value="remaining">المتبقي: الأقل</option>
            <option value="number">رقم الفاتورة</option>
          </Select>
        </div>
      </div>

      {loadError ? (
        <div className="rounded border border-border bg-surface p-8 text-center">
          <p className="text-sm text-negative">{loadError}</p>
          <Button variant="outline" className="mt-3" onClick={load}>إعادة المحاولة</Button>
        </div>
      ) : (
        <DataTable columns={columns} data={data} loading={loading} emptyLabel={t('empty')} exportName="purchases" showToolbar={false} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">
          صفحة {meta.current_page.toLocaleString(ARABIC_DISPLAY_LOCALE)} من {meta.last_page.toLocaleString(ARABIC_DISPLAY_LOCALE)}
        </p>
        <div className="flex items-center gap-2">
          <Select
            value={String(explorer.perPage ?? 25)}
            onChange={(event) => setExplorer((current) => ({ ...current, page: 1, perPage: Number(event.target.value) }))}
            className="h-9 w-24 bg-surface text-sm"
            aria-label="عدد النتائج في الصفحة"
          >
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </Select>
          <Button variant="outline" size="icon" aria-label="الصفحة السابقة" disabled={loading || meta.current_page <= 1} onClick={() => setExplorer((current) => ({ ...current, page: Math.max(1, (current.page ?? 1) - 1) }))}>
            <ChevronRight className="h-4 w-4" strokeWidth={1.7} />
          </Button>
          <Button variant="outline" size="icon" aria-label="الصفحة التالية" disabled={loading || meta.current_page >= meta.last_page} onClick={() => setExplorer((current) => ({ ...current, page: Math.min(meta.last_page, (current.page ?? 1) + 1) }))}>
            <ChevronLeft className="h-4 w-4" strokeWidth={1.7} />
          </Button>
        </div>
      </div>

      <AdvancedFilterDialog
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        definitions={definitions}
        filters={labelledFilters}
        onApply={(filters) => setExplorer((current) => ({ ...current, page: 1, filters }))}
      />

      <Dialog open={!!toDelete} onClose={() => (deleting ? null : setToDelete(null))} title={t('delete_title')}>
        <p className="text-sm text-text">
          {t('delete_confirm')} <span className="num font-medium">{toDelete?.number}</span>؟
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setToDelete(null)} disabled={deleting}>{t('cancel')}</Button>
          <Button variant="danger" onClick={confirmDelete} disabled={deleting}>{t('delete')}</Button>
        </div>
      </Dialog>
    </div>
  );
}
