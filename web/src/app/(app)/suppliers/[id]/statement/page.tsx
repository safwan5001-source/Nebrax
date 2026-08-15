'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, Download, FileSpreadsheet, Printer, RefreshCw, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { ReportFilters, filtersToQuery, EMPTY_FILTERS, type ReportFilterState } from '@/components/reports/report-filters';
import { PartnerStatementDocument, type PartnerStatementData } from '@/components/partners/partner-statement-document';
import { printDocument } from '@/modules/documents/services/export';
import { createPartnerStatementPdf, downloadPartnerStatementPdf, sharePartnerStatementPdf } from '@/modules/partners/services/statement-pdf';
import { exportXlsx } from '@/lib/xlsx';
import { api } from '@/lib/api';
import { useCompany } from '@/lib/company';

interface Supplier {
  id: string;
  name: string;
  type: string;
}

type BusyAction = 'pdf' | 'share' | 'xlsx' | null;
const A4 = { widthMm: 210, heightMm: 297 };

function supplierReportQuery(filters: ReportFilterState): string {
  const query = filtersToQuery(filters);
  return `${query}${query ? '&' : '?'}partner_role=supplier`;
}

/**
 * كشف حساب مورد مستقل: يعرض قيود الدائنين الخاصة بالمورّد فقط، لكنه يستعمل محرك
 * التقارير وPDF المتجهي العام حتى لا يتكرر منطق الحساب أو تنسيق المستند.
 */
