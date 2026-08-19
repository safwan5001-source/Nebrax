'use client';

/**
 * أسلوب «دفتر التحليل»: كشف الحساب يعرض نطاقه وأرصدته وحركاته على الشاشة أولاً؛
 * المستند الورقي يبقى معاينة مستقلة عند الطلب ولا يزاحم القراءة اليومية.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, Download, FileSpreadsheet, FileText, Printer, RefreshCw, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { ReportFilters, filtersToQuery, EMPTY_FILTERS, type ReportFilterState } from '@/components/reports/report-filters';
import {
  PartnerStatementDocument,
  type PartnerStatementData,
} from '@/components/partners/partner-statement-document';
import { printDocument } from '@/modules/documents/services/export';
import {
  createPartnerStatementPdf,
  downloadPartnerStatementPdf,
  sharePartnerStatementPdf,
} from '@/modules/partners/services/statement-pdf';
import { exportXlsx } from '@/lib/xlsx';
import { api } from '@/lib/api';
import { useCompany } from '@/lib/company';
import { formatRiyal } from '@/lib/money';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ReportMetricGrid, ReportMobileRows, ReportScreenHeader } from '@/components/reports/report-workspace-ui';

interface Partner {
  id: string;
  name: string;
  type: string;
}

type BusyAction = 'pdf' | 'share' | 'xlsx' | null;
const A4 = { widthMm: 210, heightMm: 297 };

/**
 * كشف حساب طرف مستقل عن ملف العميل؛ يشارك مصدر مستند واحد بين المعاينة والطباعة وPDF.
 * المرشحات تُرسل مباشرةً لمحرك التقارير الذي يحسب الرصيد الافتتاحي والجاري في الخلفية.
 */
