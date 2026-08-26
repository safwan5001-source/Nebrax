'use client';
import { displayLocale } from '@/lib/formatting';

/**
 * دفتر تحليل العملاء: لا يخلط مصادره. المبيعات والذمم من فواتير بيع مرحّلة،
 * والقبض من سندات قبض مرحّلة، والمواعيد مصدر تشغيلي واضح مستقل عن المال.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Download, FileText, Printer, Share2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ReportDocument, type ReportColumn } from '@/components/reports/report-document';
import { CustomerReportFilters, EMPTY_CUSTOMER_REPORT_FILTERS, type CustomerReportFilterState } from '@/components/reports/customer-report-filters';
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
import { ReportPresentationModeControl, type ReportPresentationMode } from '@/components/reports/report-presentation-mode';
import { CustomerReportAnalytics } from '@/components/reports/customer-report-analytics';

export type CustomerReportView = 'sales' | 'balances' | 'payments' | 'appointments';

type Money = string;
interface CustomerRow {
  key: string | null;
  label: string | null;
  invoices?: number;
  receipts?: number;
  appointments?: number;
  scheduled?: number;
  done?: number;
  cancelled?: number;
  amount?: Money;
  balance?: Money;
}
interface CustomerTotals {
  invoices?: number;
  receipts?: number;
  appointments?: number;
  scheduled?: number;
  done?: number;
  cancelled?: number;
  amount?: Money;
  net_sales?: Money;
  tax?: Money;
  balance?: Money;
}
interface CustomerReportResponse {
  view: CustomerReportView;
  data: CustomerRow[];
  totals: CustomerTotals;
  scope: { interval: string; source: string };
}
interface ReportDoc {
  title: string;
  columns: ReportColumn[];
  rows: string[][];
  totalRow: string[];
  exportName: string;
}

function filtersToQuery(view: CustomerReportView, filters: CustomerReportFilterState): string {
  const params = new URLSearchParams({ view });
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  filters.branchIds.forEach((id) => params.append('branch_id[]', id));
  if (filters.customerId) params.set('customer_id', filters.customerId);
  if (filters.paymentStatus) params.set('payment_status', filters.paymentStatus);
  if (filters.paymentMethod) params.set('payment_method', filters.paymentMethod);
  if (filters.appointmentStatus) params.set('appointment_status', filters.appointmentStatus);
  if (view === 'payments') params.set('interval', filters.interval);
  return `?${params.toString()}`;
}

export function CustomersReportsWorkspace({ view }: { view: CustomerReportView }) {
  const t = useTranslations('reports.customers');
  const tr = useTranslations('reports');
  const tPrint = useTranslations('documentPrint');
  const tDoc = useTranslations('reportDoc');
  const locale = useLocale();
  const company = useCompany();
  const { success, error: errorToast } = useToast();
  const [filters, setFilters] = useState<CustomerReportFilterState>(EMPTY_CUSTOMER_REPORT_FILTERS);
  const [presentationMode, setPresentationMode] = useState<ReportPresentationMode>('summary');
  const [report, setReport] = useState<CustomerReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<null | 'pdf' | 'share'>(null);
  const [showPreview, setShowPreview] = useState(false);
  const requestGeneration = useRef(0);

  const load = useCallback(() => {
    const generation = ++requestGeneration.current;
    setReport(null);
    setFailed(false);
    setLoading(true);
    api<CustomerReportResponse>(`/reports/customers${filtersToQuery(view, filters)}`)
      .then((response) => {
        if (!response?.totals || !Array.isArray(response.data)) throw new Error('invalid-customer-report-response');
        if (generation !== requestGeneration.current) return;
        setReport(response);
      })
      .catch(() => {
        if (generation === requestGeneration.current) setFailed(true);
      })
      .finally(() => {
        if (generation === requestGeneration.current) setLoading(false);
      });
  }, [view, filters]);

  useEffect(() => load(), [load]);
  useEffect(() => setPresentationMode('summary'), [view]);

  const count = useMemo(() => new Intl.NumberFormat(displayLocale(locale)).format.bind(new Intl.NumberFormat(displayLocale(locale))), [locale]);
  const rowLabel = useCallback((row: CustomerRow) => row.label ?? t('customer'), [t]);

  const doc = useMemo<ReportDoc | null>(() => {
    if (!report) return null;
    const title = t(`views.${view}`);
    const amountColumn = { label: tr('amount'), align: 'end' as const };
    if (view === 'appointments') {
      return {
        title,
        columns: [
          { label: t('customer') },
          { label: t('appointments'), align: 'end' },
          { label: t('scheduled'), align: 'end' },
          { label: t('done'), align: 'end' },
          { label: t('cancelled'), align: 'end' },
        ],
        rows: report.data.map((row) => [rowLabel(row), count(row.appointments ?? 0), count(row.scheduled ?? 0), count(row.done ?? 0), count(row.cancelled ?? 0)]),
        totalRow: [tr('total'), count(report.totals.appointments ?? 0), count(report.totals.scheduled ?? 0), count(report.totals.done ?? 0), count(report.totals.cancelled ?? 0)],
        exportName: 'customer-appointments',
      };
    }
    if (view === 'balances') {
      return {
        title,
        columns: [{ label: t('customer') }, { label: t('invoices'), align: 'end' }, amountColumn, { label: t('outstanding'), align: 'end' }],
        rows: report.data.map((row) => [rowLabel(row), count(row.invoices ?? 0), formatRiyal(row.amount ?? '0'), formatRiyal(row.balance ?? '0')]),
        totalRow: [tr('total'), count(report.totals.invoices ?? 0), formatRiyal(report.totals.amount ?? '0'), formatRiyal(report.totals.balance ?? '0')],
        exportName: 'customer-balances',
      };
    }
    if (view === 'payments') {
      return {
        title,
        columns: [{ label: t('period'), align: 'start' }, { label: t('receipts'), align: 'end' }, amountColumn],
        rows: report.data.map((row) => [row.label ?? '—', count(row.receipts ?? 0), formatRiyal(row.amount ?? '0')]),
        totalRow: [tr('total'), count(report.totals.receipts ?? 0), formatRiyal(report.totals.amount ?? '0')],
        exportName: 'customer-payments',
      };
    }
    return {
      title,
      columns: [{ label: t('customer') }, { label: t('invoices'), align: 'end' }, amountColumn],
      rows: report.data.map((row) => [rowLabel(row), count(row.invoices ?? 0), formatRiyal(row.amount ?? '0')]),
      totalRow: [tr('total'), count(report.totals.invoices ?? 0), formatRiyal(report.totals.amount ?? '0')],
      exportName: 'customer-sales',
    };
  }, [report, view, t, tr, count, rowLabel]);

  const rowHrefs = useMemo(() => report?.data.map((row) => {
    if (!row.key || view === 'payments') return null;
    return `/partners/${row.key}`;
  }), [report, view]);

  const summary = useMemo(() => {
    if (!report) return [] as { label: string; value: string; tone?: 'positive' | 'negative' }[];
    if (view === 'appointments') return [
      { label: t('appointments'), value: count(report.totals.appointments ?? 0) },
      { label: t('scheduled'), value: count(report.totals.scheduled ?? 0) },
      { label: t('done'), value: count(report.totals.done ?? 0) },
      { label: t('cancelled'), value: count(report.totals.cancelled ?? 0) },
    ];
    if (view === 'payments') return [
      { label: t('receipts'), value: count(report.totals.receipts ?? 0) },
      { label: t('receivedAmount'), value: formatRiyal(report.totals.amount ?? '0') },
    ];
    if (view === 'balances') return [
      { label: t('invoices'), value: count(report.totals.invoices ?? 0) },
      { label: t('totalSales'), value: formatRiyal(report.totals.amount ?? '0') },
      { label: t('outstanding'), value: formatRiyal(report.totals.balance ?? '0'), tone: 'negative' as const },
    ];
    return [
      { label: t('invoices'), value: count(report.totals.invoices ?? 0) },
      { label: t('netSales'), value: formatRiyal(report.totals.net_sales ?? report.totals.amount ?? '0') },
      { label: t('vat'), value: formatRiyal(report.totals.tax ?? '0') },
      { label: t('totalSales'), value: formatRiyal(report.totals.amount ?? '0') },
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
    const branchScope = filters.branchIds.length === 0
      ? tr('all_branches')
      : tr('branches_selected', { n: filters.branchIds.length });
    const periodScope = !filters.from && !filters.to
      ? tr('all_periods')
      : [filters.from || '…', filters.to || '…'].join(' ← ');
    return `${branchScope} · ${periodScope}`;
  }, [filters.branchIds, filters.from, filters.to, tr]);

  const sourceLabel = view === 'payments'
    ? t('sourceCustomerReceipts')
    : view === 'appointments'
      ? t('sourceCustomerAppointments')
      : t('sourcePostedInvoices');
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
        <Link href="/reports/customers" className="no-print inline-flex items-center gap-1 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          <ArrowRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.7} />
          {t('backToCustomerReports')}
        </Link>
        <ReportScreenHeader title={t(`views.${view}`)} description={t(`descriptions.${view}`)} scope={scope} actions={actions} actionsLabel={tr('report_actions')} />
      </div>

      <CustomerReportFilters view={view} value={filters} onChange={setFilters} />

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-24 w-full" />)}</div>
      ) : failed ? (
        <Card><CardContent className="py-10 text-center"><p className="text-sm text-negative">{t('loadFailed')}</p><Button className="mt-3" variant="outline" size="sm" onClick={load}>{t('retry')}</Button></CardContent></Card>
      ) : (
        <>
          <div className="no-print flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-text">{t('presentation')}</h2>
            <ReportPresentationModeControl
              value={presentationMode}
              onChange={setPresentationMode}
              label={t('presentation')}
              summaryLabel={t('summary')}
              detailLabel={t('detail')}
            />
          </div>
          <ReportMetricGrid metrics={summary} />

          {presentationMode === 'detail' ? (
            <Card data-testid="customers-detail-unavailable">
              <CardHeader><CardTitle>{t('detailUnavailableTitle')}</CardTitle></CardHeader>
              <CardContent><p className="text-sm leading-6 text-muted">{t('detailUnavailableDescription')}</p></CardContent>
            </Card>
          ) : (
            <>
              <CustomerReportAnalytics view={view} rows={report?.data ?? []} loading={loading} />
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle>{t('summary')}</CardTitle><Badge tone="neutral">{sourceLabel}</Badge></CardHeader>
                <CardContent>
                  {!doc || doc.rows.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted">{t('empty')}</p>
                  ) : (
                    <ReportResultsTable
                      columns={doc.columns}
                      rows={doc.rows}
                      totalRow={doc.totalRow}
                      emptyText={t('empty')}
                      primaryIndex={0}
                      rowHrefs={rowHrefs}
                      reportKey={`customers:${view}`}
                    />
                  )}
                </CardContent>
              </Card>
            </>
          )}

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