export default function SupplierStatementPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('supplierStatement');
  const locale = useLocale();
  const { success, error: errorToast } = useToast();
  const company = useCompany();

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [statement, setStatement] = useState<PartnerStatementData | null>(null);
  const [filters, setFilters] = useState<ReportFilterState>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [supplierResult, statementResult] = await Promise.all([
        api<{ data: Supplier }>(`/partners/${id}`),
        api<PartnerStatementData>(`/reports/partner-statement/${id}${supplierReportQuery(filters)}`),
      ]);
      // لا تُعرض شاشة المورد لطرف هو عميل فقط، حتى لا تُنسب ذمم العملاء إلى الموردين.
      if (!['supplier', 'both'].includes(supplierResult.data.type)) throw new Error('Not a supplier');
      setSupplier(supplierResult.data);
      setStatement(statementResult);
    } catch {
      setSupplier(null);
      setStatement(null);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [filters, id]);

  useEffect(() => { void load(); }, [load]);

  const fileName = useMemo(() => {
    const safeName = (supplier?.name ?? 'supplier-statement').replace(/[\\/:*?"<>|]/g, '-').trim();
    return `${t('file_prefix')}-${safeName || 'supplier'}`;
  }, [supplier?.name, t]);

  const pdfInput = () => statement ? ({
    statement,
    company,
    filters,
    locale,
    labels: {
      title: t('title'), customer: t('supplier'), period: t('period'), allPeriods: t('all_periods'),
      branchScope: t('branch_scope'), allBranches: t('all_branches'),
      selectedBranches: (count: number) => t('branches_selected', { count }),
      openingBalance: t('opening_balance'), totalDebit: t('debit'), totalCredit: t('credit'), closingBalance: t('closing_credit_balance'), creditBalance: true,
      date: t('date'), entryNumber: t('entry_number'), description: t('description'), debit: t('debit'), credit: t('credit'), balance: t('balance'),
      generatedAt: t('generated_at'), vatNumber: t('vat_number'), crNumber: t('cr_number'), footer: t('footer_note'),
      currency: t('currency'), empty: t('empty'),
    },
  }) : null;

  async function handlePdf() {
    const input = pdfInput();
    if (!input) return;
    setBusy('pdf');
    try {
      downloadPartnerStatementPdf(await createPartnerStatementPdf(input), fileName);
      success(t('downloaded_ok'));
    } catch {
      errorToast(t('export_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function handleShare() {
    const input = pdfInput();
    if (!input) return;
    setBusy('share');
    try {
      const result = await sharePartnerStatementPdf(await createPartnerStatementPdf(input), fileName, t('title'));
      success(result === 'shared' ? t('shared_ok') : t('downloaded_ok'));
    } catch (error) {
      if ((error as Error).name !== 'AbortError') errorToast(t('export_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function handleXlsx() {
    if (!statement) return;
    setBusy('xlsx');
    try {
      await exportXlsx(fileName, {
        meta: [
          [t('supplier'), statement.partner.name],
          [t('period'), !filters.from && !filters.to ? t('all_periods') : `${filters.from || '…'} — ${filters.to || '…'}`],
          [t('opening_balance'), Number(statement.opening_balance)],
          [t('closing_balance'), Number(statement.closing_balance)],
        ],
        columns: [t('date'), t('entry_number'), t('description'), t('debit'), t('credit'), t('balance')],
        rows: statement.rows.map((row) => [row.date, row.number, row.description ?? '', Number(row.debit), Number(row.credit), Number(row.balance)]),
        sheetName: t('sheet_name'),
      });
      success(t('downloaded_ok'));
    } catch {
      errorToast(t('export_failed'));
    } finally {
      setBusy(null);
    }
  }

  if (loading && !statement) {
    return <div className="space-y-4"><Skeleton className="h-9 w-64" /><Skeleton className="h-16 w-full" /><Skeleton className="h-[560px] w-full" /></div>;
  }

  if (loadError || !statement || !supplier) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.push('/suppliers')}><ArrowRight className="h-4 w-4" strokeWidth={1.7} />{t('back_to_supplier')}</Button>
        <div className="border border-border bg-surface p-10 text-center"><p className="text-sm text-negative">{t('load_error')}</p><Button variant="outline" className="mt-3" onClick={() => void load()}><RefreshCw className="h-4 w-4" strokeWidth={1.7} />{t('retry')}</Button></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" className="no-print" onClick={() => router.push('/suppliers')} aria-label={t('back_to_supplier')}><ArrowRight className="h-4 w-4" strokeWidth={1.7} /></Button>
        <div className="min-w-0"><p className="text-xs text-muted">{supplier.name}</p><h1 className="text-xl font-semibold text-text">{t('title')}</h1></div>
        <div className="no-print ms-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void handleXlsx()} disabled={!!busy}><FileSpreadsheet className="h-4 w-4" strokeWidth={1.7} />{busy === 'xlsx' ? t('generating') : t('export_excel')}</Button>
          <Button variant="outline" size="sm" onClick={() => void handlePdf()} disabled={!!busy}><Download className="h-4 w-4" strokeWidth={1.7} />{busy === 'pdf' ? t('generating') : t('download_pdf')}</Button>
          <Button variant="outline" size="sm" onClick={() => void handleShare()} disabled={!!busy}><Share2 className="h-4 w-4" strokeWidth={1.7} />{busy === 'share' ? t('generating') : t('share_pdf')}</Button>
          <Button variant="outline" size="sm" onClick={() => printDocument(A4)} disabled={!!busy}><Printer className="h-4 w-4" strokeWidth={1.7} />{t('print')}</Button>
        </div>
      </div>

      <ReportFilters value={filters} onChange={setFilters} />

      <Card>
        <CardHeader className="no-print flex flex-row items-center justify-between gap-3"><div><CardTitle>{t('preview')}</CardTitle><p className="mt-1 text-xs text-muted">{t('preview_hint')}</p></div>{loading && <RefreshCw className="h-4 w-4 animate-spin text-muted" strokeWidth={1.7} aria-label={t('loading')} />}</CardHeader>
        <CardContent className="print:p-0"><div className="overflow-x-auto bg-slate-100 p-3 dark:bg-black/30 print:overflow-visible print:bg-transparent print:p-0"><PartnerStatementDocument statement={statement} company={company} filters={filters} translationNamespace="supplierStatement" creditBalance closingBalanceLabel={t('closing_credit_balance')} /></div></CardContent>
      </Card>
    </div>
  );
}