export default function PartnerStatementPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('partnerStatement');
  const locale = useLocale();
  const { success, error: errorToast } = useToast();
  const company = useCompany();

  const [partner, setPartner] = useState<Partner | null>(null);
  const [statement, setStatement] = useState<PartnerStatementData | null>(null);
  const [filters, setFilters] = useState<ReportFilterState>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [showPreview, setShowPreview] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [partnerResult, statementResult] = await Promise.all([
        api<{ data: Partner }>(`/partners/${id}`),
        api<PartnerStatementData>(`/reports/partner-statement/${id}${filtersToQuery(filters)}`),
      ]);
      setPartner(partnerResult.data);
      setStatement(statementResult);
    } catch {
      setLoadError(true);
      setStatement(null);
    } finally {
      setLoading(false);
    }
  }, [filters, id]);

  useEffect(() => { void load(); }, [load]);

  const fileName = useMemo(() => {
    const safeName = (partner?.name ?? 'customer-statement').replace(/[\\/:*?"<>|]/g, '-').trim();
    return `${t('file_prefix')}-${safeName || 'customer'}`;
  }, [partner?.name, t]);

  const pdfInput = () => statement ? ({
    statement,
    company,
    filters,
    locale,
    labels: {
      title: t('title'),
      customer: t('customer'),
      period: t('period'),
      allPeriods: t('all_periods'),
      branchScope: t('branch_scope'),
      allBranches: t('all_branches'),
      selectedBranches: (count: number) => t('branches_selected', { count }),
      openingBalance: t('opening_balance'),
      totalDebit: t('debit'),
      totalCredit: t('credit'),
      closingBalance: t('closing_balance'),
      date: t('date'),
      entryNumber: t('entry_number'),
      description: t('description'),
      debit: t('debit'),
      credit: t('credit'),
      balance: t('balance'),
      generatedAt: t('generated_at'),
      vatNumber: t('vat_number'),
      crNumber: t('cr_number'),
      footer: t('footer_note'),
      currency: t('currency'),
      empty: t('empty'),
    },
  }) : null;

  async function handlePdf() {
    const input = pdfInput();
    if (!input) return;
    setBusy('pdf');
    try {
      const blob = await createPartnerStatementPdf(input);
      downloadPartnerStatementPdf(blob, fileName);
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
      const blob = await createPartnerStatementPdf(input);
      const result = await sharePartnerStatementPdf(blob, fileName, t('title'));
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
          [t('customer'), statement.partner.name],
          [t('period'), !filters.from && !filters.to ? t('all_periods') : `${filters.from || '…'} — ${filters.to || '…'}`],
          [t('opening_balance'), Number(statement.opening_balance)],
          [t('closing_balance'), Number(statement.closing_balance)],
        ],
        columns: [t('date'), t('entry_number'), t('description'), t('debit'), t('credit'), t('balance')],
        rows: statement.rows.map((row) => [
          row.date,
          row.number,
          row.description ?? '',
          Number(row.debit),
          Number(row.credit),
          Number(row.balance),
        ]),
        sheetName: t('sheet_name'),
      });
      success(t('downloaded_ok'));
    } catch {
      errorToast(t('export_failed'));
    } finally {
      setBusy(null);
    }
  }

  const scope = useMemo(() => {
    const period = !filters.from && !filters.to ? t('all_periods') : [filters.from || '…', filters.to || '…'].join(' ← ');
    const branches = filters.branchIds.length === 0 ? t('all_branches') : t('branches_selected', { count: filters.branchIds.length });
    return `${branches} · ${period}`;
  }, [filters.branchIds, filters.from, filters.to, t]);

  const statementColumns = [
    { label: t('date') }, { label: t('entry_number') }, { label: t('description') },
    { label: t('debit'), align: 'end' as const }, { label: t('credit'), align: 'end' as const }, { label: t('balance'), align: 'end' as const },
  ];
  const statementRows = statement?.rows.map((row) => [
    row.date, row.number, row.description ?? '—',
    row.debit !== '0.00' ? formatRiyal(row.debit) : '—', row.credit !== '0.00' ? formatRiyal(row.credit) : '—', formatRiyal(row.balance),
  ]) ?? [];
  const actions = [
    { id: 'xlsx', label: busy === 'xlsx' ? t('generating') : t('export_excel'), icon: FileSpreadsheet, onSelect: () => void handleXlsx(), disabled: !!busy, busy: busy === 'xlsx' },
    { id: 'pdf', label: busy === 'pdf' ? t('generating') : t('download_pdf'), icon: Download, onSelect: () => void handlePdf(), disabled: !!busy, busy: busy === 'pdf' },
    { id: 'share', label: busy === 'share' ? t('generating') : t('share_pdf'), icon: Share2, onSelect: () => void handleShare(), disabled: !!busy, busy: busy === 'share' },
    { id: 'print', label: t('print'), icon: Printer, onSelect: () => printDocument(A4), disabled: !!busy },
    { id: 'preview', label: t('preview'), icon: FileText, onSelect: () => setShowPreview((visible) => !visible), disabled: !statement },
  ];

  if (loading && !statement) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-[560px] w-full" />
      </div>
    );
  }

  if (loadError || !statement || !partner) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.push(`/partners/${id}`)}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
          {t('back_to_customer')}
        </Button>
        <div className="border border-border bg-surface p-10 text-center">
          <p className="text-sm text-negative">{t('load_error')}</p>
          <Button variant="outline" className="mt-3" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" strokeWidth={1.7} />
            {t('retry')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="no-print flex items-center gap-3">
        <Button variant="ghost" size="icon" className="no-print" onClick={() => router.push(`/partners/${id}`)} aria-label={t('back_to_customer')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
      </div>

      <ReportScreenHeader title={t('title')} description={partner.name} scope={scope} actions={actions} actionsLabel={t('report_actions')} />

      <ReportFilters value={filters} onChange={setFilters} />

      <ReportMetricGrid metrics={[
        { label: t('opening_balance'), value: formatRiyal(statement.opening_balance) },
        { label: t('closing_balance'), value: formatRiyal(statement.closing_balance) },
      ]} />

      <Card>
        <CardHeader className="no-print flex flex-row items-center justify-between gap-3">
          <CardTitle>{t('entries')}</CardTitle>
          {loading && <RefreshCw className="h-4 w-4 animate-spin text-muted" strokeWidth={1.7} aria-label={t('loading')} />}
        </CardHeader>
        <CardContent>
          <ReportMobileRows columns={statementColumns} rows={statementRows} emptyText={t('empty')} primaryIndex={2} secondaryIndex={0} />
          <Table className="hidden md:table">
            <THead><TR>{statementColumns.map((column) => <TH key={column.label} className={column.align === 'end' ? 'text-end' : undefined}>{column.label}</TH>)}</TR></THead>
            <TBody>{statementRows.map((row, rowIndex) => <TR key={`${row[1]}-${rowIndex}`}>{row.map((cell, index) => <TD key={index} className={statementColumns[index]?.align === 'end' ? 'num text-end' : undefined}>{cell}</TD>)}</TR>)}</TBody>
          </Table>
        </CardContent>
      </Card>

      {showPreview && (
        <Card>
          <CardHeader className="no-print"><CardTitle>{t('preview')}</CardTitle></CardHeader>
          <CardContent className="print:p-0"><div className="overflow-x-auto bg-background p-3 print:overflow-visible print:bg-transparent print:p-0"><PartnerStatementDocument statement={statement} company={company} filters={filters} /></div></CardContent>
        </Card>
      )}
    </div>
  );
}
