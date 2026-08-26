'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { AdvancedFilterDialog } from '@/components/data-explorer/advanced-filter-dialog';
import { ListToolbar, PageHeader, Pagination, type PageAction, type SortOption } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { useBranches } from '@/lib/branch';
import { appendBranchFilter, branchFilterDefinition } from '@/lib/branch-filter';
import { fetchBranchScopedLookup } from '@/lib/branch-scoped-lookup';
import { formatRiyal } from '@/lib/money';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import {
  parseExplorerState,
  removeFilter,
  replaceFilter,
  serializeExplorerState,
} from '@/lib/data-explorer/url-state';

interface Invoice {
  id: string;
  number: string;
  partner_id: string;
  invoice_date: string;
  due_date: string | null;
  total: string;
  paid_amount: string;
  remaining: string;
  status: string;
  payment_status: string;
}
interface Partner {
  id: string;
  name: string;
  phone?: string | null;
  vat_number?: string | null;
}
interface PaginationMeta {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
}
interface InvoiceResponse { data: Invoice[]; meta?: PaginationMeta }

const statusTone: Record<string, 'positive' | 'muted' | 'negative'> = {
  posted: 'positive',
  draft: 'muted',
  cancelled: 'negative',
};
const payTone: Record<string, 'positive' | 'warning' | 'muted'> = {
  paid: 'positive',
  partial: 'warning',
  unpaid: 'muted',
};

const sortOptions: SortOption[] = [
  { value: '-invoice_date', label: 'الأحدث أولًا' },
  { value: 'invoice_date', label: 'الأقدم أولًا' },
  { value: '-due_date', label: 'الاستحقاق الأبعد' },
  { value: 'due_date', label: 'الاستحقاق الأقرب' },
  { value: '-total', label: 'الإجمالي: الأعلى' },
  { value: 'total', label: 'الإجمالي: الأقل' },
  { value: '-remaining', label: 'المتبقي: الأعلى' },
  { value: 'remaining', label: 'المتبقي: الأقل' },
  { value: 'number', label: 'رقم الفاتورة' },
];

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

