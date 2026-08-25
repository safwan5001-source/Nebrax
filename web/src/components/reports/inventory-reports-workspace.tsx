'use client';
import { displayLocale } from '@/lib/formatting';

/**
 * تقارير المخزون: لقطة قيمة عالمية، كميات مخازن، سجل حركات، أذون وجرد مرحّل.
 * لا تخلط قيمة المنتج العالمية بكميات المخزن ولا تعرض المسودات كعمليات مكتملة.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Download, FileText, Printer, Share2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ReportDocument, type ReportColumn } from '@/components/reports/report-document';
import { InventoryReportFilters, EMPTY_INVENTORY_REPORT_FILTERS, type InventoryReportFilterState } from '@/components/reports/inventory-report-filters';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { toCsv, downloadCsv } from '@/lib/export';
import { useCompany } from '@/lib/company';
import { useToast } from '@/components/ui/toast';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import { printDocument } from '@/modules/documents/services/export';
import { createReportPdf, downloadReportPdf, shareReportPdf } from '@/modules/reports/services/report-pdf';
import { ReportMetricGrid, ReportScreenHeader } from '@/components/reports/report-workspace-ui';
import { ReportResultsTable } from '@/components/reports/report-results-table';

export type InventoryReportView = 'value' | 'warehouses' | 'movements' | 'operations' | 'stocktakes';
type Money = string;

interface InventoryRow {
  key: string;
  sku?: string | null;
  label?: string | null;
  unit?: string | null;
  quantity?: number;
  reorder_level?: number | null;
  avg_cost?: Money;
  stock_value?: Money;
  warehouse_id?: string;
  warehouse?: string | null;
  target_warehouse?: string | null;
  branch?: string | null;
  target_branch?: string | null;
  date?: string | null;
  type?: string;
  unit_cost?: Money;
  total_cost?: Money;
  balance_quantity?: number;
  notes?: string | null;
  number?: string;
  lines?: number;
  counted_lines?: number;
  quantity_difference?: number;
  difference_value?: Money;
}
interface InventoryTotals {
  products?: number;
  items?: number;
  warehouses?: number;
  quantity?: number;
  stock_value?: Money;
  movements?: number;
  in_quantity?: number;
  out_quantity?: number;
  in_cost?: Money;
  out_cost?: Money;
  operations?: number;
  lines?: number;
  total_cost?: Money;
  stocktakes?: number;
  counted_lines?: number;
  quantity_difference?: number;
  difference_value?: Money;
}
interface InventoryReportResponse {
  view: InventoryReportView;
  data: InventoryRow[];
  totals: InventoryTotals;
  scope: { source: string; snapshot: boolean };
}
interface ReportDoc {
  title: string;
  columns: ReportColumn[];
  rows: string[][];
  totalRow: string[];
  exportName: string;
}

function filtersToQuery(view: InventoryReportView, filters: InventoryReportFilterState): string {
  const params = new URLSearchParams({ view });
  const historical = view === 'movements' || view === 'operations' || view === 'stocktakes';
  if (historical && filters.from) params.set('from', filters.from);
  if (historical && filters.to) params.set('to', filters.to);
  if (view !== 'value') filters.branchIds.forEach((id) => params.append('branch_id[]', id));
  if (filters.productId) params.set('product_id', filters.productId);
  if (filters.warehouseId) params.set('warehouse_id', filters.warehouseId);
  if (view === 'movements' && filters.movementType) params.set('movement_type', filters.movementType);
  if (view === 'operations' && filters.operationType) params.set('operation_type', filters.operationType);
  if ((view === 'value' || view === 'warehouses') && filters.hideZero) params.set('hide_zero', 'true');
  return `?${params.toString()}`;
}

export function InventoryReportsWorkspace({ view }: { view: InventoryReportView }) {
  const t = useTranslations('reports.inventory');
  const tr = useTranslations('reports');
  const tPrint = useTranslations('documentPrint');
  const tDoc = useTranslations('reportDoc');
  const locale = useLocale();
  const company = useCompany();
  const { success, error: errorToast } = useToast();
  const [filters, setFilters] = useState<InventoryReportFilterState>(EMPTY_INVENTORY_REPORT_FILTERS);
  const [report, setReport] = useState<InventoryReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<null | 'pdf' | 'share'>(null);
  const [showPreview, setShowPreview] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    api<InventoryReportResponse>(`/reports/inventory${filtersToQuery(view, filters)}`)
      .then((response) => {
        if (!response?.totals || !Array.isArray(response.data)) throw new Error('invalid-inventory-report-response');
        setReport(response);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [view, filters]);

  useEffect(() => load(), [load]);

  const count = useMemo(() => new Intl.NumberFormat(displayLocale(locale)).format.bind(new Intl.NumberFormat(displayLocale(locale))), [locale]);
  const historical = view === 'movements' || view === 'operations' || view === 'stocktakes';
  const text = (value: string | null | undefined) => value || '—';
  const signed = (value: number | undefined) => {
    const n = value ?? 0;
    return `${n > 0 ? '\u200E+' : ''}${count(n)}`;
  };
  const movementLabel = (type: string | undefined) => type === 'in' ? t('movementTypes.in') : t('movementTypes.out');
  const operationLabel = (type: string | undefined) => type ? t(`operationTypes.${type}`) : '—';

  const doc = useMemo<ReportDoc | null>(() => {
    if (!report) return null;
    const title = t(`views.${view}`);
    if (view === 'value') {
      return {
        title,
        columns: [
          { label: t('sku') }, { label: t('product') }, { label: t('unit') },
          { label: t('quantity'), align: 'end' }, { label: t('averageCost'), align: 'end' }, { label: t('stockValue'), align: 'end' },
        ],
        rows: report.data.map((row) => [text(row.sku), text(row.label), text(row.unit), count(row.quantity ?? 0), formatRiyal(row.avg_cost ?? '0'), formatRiyal(row.stock_value ?? '0')]),
        totalRow: [tr('total'), '', '', count(report.totals.quantity ?? 0), '', formatRiyal(report.totals.stock_value ?? '0')],
        exportName: 'inventory-value',
      };
    }
    if (view === 'warehouses') {
      return {
        title,
        columns: [
          { label: t('warehouse') }, { label: t('branch') }, { label: t('sku') }, { label: t('product') }, { label: t('unit') }, { label: t('quantity'), align: 'end' },
        ],
        rows: report.data.map((row) => [text(row.warehouse), text(row.branch), text(row.sku), text(row.label), text(row.unit), count(row.quantity ?? 0)]),
        totalRow: [tr('total'), '', '', '', '', count(report.totals.quantity ?? 0)],
        exportName: 'warehouse-balances',
      };
    }
    if (view === 'movements') {
      return {
        title,
        columns: [
          { label: t('date') }, { label: t('movementType') }, { label: t('product') }, { label: t('warehouse') }, { label: t('quantity'), align: 'end' }, { label: t('unitCost'), align: 'end' }, { label: t('totalCost'), align: 'end' }, { label: t('balanceAfter'), align: 'end' },
        ],
        rows: report.data.map((row) => [text(row.date), movementLabel(row.type), text(row.label), text(row.warehouse), count(row.quantity ?? 0), formatRiyal(row.unit_cost ?? '0'), formatRiyal(row.total_cost ?? '0'), count(row.balance_quantity ?? 0)]),
        totalRow: [tr('total'), '', '', '', count((report.totals.in_quantity ?? 0) - (report.totals.out_quantity ?? 0)), '', formatRiyal(report.totals.total_cost ?? '0'), ''],
        exportName: 'inventory-movements',
      };
    }
    if (view === 'operations') {
      return {
        title,
        columns: [
          { label: t('date') }, { label: t('number') }, { label: t('operationType') }, { label: t('warehouse') }, { label: t('targetWarehouse') }, { label: t('lines'), align: 'end' }, { label: t('quantity'), align: 'end' }, { label: t('totalCost'), align: 'end' },
        ],
        rows: report.data.map((row) => [text(row.date), text(row.number), operationLabel(row.type), text(row.warehouse), text(row.target_warehouse), count(row.lines ?? 0), count(row.quantity ?? 0), formatRiyal(row.total_cost ?? '0')]),
        totalRow: [tr('total'), '', '', '', '', count(report.totals.lines ?? 0), count(report.totals.quantity ?? 0), formatRiyal(report.totals.total_cost ?? '0')],
        exportName: 'inventory-operations',
      };
    }
    return {
      title,
      columns: [
        { label: t('date') }, { label: t('number') }, { label: t('warehouse') }, { label: t('countedLines'), align: 'end' }, { label: t('quantityDifference'), align: 'end' }, { label: t('differenceValue'), align: 'end' },
      ],
      rows: report.data.map((row) => [text(row.date), text(row.number), text(row.warehouse), count(row.counted_lines ?? 0), signed(row.quantity_difference), formatRiyal(row.difference_value ?? '0')]),
      totalRow: [tr('total'), '', '', count(report.totals.counted_lines ?? 0), signed(report.totals.quantity_difference), formatRiyal(report.totals.difference_value ?? '0')],
      exportName: 'stocktake-differences',
    };
  }, [report, view, t, tr, count]);

  const rowHrefs = useMemo(() => report?.data.map((row) => {
    if (!row.key) return null;
    if (view === 'value' || view === 'warehouses') return `/products/${row.key}`;
    if (view === 'operations') return `/stock-permits/${row.key}`;
    if (view === 'stocktakes') return `/stocktaking/${row.key}`;
    return null;
  }), [report, view]);

  const summary = useMemo(() => {
    if (!report) return [] as { label: string; value: string; tone?: 'positive' | 'negative' }[];
    if (view === 'value') return [
      { label: t('products'), value: count(report.totals.products ?? 0) },
      { label: t('quantity'), value: count(report.totals.quantity ?? 0) },
      { label: t('stockValue'), value: formatRiyal(report.totals.stock_value ?? '0') },
    ];
    if (view === 'warehouses') return [
      { label: t('warehouses'), value: count(report.totals.warehouses ?? 0) },
      { label: t('items'), value: count(report.totals.items ?? 0) },
      { label: t('quantity'), value: count(report.totals.quantity ?? 0) },
    ];
    if (view === 'movements') return [
      { label: t('movements'), value: count(report.totals.movements ?? 0) },
      { label: t('incomingQuantity'), value: count(report.totals.in_quantity ?? 0), tone: 'positive' as const },
      { label: t('outgoingQuantity'), value: count(report.totals.out_quantity ?? 0), tone: 'negative' as const },
      { label: t('netQuantity'), value: signed((report.totals.in_quantity ?? 0) - (report.totals.out_quantity ?? 0)) },
    ];
    if (view === 'operations') return [
      { label: t('operations'), value: count(report.totals.operations ?? 0) },
      { label: t('lines'), value: count(report.totals.lines ?? 0) },
      { label: t('quantity'), value: count(report.totals.quantity ?? 0) },
      { label: t('totalCost'), value: formatRiyal(report.totals.total_cost ?? '0') },
    ];
    const difference = Number(report.totals.difference_value ?? '0');
    return [
      { label: t('stocktakes'), value: count(report.totals.stocktakes ?? 0) },
      { label: t('countedLines'), value: count(report.totals.counted_lines ?? 0) },
      { label: t('quantityDifference'), value: signed(report.totals.quantity_difference) },
      { label: t('differenceValue'), value: formatRiyal(report.totals.difference_value ?? '0'), tone: difference > 0 ? 'positive' as const : difference < 0 ? 'negative' as const : undefined },
    ];
  }, [report, view, t, count]);

  function exportCsv() {
    if (!doc) return;
    downloadCsv(doc.exportName, toCsv(doc.columns.map((column) => column.label), [...doc.rows, doc.totalRow]));
  }

  async function makePdf() {
    if (!doc) throw new Error('report-unavailable');
    return createReportPdf({
      ...doc,
      company,
      labels: { asOf: tDoc('as_of'), vatNumber: tDoc('vat_number'), crNumber: tPrint('cr_number'), footer: tDoc('footer'), empty: tr('empty') },
      locale,
    });
  }

  async function downloadPdf() {
    if (!doc) return;
    setBusy('pdf');
    try { downloadReportPdf(await makePdf(), doc.exportName); success(tPrint('downloaded_ok')); }
    catch { errorToast(tPrint('export_failed')); }
    finally { setBusy(null); }
  }

  async function sharePdf() {
    if (!doc) return;
    setBusy('share');
    try { const result = await shareReportPdf(await makePdf(), doc.exportName, doc.title); success(result === 'shared' ? tPrint('shared_ok') : tPrint('downloaded_ok')); }
    catch (error) { if ((error as Error)?.name !== 'AbortError') errorToast(tPrint('export_failed')); }
    finally { setBusy(null); }
  }

  const scope = useMemo(() => {
    if (!historical) return t('currentSnapshot');
    const branchScope = filters.branchIds.length === 0 ? tr('all_branches') : tr('branches_selected', { n: filters.branchIds.length });
    const periodScope = !filters.from && !filters.to ? tr('all_periods') : [filters.from || '…', filters.to || '…'].join(' ← ');
    return `${branchScope} · ${periodScope}`;
  }, [historical, filters.branchIds, filters.from, filters.to, t, tr]);

  const sourceLabel = view === 'value' ? t('sourceCurrentProducts')
    : view === 'warehouses' ? t('sourceWarehouseQuantities')
      : view === 'movements' ? t('sourcePostedMovements')
        : view === 'operations' ? t('sourcePostedOperations')
          : t('sourcePostedStocktakes');
  const actions = [
    { id: 'csv', label: tr('csv'), icon: Download, onSelect: exportCsv, disabled: !doc || !!busy },
    { id: 'pdf', label: busy === 'pdf' ? tPrint('generating') : tr('pdf'), icon: Download, onSelect: () => void downloadPdf(), disabled: !doc || !!busy, busy: busy === 'pdf' },
    { id: 'share', label: busy === 'share' ? tPrint('generating') : tr('share_pdf'), icon: Share2, onSelect: () => void sharePdf(), disabled: !doc || !!busy, busy: busy === 'share' },
    { id: 'print', label: tr('print'), icon: Printer, onSelect: () => printDocument({ widthMm: 210, heightMm: 297 }), disabled: !doc || !!busy },
    { id: 'preview', label: tr('preview'), icon: FileText, onSelect: () => setShowPreview((visible) => !visible), disabled: !doc },
  ];

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <Link href="/reports/inventory" className="no-print inline-flex items-center gap-1 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          <ArrowRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.7} />
          {t('backToInventoryReports')}
        </Link>
        <ReportScreenHeader title={t(`views.${view}`)} description={t(`descriptions.${view}`)} scope={scope} actions={actions} actionsLabel={tr('report_actions')} />
      </div>

      <InventoryReportFilters view={view} value={filters} onChange={setFilters} />

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-24 w-full" />)}</div>
      ) : failed ? (
        <Card><CardContent className="py-10 text-center"><p className="text-sm text-negative">{t('loadFailed')}</p><Button className="mt-3" variant="outline" size="sm" onClick={load}>{t('retry')}</Button></CardContent></Card>
      ) : (
        <>
          <ReportMetricGrid metrics={summary} />
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle>{t('details')}</CardTitle><Badge tone="neutral">{sourceLabel}</Badge></CardHeader>
            <CardContent>
              {!doc || doc.rows.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">{t('empty')}</p>
              ) : (
                <ReportResultsTable
                  columns={doc.columns}
                  rows={doc.rows}
                  totalRow={doc.totalRow}
                  emptyText={t('empty')}
                  primaryIndex={view === 'value' ? 1 : view === 'warehouses' ? 3 : view === 'movements' ? 2 : 1}
                  rowHrefs={rowHrefs}
                  reportKey={`inventory:${view}`}
                />
              )}
            </CardContent>
          </Card>

          {doc && showPreview && (
            <Card>
              <CardHeader className="no-print"><CardTitle>{tr('preview')}</CardTitle></CardHeader>
              <CardContent className="print:p-0"><div className="rounded bg-background p-3 print:bg-transparent print:p-0 [&_.print-only]:block"><DocumentScaler><ReportDocument title={doc.title} company={company} columns={doc.columns} rows={doc.rows} totalRow={doc.totalRow} /></DocumentScaler></div></CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
