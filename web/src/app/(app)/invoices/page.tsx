'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { Eye, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { AdvancedFilterDialog } from '@/components/data-explorer/advanced-filter-dialog';
import { ColumnLayoutMenu } from '@/components/data-explorer/column-layout-menu';
import { InvoicePreviewPanel } from '@/components/invoices/invoice-preview-panel';
import { InvoicesListToolbar } from '@/components/invoices/invoices-list-toolbar';
import { Pagination, type SortOption } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { BranchViewToggle } from '@/components/ui/branch-view-toggle';
import { type BranchView } from '@/lib/branch-view';
import { toCsv, downloadCsv } from '@/lib/export';
import {
  hasActiveInvoiceQuery,
  invoiceColumnHideBelow,
  INVOICE_LIST_SORT_COLUMNS,
  INVOICE_SUPPORTING_COLUMN_DEFAULTS,
  isInvoiceDraft,
  isInvoiceOverdue,
} from '@/lib/invoices/workspace';
import { formatRiyal } from '@/lib/money';
import { normalizeProtectedColumns, useDataTableColumnVisibility } from '@/lib/data-explorer/table-layout';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import {
  parseExplorerState,
  removeFilter,
  replaceFilter,
  serializeExplorerState,
} from '@/lib/data-explorer/url-state';
import { cn } from '@/lib/utils';

interface Invoice {
  id: string;
  number: string;
  partner_id: string;
  invoice_date: string;
  due_date: string | null;
  subtotal?: string;
  tax_amount?: string;
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
  posted: 'muted',
  draft: 'muted',
  cancelled: 'negative',
};
const payTone: Record<string, 'positive' | 'warning' | 'muted'> = {
  paid: 'positive',
  partial: 'warning',
  unpaid: 'muted',
};

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

function columnId(column: ColumnDef<Invoice, unknown>): string {
  if (column.id) return column.id;
  if ('accessorKey' in column && column.accessorKey != null) return String(column.accessorKey);
  return '';
}

function DocumentStatus({
  invoice,
  ts,
  overdueLabel,
}: {
  invoice: Invoice;
  ts: (key: string) => string;
  overdueLabel: string;
}) {
  const overdue = isInvoiceOverdue(invoice);
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge tone={statusTone[invoice.status] ?? 'muted'}>{ts(invoice.status)}</Badge>
      {overdue ? <Badge tone="warning">{overdueLabel}</Badge> : null}
    </div>
  );
}

function MoneyCell({
  value,
  emphasize = false,
  muted = false,
  warning = false,
}: {
  value: string | number | null | undefined;
  emphasize?: boolean;
  muted?: boolean;
  warning?: boolean;
}) {
  return (
    <div
      className={cn(
        'num whitespace-nowrap text-end tabular-nums',
        emphasize && 'font-medium text-text',
        warning && 'text-warning',
        muted && !warning && 'text-muted',
        !emphasize && !muted && !warning && 'text-text',
      )}
    >
      {formatRiyal(value)}
    </div>
  );
}

