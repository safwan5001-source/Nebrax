'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Download, Printer, Share2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ReportDocument, type ReportColumn } from '@/components/reports/report-document';
import { PurchaseReportFilters, EMPTY_PURCHASE_REPORT_FILTERS, type PurchaseReportFilterState } from '@/components/reports/purchases-report-filters';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { toCsv, downloadCsv } from '@/lib/export';
import { useCompany } from '@/lib/company';
import { useToast } from '@/components/ui/toast';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import { printDocument } from '@/modules/documents/services/export';
import { createReportPdf, downloadReportPdf, shareReportPdf } from '@/modules/reports/services/report-pdf';

export type PurchaseReportView = 'period' | 'supplier' | 'product' | 'employee' | 'balances' | 'payments';

type Money = string;
interface PurchaseRow {
  key: string | null;
  label: string | null;
  purchases?: number;
  quantity?: number;
  payments?: number;
  amount?: Money;
  balance?: Money;
}
interface PurchaseTotals {
  purchases?: number;
  payments?: number;
  amount?: Money;
  net_purchases?: Money;
  tax?: Money;
  balance?: Money;
}
interface PurchaseReportResponse {
  view: PurchaseReportView;
  data: PurchaseRow[];
  totals: PurchaseTotals;
  scope: { interval: string; source: string };
}
interface ReportDoc {
  title: string;
  columns: ReportColumn[];
  rows: string[][];
  totalRow: string[];
  exportName: string;
}

function filtersToQuery(view: PurchaseReportView, filters: PurchaseReportFilterState): string {
  const params = new URLSearchParams({ view });
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  filters.branchIds.forEach((id) => params.append('branch_id[]', id));
  if (filters.supplierId) params.set('supplier_id', filters.supplierId);
  if (filters.productId) params.set('product_id', filters.productId);
  if (filters.creatorId) params.set('creator_id', filters.creatorId);
  if (filters.paymentStatus) params.set('payment_status', filters.paymentStatus);
  if (filters.receivedStatus) params.set('received_status', filters.receivedStatus);
  if (filters.paymentMethod) params.set('payment_method', filters.paymentMethod);
  if (view === 'period' || view === 'payments') params.set('interval', filters.interval);
  return `?${params.toString()}`;
}