export default function InvoicesPage() {
  const t = useTranslations('invoices');
  const ts = useTranslations('status');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { success, error: errorToast } = useToast();
  const { branches, active } = useBranches();

  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? '-invoice_date' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ current_page: 1, last_page: 1, per_page: 25, total: 0 });
  const [partners, setPartners] = useState<Partner[]>([]);
  const [toDelete, setToDelete] = useState<Invoice | null>(null);
  const [deleting, setDeleting] = useState(false);

  const partnerNames = useMemo(
    () => Object.fromEntries(partners.map((partner) => [partner.id, partner.name])),
    [partners]
  );

  const definitions = useMemo<FilterDefinition[]>(() => [
    branchFilterDefinition(branches, active?.name),
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
      key: 'partner_id', label: t('partner'), kind: 'entity', quick: true,
      searchPlaceholder: 'ابحث بالاسم، الهاتف أو الرقم التعريفي',
      emptyText: 'لا يوجد عميل مطابق',
      options: partners.map((partner) => ({
        value: partner.id,
        label: partner.name,
        sub: partner.vat_number ?? partner.id,
        hint: partner.phone ?? undefined,
      })),
    },
    { key: 'invoice_date', label: t('date'), kind: 'dateRange' },
    { key: 'due_date', label: 'تاريخ الاستحقاق', kind: 'dateRange' },
    { key: 'total', label: t('total'), kind: 'money', operators: ['gte', 'lte', 'eq'] },
    { key: 'remaining', label: 'المتبقي', kind: 'money', operators: ['gte', 'lte', 'eq'] },
  ], [active?.name, branches, partners, t, ts]);

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
    router.replace(url.toString() ? `/invoices?${url.toString()}` : '/invoices', { scroll: false });
  }, [explorer, router]);

  useEffect(() => {
    fetchBranchScopedLookup<Partner>('/partners?type=customer', explorer.filters, branches)
      .then(setPartners)
      .catch(() => setPartners([]));
  }, [branches, explorer.filters]);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    appendBranchFilter(params, explorer.filters);
    if (explorer.search.trim()) params.set('search', explorer.search.trim());
    params.set('per_page', String(explorer.perPage ?? 25));
    params.set('page', String(explorer.page ?? 1));
    params.set('sort', explorer.sort ?? '-invoice_date');

    const byKey = new Map(explorer.filters.map((filter) => [filter.key, filter]));
    for (const key of ['status', 'payment_status', 'partner_id'] as const) {
      const filter = byKey.get(key);
      if (filter && !Array.isArray(filter.value) && String(filter.value)) params.set(key, String(filter.value));
    }

    const invoiceDate = byKey.get('invoice_date');
    if (invoiceDate && Array.isArray(invoiceDate.value)) {
      if (invoiceDate.value[0]) params.set('date_from', String(invoiceDate.value[0]));
      if (invoiceDate.value[1]) params.set('date_to', String(invoiceDate.value[1]));
    }
    const dueDate = byKey.get('due_date');
    if (dueDate && Array.isArray(dueDate.value)) {
      if (dueDate.value[0]) params.set('due_from', String(dueDate.value[0]));
      if (dueDate.value[1]) params.set('due_to', String(dueDate.value[1]));
    }
    appendMoneyFilter(params, 'total', byKey.get('total'));
    appendMoneyFilter(params, 'remaining', byKey.get('remaining'));

    setLoading(true);
    setError(null);
    api<InvoiceResponse>(`/invoices?${params.toString()}`)
      .then((response) => {
        setInvoices(response.data);
        setMeta(response.meta ?? {
          current_page: 1,
          last_page: 1,
          per_page: response.data.length || 25,
          total: response.data.length,
        });
      })
      .catch(() => setError(t('load_error')))
      .finally(() => setLoading(false));
  }, [explorer, t]);

  useEffect(() => load(), [load]);

  function updateFilter(next: ActiveFilter) {
    setExplorer((current) => ({
      ...current,
      page: 1,
      filters: isEmptyFilter(next) ? removeFilter(current.filters, next.key) : replaceFilter(current.filters, next),
    }));
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api(`/invoices/${toDelete.id}`, { method: 'DELETE' });
      success(t('deleted'));
      setToDelete(null);
      load();
    } catch (e) {
      errorToast(e instanceof ApiError ? e.message : t('delete_failed'));
    } finally {
      setDeleting(false);
    }
  }

  const rowActions = useCallback((invoice: Invoice) => {
    const isDraft = invoice.status === 'draft';
    return (
      <>
        <Button asChild variant="ghost" size="icon" aria-label={t('view')}>
          <Link href={`/invoices/${invoice.id}`}><Eye className="h-4 w-4" strokeWidth={1.7} /></Link>
        </Button>
        {isDraft ? (
          <Button asChild variant="ghost" size="icon" aria-label={t('edit')} title={t('edit')}>
            <Link href={`/invoices/${invoice.id}/edit`}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Link>
          </Button>
        ) : (
          <Button variant="ghost" size="icon" aria-label={t('edit')} disabled title={t('posted_locked')}>
            <Pencil className="h-4 w-4" strokeWidth={1.7} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('delete')}
          disabled={!isDraft}
          title={isDraft ? t('delete') : t('posted_locked')}
          onClick={() => setToDelete(invoice)}
        >
          <Trash2 className={`h-4 w-4 ${isDraft ? 'text-negative' : ''}`} strokeWidth={1.7} />
        </Button>
      </>
    );
  }, [t]);

  const columns = useMemo<ColumnDef<Invoice, unknown>[]>(() => [
    {
      accessorKey: 'number', header: t('number'), enableSorting: false,
      cell: ({ row }) => <Link href={`/invoices/${row.original.id}`} className="num whitespace-nowrap text-primary hover:underline">{row.original.number}</Link>,
    },
    {
      id: 'partner', header: t('partner'), enableSorting: false,
      accessorFn: (row) => partnerNames[row.partner_id] ?? '—',
      cell: ({ row }) => {
        const name = partnerNames[row.original.partner_id] ?? '—';
        return <span className="block max-w-64 truncate" title={name}>{name}</span>;
      },
    },
    {
      accessorKey: 'invoice_date', header: t('date'), enableSorting: false,
      cell: ({ row }) => <span className="num whitespace-nowrap text-muted">{row.original.invoice_date}</span>,
    },
    {
      accessorKey: 'total', header: t('total'), enableSorting: false,
      cell: ({ row }) => <div className="num whitespace-nowrap text-end">{formatRiyal(row.original.total)}</div>,
    },
    {
      accessorKey: 'remaining', header: 'المتبقي', enableSorting: false,
      cell: ({ row }) => <div className="num whitespace-nowrap text-end">{formatRiyal(row.original.remaining)}</div>,
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
      cell: ({ row }) => <div className="flex items-center justify-end gap-0.5">{rowActions(row.original)}</div>,
    },
  ], [partnerNames, rowActions, t, ts]);

  const headerActions: PageAction[] = [
    { key: 'create', label: t('create'), icon: Plus, href: '/invoices/new', variant: 'primary' },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} actions={headerActions} />

      <ListToolbar
        search={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder="ابحث برقم الفاتورة، العميل أو مرجع الدفع"
        searchLabel={t('title')}
        definitions={definitions}
        filters={labelledFilters}
        onFilterChange={updateFilter}
        onRemoveFilter={(key) => setExplorer((current) => ({ ...current, page: 1, filters: removeFilter(current.filters, key) }))}
        onClearFilters={() => setExplorer((current) => ({ ...current, page: 1, filters: [] }))}
        onOpenAdvanced={() => setAdvancedOpen(true)}
        sort={{
          value: explorer.sort ?? '-invoice_date',
          onChange: (value) => setExplorer((current) => ({ ...current, page: 1, sort: value })),
          options: sortOptions,
        }}
        resultCount={meta.total}
      />

      <DataTable
        columns={columns}
        data={invoices}
        loading={loading}
        error={error}
        onRetry={load}
        retryLabel={t('retry')}
        emptyLabel={t('empty')}
        exportName="invoices"
        showToolbar={false}
        mobileRecord={(invoice) => ({
          title: (
            <Link href={`/invoices/${invoice.id}`} className="num text-primary hover:underline">
              {invoice.number}
            </Link>
          ),
          subtitle: partnerNames[invoice.partner_id] ?? '—',
          amountLabel: t('total'),
          amount: formatRiyal(invoice.total),
          secondary: { label: 'المتبقي', value: formatRiyal(invoice.remaining) },
          status: (
            <>
              <Badge tone={statusTone[invoice.status] ?? 'muted'}>{ts(invoice.status)}</Badge>
              <Badge tone={payTone[invoice.payment_status] ?? 'muted'}>{ts(invoice.payment_status)}</Badge>
            </>
          ),
          meta: invoice.invoice_date,
          actions: rowActions(invoice),
        })}
      />

      <Pagination
        page={meta.current_page}
        lastPage={meta.last_page}
        perPage={explorer.perPage ?? 25}
        total={meta.total}
        disabled={loading}
        onPageChange={(page) => setExplorer((current) => ({ ...current, page }))}
        onPerPageChange={(perPage) => setExplorer((current) => ({ ...current, page: 1, perPage }))}
      />

      <AdvancedFilterDialog
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        definitions={definitions}
        filters={labelledFilters}
        onApply={(filters) => setExplorer((current) => ({ ...current, page: 1, filters }))}
      />

      <Dialog open={!!toDelete} onClose={() => (deleting ? null : setToDelete(null))} title={t('delete_title')}>
        <p className="text-sm text-text">{t('delete_confirm')} <span className="num font-medium">{toDelete?.number}</span>؟</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setToDelete(null)} disabled={deleting}>{t('retry_cancel')}</Button>
          <Button variant="danger" onClick={confirmDelete} disabled={deleting}>{deleting ? t('generating_delete') : t('delete')}</Button>
        </div>
      </Dialog>
    </div>
  );
}