export default function InvoicesPage() {
  const t = useTranslations('invoices');
  const ts = useTranslations('status');
  const tn = useTranslations('nebrax');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { success, error: errorToast } = useToast();

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
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [view, setView] = useState<BranchView>('current');
  const storedColumnVisibility = useDataTableColumnVisibility('invoices');
  const columnVisibility = useMemo(() => ({
    ...storedColumnVisibility,
    value: { ...INVOICE_SUPPORTING_COLUMN_DEFAULTS, ...storedColumnVisibility.value },
    protectedColumnIds: ['number', 'actions'],
    labels: { actions: t('actions') },
  }), [storedColumnVisibility, t]);

  const partnerNames = useMemo(
    () => Object.fromEntries(partners.map((partner) => [partner.id, partner.name])),
    [partners]
  );
  const previewInvoice = invoices.find((invoice) => invoice.id === previewId) ?? null;
  const filteredQuery = hasActiveInvoiceQuery(explorer.search, explorer.filters);

  const sortOptions = useMemo<SortOption[]>(() => [
    { value: '-invoice_date', label: t('sort_newest') },
    { value: 'invoice_date', label: t('sort_oldest') },
    { value: '-due_date', label: t('sort_due_far') },
    { value: 'due_date', label: t('sort_due_near') },
    { value: '-total', label: t('sort_total_high') },
    { value: 'total', label: t('sort_total_low') },
    { value: '-remaining', label: t('sort_remaining_high') },
    { value: 'remaining', label: t('sort_remaining_low') },
    { value: 'number', label: t('sort_number') },
  ], [t]);

  const definitions = useMemo<FilterDefinition[]>(() => [
    {
      key: 'partner_id', label: t('partner'), kind: 'entity', quick: true,
      searchPlaceholder: t('partner_search'),
      emptyText: t('partner_empty'),
      options: partners.map((partner) => ({
        value: partner.id,
        label: partner.name,
        sub: partner.vat_number ?? partner.id,
        hint: partner.phone ?? undefined,
      })),
    },
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
    { key: 'invoice_date', label: t('date'), kind: 'dateRange' },
    { key: 'due_date', label: t('due_date'), kind: 'dateRange' },
    { key: 'total', label: t('total'), kind: 'money', operators: ['gte', 'lte', 'eq'] },
    { key: 'remaining', label: t('remaining'), kind: 'money', operators: ['gte', 'lte', 'eq'] },
  ], [partners, t, ts]);

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
    api<{ data: Partner[] }>('/partners')
      .then((response) => setPartners(response.data))
      .catch(() => undefined);
  }, []);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (view === 'all') params.set('branch', 'all');
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
  }, [explorer, t, view]);

  useEffect(() => load(), [load]);

  function updateFilter(next: ActiveFilter) {
    setExplorer((current) => ({
      ...current,
      page: 1,
      filters: isEmptyFilter(next) ? removeFilter(current.filters, next.key) : replaceFilter(current.filters, next),
    }));
  }

  function openPreview(invoice: Invoice) {
    setPreviewId(invoice.id);
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api(`/invoices/${toDelete.id}`, { method: 'DELETE' });
      success(t('deleted'));
      if (previewId === toDelete.id) setPreviewId(null);
      setToDelete(null);
      load();
    } catch (e) {
      errorToast(e instanceof ApiError ? e.message : t('delete_failed'));
    } finally {
      setDeleting(false);
    }
  }

  function exportCurrentPage() {
    downloadCsv('invoices', toCsv(
      [t('number'), t('partner'), t('date'), t('due_date'), t('total'), t('remaining'), t('status'), t('payment_status')],
      invoices.map((invoice) => [
        invoice.number,
        partnerNames[invoice.partner_id] ?? '',
        invoice.invoice_date,
        invoice.due_date ?? '',
        invoice.total,
        invoice.remaining,
        ts(invoice.status),
        ts(invoice.payment_status),
      ]),
    ));
  }

  const desktopRowActions = useCallback((invoice: Invoice) => {
    const draft = isInvoiceDraft(invoice.status);
    return (
      <div className="flex items-center justify-end" onClick={(event) => event.stopPropagation()}>
        <Dropdown
          trigger={<MoreHorizontal className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />}
          triggerLabel={t('more_actions')}
          menuLabel={t('actions')}
          triggerClassName="flex h-8 w-8 items-center justify-center rounded text-muted hover:bg-primary-soft hover:text-text"
        >
          <DropdownItem icon={Eye} onClick={() => openPreview(invoice)}>{t('view')}</DropdownItem>
          {draft ? (
            <DropdownItem icon={Pencil} href={`/invoices/${invoice.id}/edit`}>{t('edit')}</DropdownItem>
          ) : (
            <DropdownItem icon={Pencil} disabled title={t('posted_locked')}>{t('edit')}</DropdownItem>
          )}
          <DropdownItem
            icon={Trash2}
            tone="danger"
            disabled={!draft}
            title={draft ? t('delete') : t('posted_locked')}
            onClick={() => setToDelete(invoice)}
          >
            {t('delete')}
          </DropdownItem>
        </Dropdown>
      </div>
    );
  }, [t]);

  const mobileRowActions = useCallback((invoice: Invoice) => {
    const draft = isInvoiceDraft(invoice.status);
    return (
      <div className="flex items-center justify-end gap-0.5" onClick={(event) => event.stopPropagation()}>
        {draft ? (
          <Button asChild variant="ghost" size="icon" aria-label={t('edit')} title={t('edit')}>
            <Link href={`/invoices/${invoice.id}/edit`}><Pencil className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" /></Link>
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="icon" aria-label={t('edit')} disabled title={t('posted_locked')}>
            <Pencil className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('delete')}
          disabled={!draft}
          title={draft ? t('delete') : t('posted_locked')}
          onClick={() => setToDelete(invoice)}
        >
          <Trash2 className={cn('h-4 w-4', draft && 'text-negative')} strokeWidth={1.7} aria-hidden="true" />
        </Button>
      </div>
    );
  }, [t]);

  const columns = useMemo<ColumnDef<Invoice, unknown>[]>(() => [
    {
      accessorKey: 'number', header: t('number'),
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => openPreview(row.original)}
          aria-haspopup="dialog"
          className="num whitespace-nowrap text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          dir="ltr"
        >
          {row.original.number}
        </button>
      ),
    },
    {
      id: 'partner', header: t('partner'), enableSorting: false,
      accessorFn: (row) => partnerNames[row.partner_id] ?? '—',
      cell: ({ row }) => {
        const name = partnerNames[row.original.partner_id] ?? '—';
        return <span className="block max-w-48 truncate" title={name}>{name}</span>;
      },
    },
    {
      accessorKey: 'invoice_date', header: t('date'), meta: { hideBelow: invoiceColumnHideBelow('invoice_date') },
      cell: ({ row }) => <span className="num whitespace-nowrap text-muted" dir="ltr">{row.original.invoice_date}</span>,
    },
    {
      accessorKey: 'due_date', header: t('due_date'), meta: { hideBelow: invoiceColumnHideBelow('due_date') },
      cell: ({ row }) => {
        const overdue = isInvoiceOverdue(row.original);
        return (
          <span className="num whitespace-nowrap text-muted" dir="ltr" title={overdue ? t('overdue') : undefined}>
            {row.original.due_date ?? '—'}
          </span>
        );
      },
    },
    {
      accessorKey: 'status', header: t('status'), enableSorting: false,
      cell: ({ row }) => <DocumentStatus invoice={row.original} ts={ts} overdueLabel={t('overdue')} />,
    },
    {
      accessorKey: 'payment_status', header: t('payment_status'), enableSorting: false, meta: { hideBelow: invoiceColumnHideBelow('payment_status') },
      cell: ({ row }) => <Badge tone={payTone[row.original.payment_status] ?? 'muted'}>{ts(row.original.payment_status)}</Badge>,
    },
    {
      accessorKey: 'total', header: t('total'), meta: { numeric: true },
      cell: ({ row }) => <MoneyCell value={row.original.total} emphasize />,
    },
    {
      accessorKey: 'remaining', header: t('remaining'), meta: { numeric: true },
      cell: ({ row }) => (
        <MoneyCell
          value={row.original.remaining}
          muted
          warning={isInvoiceOverdue(row.original)}
        />
      ),
    },
    {
      accessorKey: 'subtotal', header: t('subtotal'), meta: { numeric: true },
      cell: ({ row }) => <MoneyCell value={row.original.subtotal} muted />,
    },
    {
      accessorKey: 'tax_amount', header: t('tax_amount'), meta: { numeric: true },
      cell: ({ row }) => <MoneyCell value={row.original.tax_amount} muted />,
    },
    {
      accessorKey: 'paid_amount', header: t('paid_amount'), meta: { numeric: true },
      cell: ({ row }) => <MoneyCell value={row.original.paid_amount} muted />,
    },
    {
      id: 'actions', header: () => <span className="sr-only">{t('actions')}</span>, enableSorting: false,
      cell: ({ row }) => desktopRowActions(row.original),
    },
  ], [desktopRowActions, partnerNames, t, ts]);

  const columnMenu = useMemo(() => (
    <ColumnLayoutMenu
      items={columns.map((column) => {
        const id = columnId(column);
        const header = typeof column.header === 'string'
          ? column.header
          : (columnVisibility.labels?.[id] ?? id);
        return {
          id,
          label: header,
          visible: columnVisibility.value[id] !== false,
          canHide: !columnVisibility.protectedColumnIds?.includes(id),
        };
      }).filter((item) => item.id)}
      labels={{
        columns: tn('columns'),
        moveColumn: tn('moveColumn'),
        moveUp: tn('moveUp'),
        moveDown: tn('moveDown'),
      }}
      onReorder={() => {}}
      onVisibilityChange={(id, visible) => {
        columnVisibility.onChange(normalizeProtectedColumns(
          { ...columnVisibility.value, [id]: visible },
          columnVisibility.protectedColumnIds,
        ));
      }}
      allowReorder={false}
    />
  ), [columnVisibility, columns, tn]);

  return (
    <div className={cn('space-y-3', previewId && 'xl:pe-[21.5rem]')}>
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <BranchViewToggle
          value={view}
          onChange={(next) => { setView(next); setExplorer((current) => ({ ...current, page: 1 })); }}
          className="order-last w-full sm:order-none sm:w-auto"
        />
        <Button asChild className="ms-auto">
          <Link href="/invoices/new">
            <Plus className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
            {t('create')}
          </Link>
        </Button>
      </header>

      <div className="overflow-hidden rounded border border-border bg-surface">
        <InvoicesListToolbar
          search={searchInput}
          onSearchChange={setSearchInput}
          searchPlaceholder={t('search_placeholder')}
          searchLabel={t('search')}
          dateLabel={t('date')}
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
          onExport={exportCurrentPage}
          exportDisabled={loading || invoices.length === 0}
          columnMenu={columnMenu}
        />

        <div className="border-t border-border [&>div]:rounded-none [&>div]:border-0 [&_td]:py-1.5 [&_th]:py-1.5">
          <DataTable
            columns={columns}
            data={invoices}
            loading={loading}
            error={error}
            onRetry={load}
            retryLabel={t('retry')}
            emptyLabel={filteredQuery ? t('no_results') : t('empty')}
            emptyDescription={filteredQuery ? t('no_results_hint') : t('empty_hint')}
            emptyAction={
              filteredQuery ? (
                <Button type="button" variant="outline" onClick={() => { setSearchInput(''); setExplorer((current) => ({ ...current, page: 1, search: '', filters: [] })); }}>
                  {t('clear_filters')}
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/invoices/new">{t('create')}</Link>
                </Button>
              )
            }
            exportName="invoices"
            showToolbar={false}
            showColumnMenu={false}
            loadingLabel={t('loading')}
            onRowClick={openPreview}
            isRowActive={(invoice) => invoice.id === previewId}
            serverSort={{
              value: explorer.sort ?? '-invoice_date',
              onChange: (value) => setExplorer((current) => ({ ...current, page: 1, sort: value })),
              columns: [...INVOICE_LIST_SORT_COLUMNS],
            }}
            columnVisibility={columnVisibility}
            stickyHeader
            mobileRecord={(invoice) => ({
              title: (
                <button
                  type="button"
                  onClick={() => openPreview(invoice)}
                  className="num text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  dir="ltr"
                >
                  {invoice.number}
                </button>
              ),
              subtitle: partnerNames[invoice.partner_id] ?? '—',
              amountLabel: t('total'),
              amount: formatRiyal(invoice.total),
              secondary: {
                label: t('remaining'),
                value: (
                  <span className={cn(isInvoiceOverdue(invoice) && 'text-warning')}>
                    {formatRiyal(invoice.remaining)}
                  </span>
                ),
              },
              status: (
                <>
                  <DocumentStatus invoice={invoice} ts={ts} overdueLabel={t('overdue')} />
                  <Badge tone={payTone[invoice.payment_status] ?? 'muted'}>{ts(invoice.payment_status)}</Badge>
                </>
              ),
              meta: invoice.invoice_date,
              actions: mobileRowActions(invoice),
            })}
          />
        </div>
      </div>

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

      {previewId ? (
        <InvoicePreviewPanel
          invoiceId={previewId}
          customerName={previewInvoice ? (partnerNames[previewInvoice.partner_id] ?? '—') : '—'}
          listStatus={previewInvoice?.status}
          onClose={() => setPreviewId(null)}
        />
      ) : null}

      <Dialog open={!!toDelete} onClose={() => (deleting ? null : setToDelete(null))} title={t('delete_title')}>
        <p className="text-sm text-text">{t('delete_confirm')} <span className="num font-medium" dir="ltr">{toDelete?.number}</span>؟</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setToDelete(null)} disabled={deleting}>{t('retry_cancel')}</Button>
          <Button variant="danger" onClick={confirmDelete} disabled={deleting}>{deleting ? t('generating_delete') : t('delete')}</Button>
        </div>
      </Dialog>
    </div>
  );
}