export function PurchasesReportsWorkspace({ view }: { view: PurchaseReportView }) {
  const t = useTranslations('reports.purchases');
  const tr = useTranslations('reports');
  const tPrint = useTranslations('documentPrint');
  const tDoc = useTranslations('reportDoc');
  const locale = useLocale();
  const company = useCompany();
  const { success, error: errorToast } = useToast();
  const [filters, setFilters] = useState<PurchaseReportFilterState>(EMPTY_PURCHASE_REPORT_FILTERS);
  const [report, setReport] = useState<PurchaseReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<null | 'pdf' | 'share'>(null);

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    api<PurchaseReportResponse>(`/reports/purchases${filtersToQuery(view, filters)}`)
      .then((response) => {
        if (!response?.totals || !Array.isArray(response.data)) throw new Error('invalid-purchase-report-response');
        setReport(response);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [view, filters]);

  useEffect(() => load(), [load]);

  const count = useMemo(() => new Intl.NumberFormat(locale).format.bind(new Intl.NumberFormat(locale)), [locale]);
  const rowLabel = useCallback((row: PurchaseRow) => row.label ?? (view === 'product' ? t('manualItem') : t('unassigned')), [view, t]);

  const doc = useMemo<ReportDoc | null>(() => {
    if (!report) return null;
    const title = t(`views.${view}`);
    const amountColumn = { label: tr('amount'), align: 'end' as const };
    if (view === 'product') {
      return {
        title,
        columns: [{ label: tr('item') }, { label: t('quantity'), align: 'end' }, amountColumn],
        rows: report.data.map((row) => [rowLabel(row), count(row.quantity ?? 0), formatRiyal(row.amount ?? '0')]),
        totalRow: [tr('total'), count(report.totals.purchases ?? 0), formatRiyal(report.totals.amount ?? '0')],
        exportName: 'purchases-by-product',
      };
    }
    if (view === 'balances') {
      return {
        title,
        columns: [{ label: t('supplier') }, { label: t('purchases'), align: 'end' }, amountColumn, { label: t('outstanding'), align: 'end' }],
        rows: report.data.map((row) => [rowLabel(row), count(row.purchases ?? 0), formatRiyal(row.amount ?? '0'), formatRiyal(row.balance ?? '0')]),
        totalRow: [tr('total'), count(report.totals.purchases ?? 0), formatRiyal(report.totals.amount ?? '0'), formatRiyal(report.totals.balance ?? '0')],
        exportName: 'supplier-balances',
      };
    }
    if (view === 'payments') {
      return {
        title,
        columns: [{ label: t('period'), align: 'start' }, { label: t('payments'), align: 'end' }, amountColumn],
        rows: report.data.map((row) => [row.label ?? '—', count(row.payments ?? 0), formatRiyal(row.amount ?? '0')]),
        totalRow: [tr('total'), count(report.totals.payments ?? 0), formatRiyal(report.totals.amount ?? '0')],
        exportName: 'supplier-payments',
      };
    }
    const firstColumn = view === 'period' ? t('period') : view === 'supplier' ? t('supplier') : t('creator');
    return {
      title,
      columns: [{ label: firstColumn }, { label: t('purchases'), align: 'end' }, amountColumn],
      rows: report.data.map((row) => [rowLabel(row), count(row.purchases ?? 0), formatRiyal(row.amount ?? '0')]),
      totalRow: [tr('total'), count(report.totals.purchases ?? 0), formatRiyal(report.totals.amount ?? '0')],
      exportName: `purchases-by-${view}`,
    };
  }, [report, view, t, tr, count, rowLabel]);

  const summary = useMemo(() => {
    if (!report) return [] as { label: string; value: string; tone?: 'positive' | 'negative' }[];
    if (view === 'payments') return [
      { label: t('payments'), value: count(report.totals.payments ?? 0) },
      { label: t('paidAmount'), value: formatRiyal(report.totals.amount ?? '0'), tone: 'negative' as const },
    ];
    if (view === 'balances') return [
      { label: t('purchases'), value: count(report.totals.purchases ?? 0) },
      { label: t('totalPurchases'), value: formatRiyal(report.totals.amount ?? '0') },
      { label: t('outstanding'), value: formatRiyal(report.totals.balance ?? '0'), tone: 'negative' as const },
    ];
    return [
      { label: t('purchases'), value: count(report.totals.purchases ?? 0) },
      { label: t('netPurchases'), value: formatRiyal(report.totals.net_purchases ?? report.totals.amount ?? '0') },
      { label: t('vat'), value: formatRiyal(report.totals.tax ?? '0') },
      { label: t('totalPurchases'), value: formatRiyal(report.totals.amount ?? '0'), tone: 'negative' as const },
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

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/reports/purchases" className="inline-flex items-center gap-1 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <ArrowRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.7} />
            {t('backToPurchasesReports')}
          </Link>
          <h1 className="mt-3 text-xl font-semibold text-text">{t(`views.${view}`)}</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">{t(`descriptions.${view}`)}</p>
        </div>
        <div className="no-print flex flex-wrap gap-2 sm:justify-end">
          <Button variant="outline" size="sm" disabled={!doc || !!busy} onClick={exportCsv}><Download className="h-4 w-4" strokeWidth={1.7} />{tr('csv')}</Button>
          <Button variant="outline" size="sm" disabled={!doc || !!busy} onClick={downloadPdf}><Download className="h-4 w-4" strokeWidth={1.7} />{busy === 'pdf' ? tPrint('generating') : tr('pdf')}</Button>
          <Button variant="outline" size="sm" disabled={!doc || !!busy} onClick={sharePdf}><Share2 className="h-4 w-4" strokeWidth={1.7} />{busy === 'share' ? tPrint('generating') : tr('share_pdf')}</Button>
          <Button variant="outline" size="sm" disabled={!doc || !!busy} onClick={() => printDocument({ widthMm: 210, heightMm: 297 })}><Printer className="h-4 w-4" strokeWidth={1.7} />{tr('print')}</Button>
        </div>
      </header>

      <PurchaseReportFilters view={view} value={filters} onChange={setFilters} />

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-24 w-full" />)}</div>
      ) : failed ? (
        <Card><CardContent className="py-10 text-center"><p className="text-sm text-negative">{t('loadFailed')}</p><Button className="mt-3" variant="outline" size="sm" onClick={load}>{t('retry')}</Button></CardContent></Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {summary.map((item) => (
              <Card key={item.label}><CardContent className="p-4"><p className="text-xs text-muted">{item.label}</p><p className={`num mt-2 text-lg font-semibold ${item.tone === 'negative' ? 'text-negative' : item.tone === 'positive' ? 'text-positive' : 'text-text'}`}>{item.value}</p></CardContent></Card>
            ))}
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle>{t('details')}</CardTitle><Badge tone="neutral">{t(view === 'payments' ? 'sourceSupplierPayments' : 'sourcePostedPurchases')}</Badge></CardHeader>
            <CardContent>
              {!doc || doc.rows.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">{t('empty')}</p>
              ) : (
                <Table>
                  <THead><TR>{doc.columns.map((column) => <TH key={column.label} className={column.align === 'end' ? 'text-end' : undefined}>{column.label}</TH>)}</TR></THead>
                  <TBody>
                    {doc.rows.map((row, rowIndex) => <TR key={`${row[0]}-${rowIndex}`}>{row.map((cell, cellIndex) => <TD key={cellIndex} className={doc.columns[cellIndex]?.align === 'end' ? 'num text-end' : undefined}>{cell}</TD>)}</TR>)}
                    <TR className="font-semibold">{doc.totalRow.map((cell, cellIndex) => <TD key={cellIndex} className={doc.columns[cellIndex]?.align === 'end' ? 'num text-end' : undefined}>{cell}</TD>)}</TR>
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {doc && (
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
