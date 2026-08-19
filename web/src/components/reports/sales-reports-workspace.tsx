'use client';

/**
 * أسلوب «دفتر التحليل»: يسبق نطاق التقرير وملخصه الجدول، وتتبدل صفوف المبيعات
 * إلى بطاقات قابلة للمس على الجوال بينما يحتفظ سطح المكتب بالجدول المكتمل.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Download, FileText, Printer, Share2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ReportDocument, type ReportColumn } from '@/components/reports/report-document';
import { SalesReportFilters, EMPTY_SALES_REPORT_FILTERS, type SalesReportFilterState } from '@/components/reports/sales-report-filters';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { toCsv, downloadCsv } from '@/lib/export';
import { useCompany } from '@/lib/company';
import { useToast } from '@/components/ui/toast';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import { printDocument } from '@/modules/documents/services/export';
import { createReportPdf, downloadReportPdf, shareReportPdf } from '@/modules/reports/services/report-pdf';
import { ReportMetricGrid, ReportMobileRows, ReportScreenHeader, type ReportMetric } from '@/components/reports/report-workspace-ui';

export type SalesReportView = 'period' | 'customer' | 'product' | 'salesperson' | 'profit' | 'payments';

type Money = string;
interface SalesRow {
  key: string | null;
  label: string | null;
  invoices?: number;
  quantity?: number;
  receipts?: number;
  amount?: Money;
  revenue?: Money;
  cost?: Money;
  profit?: Money;
  margin_bp?: number;
}
interface SalesTotals {
  invoices?: number;
  receipts?: number;
  amount?: Money;
  net_sales?: Money;
  tax?: Money;
  revenue?: Money;
  cost?: Money;
  profit?: Money;
  margin_bp?: number;
}
interface SalesReportResponse {
  view: SalesReportView;
  data: SalesRow[];
  totals: SalesTotals;
  scope: { interval: string; source: string };
}
interface ReportDoc {
  title: string;
  columns: ReportColumn[];
  rows: string[][];
  totalRow: string[];
  exportName: string;
}

function filtersToQuery(view: SalesReportView, f: SalesReportFilterState): string {
  const p = new URLSearchParams({ view });
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  f.branchIds.forEach((id) => p.append('branch_id[]', id));
  if (f.customerId) p.set('customer_id', f.customerId);
  if (f.productId) p.set('product_id', f.productId);
  if (f.salespersonId) p.set('salesperson_id', f.salespersonId);
  if (f.paymentStatus) p.set('payment_status', f.paymentStatus);
  if (f.receiptMethod) p.set('receipt_method', f.receiptMethod);
  if (view === 'period' || view === 'profit' || view === 'payments') p.set('interval', f.interval);
  return `?${p.toString()}`;
}

export function SalesReportsWorkspace({ view }: { view: SalesReportView }) {
  const t = useTranslations('reports.sales');
  const tr = useTranslations('reports');
  const tPrint = useTranslations('documentPrint');
  const tDoc = useTranslations('reportDoc');
  const locale = useLocale();
  const company = useCompany();
  const { success, error: errorToast } = useToast();
  const [filters, setFilters] = useState<SalesReportFilterState>(EMPTY_SALES_REPORT_FILTERS);
  const [report, setReport] = useState<SalesReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<null | 'pdf' | 'share'>(null);
  const [showPreview, setShowPreview] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    api<SalesReportResponse>(`/reports/sales${filtersToQuery(view, filters)}`)
      .then((response) => {
        // وضع المعاينة لا يملك مصدر API لتقارير المبيعات بعد؛ لا نحاول قراءة
        // استجابة ناقصة وكأنها تقرير حقيقي، بل نعرض حالة الخطأ الصريحة.
        if (!response?.totals || !Array.isArray(response.data)) throw new Error('invalid-sales-report-response');
        setReport(response);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [view, filters]);

  useEffect(() => load(), [load]);

  const count = useMemo(() => new Intl.NumberFormat(locale).format.bind(new Intl.NumberFormat(locale)), [locale]);
  const percentage = useCallback((basisPoints?: number) => new Intl.NumberFormat(locale, {
    style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format((basisPoints ?? 0) / 10000), [locale]);

  const rowLabel = useCallback((row: SalesRow) => row.label ?? (view === 'product' ? t('manualItem') : t('unassigned')), [view, t]);

  const doc = useMemo<ReportDoc | null>(() => {
    if (!report) return null;
    const title = t(`views.${view}`);
    const amountColumn = { label: tr('amount'), align: 'end' as const };
    if (view === 'product') {
      return {
        title,
        columns: [{ label: tr('item') }, { label: t('quantity'), align: 'end' }, amountColumn],
        rows: report.data.map((r) => [rowLabel(r), count(r.quantity ?? 0), formatRiyal(r.amount ?? '0')]),
        totalRow: [tr('total'), count(report.totals.invoices ?? 0), formatRiyal(report.totals.amount ?? '0')],
        exportName: 'sales-by-product',
      };
    }
    if (view === 'profit') {
      return {
        title,
        columns: [{ label: t('period') }, { label: t('revenue'), align: 'end' }, { label: t('cogs'), align: 'end' }, { label: tr('profit'), align: 'end' }, { label: t('margin'), align: 'end' }],
        rows: report.data.map((r) => [r.label ?? '—', formatRiyal(r.revenue ?? '0'), formatRiyal(r.cost ?? '0'), formatRiyal(r.profit ?? '0'), percentage(r.margin_bp)]),
        totalRow: [tr('total'), formatRiyal(report.totals.revenue ?? '0'), formatRiyal(report.totals.cost ?? '0'), formatRiyal(report.totals.profit ?? '0'), percentage(report.totals.margin_bp)],
        exportName: 'sales-profitability',
      };
    }
    if (view === 'payments') {
      return {
        title,
        columns: [{ label: t('period') }, { label: t('receipts'), align: 'end' }, amountColumn],
        rows: report.data.map((r) => [r.label ?? '—', count(r.receipts ?? 0), formatRiyal(r.amount ?? '0')]),
        totalRow: [tr('total'), count(report.totals.receipts ?? 0), formatRiyal(report.totals.amount ?? '0')],
        exportName: 'sales-receipts',
      };
    }
    const firstColumn = view === 'period' ? t('period') : view === 'customer' ? t('customer') : t('salesperson');
    return {
      title,
      columns: [{ label: firstColumn }, { label: t('invoices'), align: 'end' }, amountColumn],
      rows: report.data.map((r) => [rowLabel(r), count(r.invoices ?? 0), formatRiyal(r.amount ?? '0')]),
      totalRow: [tr('total'), count(report.totals.invoices ?? 0), formatRiyal(report.totals.amount ?? '0')],
      exportName: `sales-by-${view}`,
    };
  }, [report, view, t, tr, count, percentage, rowLabel]);

  const summary = useMemo<ReportMetric[]>(() => {
    if (!report) return [];
    if (view === 'profit') return [
      { label: t('revenue'), value: formatRiyal(report.totals.revenue ?? '0') },
      { label: t('cogs'), value: formatRiyal(report.totals.cost ?? '0') },
      { label: tr('profit'), value: formatRiyal(report.totals.profit ?? '0'), tone: Number(report.totals.profit ?? 0) < 0 ? 'negative' : 'positive' },
      { label: t('margin'), value: percentage(report.totals.margin_bp) },
    ];
    if (view === 'payments') return [
      { label: t('receipts'), value: count(report.totals.receipts ?? 0) },
      { label: t('receivedAmount'), value: formatRiyal(report.totals.amount ?? '0'), tone: 'positive' },
    ];
    return [
      { label: t('invoices'), value: count(report.totals.invoices ?? 0) },
      { label: t('netSales'), value: formatRiyal(report.totals.net_sales ?? report.totals.amount ?? '0') },
      { label: t('vat'), value: formatRiyal(report.totals.tax ?? '0') },
      { label: t('totalSales'), value: formatRiyal(report.totals.amount ?? '0'), tone: 'positive' },
    ];
  }, [report, view, t, tr, count, percentage]);

  function exportCsv() {
    if (!doc) return;
    downloadCsv(doc.exportName, toCsv(doc.columns.map((c) => c.label), [...doc.rows, doc.totalRow]));
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
    const branchScope = filters.branchIds.length === 0
      ? tr('all_branches')
      : tr('branches_selected', { n: filters.branchIds.length });
    const periodScope = !filters.from && !filters.to
      ? tr('all_periods')
      : [filters.from || '…', filters.to || '…'].join(' ← ');
    return `${branchScope} · ${periodScope}`;
  }, [filters.branchIds, filters.from, filters.to, tr]);

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
        <Link href="/reports/sales" className="no-print inline-flex items-center gap-1 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          <ArrowRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.7} />
          {t('backToSalesReports')}
        </Link>
        <ReportScreenHeader title={t(`views.${view}`)} description={t(`descriptions.${view}`)} scope={scope} actions={actions} actionsLabel={tr('report_actions')} />
      </div>

      <SalesReportFilters view={view} value={filters} onChange={setFilters} />

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : failed ? (
        <Card><CardContent className="py-10 text-center"><p className="text-sm text-negative">{t('loadFailed')}</p><Button className="mt-3" variant="outline" size="sm" onClick={load}>{t('retry')}</Button></CardContent></Card>
      ) : (
        <>
          <ReportMetricGrid metrics={summary} />

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle>{t('details')}</CardTitle><Badge tone="neutral">{t(view === 'payments' ? 'sourceReceipts' : 'sourcePostedInvoices')}</Badge></CardHeader>
            <CardContent>
              {!doc || doc.rows.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">{t('empty')}</p>
              ) : (
                <>
                <ReportMobileRows columns={doc.columns} rows={doc.rows} totalRow={doc.totalRow} emptyText={t('empty')} primaryIndex={0} />
                <Table className="hidden md:table">
                  <THead><TR>{doc.columns.map((column) => <TH key={column.label} className={column.align === 'end' ? 'text-end' : undefined}>{column.label}</TH>)}</TR></THead>
                  <TBody>
                    {doc.rows.map((row, rowIndex) => <TR key={`${row[0]}-${rowIndex}`}>{row.map((cell, cellIndex) => <TD key={cellIndex} className={doc.columns[cellIndex]?.align === 'end' ? 'num text-end' : undefined}>{cell}</TD>)}</TR>)}
                    <TR className="font-semibold">{doc.totalRow.map((cell, cellIndex) => <TD key={cellIndex} className={doc.columns[cellIndex]?.align === 'end' ? 'num text-end' : undefined}>{cell}</TD>)}</TR>
                  </TBody>
                </Table>
                </>
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
