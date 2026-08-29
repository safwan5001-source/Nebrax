'use client';

import Link from 'next/link';
import { formatDateTime } from '@/lib/formatting';

/**
 * أسلوب «دفتر التحليل»: حركة المورد تُعرض كنطاق ورصيد وحركات قابلة للبحث؛
 * لا تتزاحم إجراءات التصدير مع تفاصيل الحركة، والجوال يعتمد البطاقات المشتركة.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, Download, FileSpreadsheet, Printer, RefreshCw, Search, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { LedgerTable, type StatementRow } from '@/components/partners/partner-panels';
import { ReportFilters, filtersToQuery, EMPTY_FILTERS, type ReportFilterState } from '@/components/reports/report-filters';
import { createPartnerStatementPdf, downloadPartnerStatementPdf, sharePartnerStatementPdf } from '@/modules/partners/services/statement-pdf';
import { printDocument } from '@/modules/documents/services/export';
import { exportXlsx } from '@/lib/xlsx';
import { api } from '@/lib/api';
import { useCompany } from '@/lib/company';
import { formatRiyal } from '@/lib/money';
import { ReportMetricGrid, ReportScreenHeader } from '@/components/reports/report-workspace-ui';

interface Supplier {
  id: string;
  name: string;
  type: string;
}

interface LedgerStatement {
  partner: { id: string; name: string; type: string };
  opening_balance: string;
  rows: StatementRow[];
  closing_balance: string;
}

type BusyAction = 'pdf' | 'share' | 'xlsx' | null;
const A4 = { widthMm: 210, heightMm: 297 };

function supplierReportQuery(filters: ReportFilterState): string {
  const query = filtersToQuery(filters);
  return `${query}${query ? '&' : '?'}partner_role=supplier`;
}

/**
 * حركة حساب المورد: من قيود الأستاذ المرتبطة بالمورّد، لذلك تظل حركات الشراء
 * وسندات الصرف والتسويات داخل سياق الدائنين ولا تُعرض كحركة عميل.
 */
export default function SupplierLedgerPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('supplierLedger');
  const ts = useTranslations('supplierStatement');
  const locale = useLocale();
  const company = useCompany();
  const { success, error: errorToast } = useToast();

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [statement, setStatement] = useState<LedgerStatement | null>(null);
  const [filters, setFilters] = useState<ReportFilterState>(EMPTY_FILTERS);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [supplierResult, statementResult] = await Promise.all([
        api<{ data: Supplier }>(`/partners/${id}`),
        api<LedgerStatement>(`/reports/partner-statement/${id}${supplierReportQuery(filters)}`),
      ]);
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

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return statement?.rows ?? [];
    return (statement?.rows ?? []).filter((row) => [
      row.number, row.description, row.source?.label,
      ...(row.source?.allocations ?? []).flatMap((allocation) => [allocation.number, allocation.amount]),
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(term)));
  }, [query, statement?.rows]);

  const fileName = useMemo(() => {
    const safeName = (supplier?.name ?? 'supplier-ledger').replace(/[\\/:*?"<>|]/g, '-').trim();
    return `${t('file_prefix')}-${safeName || 'supplier'}`;
  }, [supplier?.name, t]);

  const exportData = () => statement ? {
    ...statement,
    rows: rows.map((row) => ({
      ...row,
      description: [row.source?.label, row.description, ...(row.source?.allocations ?? []).map((allocation) => `${allocation.number ?? '—'} · ${formatRiyal(allocation.amount)}`)].filter(Boolean).join(' — '),
    })),
  } : null;

  const pdfInput = () => {
    const data = exportData();
    return data ? {
      statement: data,
      company,
      filters,
      locale,
      labels: {
        title: t('title'), customer: ts('supplier'), period: ts('period'), allPeriods: ts('all_periods'),
        branchScope: ts('branch_scope'), allBranches: ts('all_branches'), selectedBranches: (count: number) => ts('branches_selected', { count }),
        openingBalance: ts('opening_balance'), totalDebit: ts('debit'), totalCredit: ts('credit'), closingBalance: ts('closing_credit_balance'), creditBalance: true,
        date: ts('date'), entryNumber: ts('entry_number'), description: ts('description'), debit: ts('debit'), credit: ts('credit'), balance: ts('balance'),
        generatedAt: t('generated_at'), vatNumber: ts('vat_number'), crNumber: ts('cr_number'), footer: t('footer'), currency: ts('currency'), empty: t('empty'),
      },
    } : null;
  };

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
        meta: [[ts('supplier'), statement.partner.name], [ts('opening_balance'), Number(statement.opening_balance)], [ts('closing_balance'), Number(statement.closing_balance)]],
        columns: [ts('date'), ts('entry_number'), t('source'), ts('description'), t('settlement'), ts('debit'), ts('credit'), ts('balance')],
        rows: rows.map((row) => [
          row.date, row.number, row.source?.label ?? '', row.description ?? '',
          (row.source?.allocations ?? []).map((allocation) => `${allocation.number ?? '—'} · ${allocation.amount}`).join(' | '),
          Number(row.debit), Number(row.credit), Number(row.balance),
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

  const sourceHref = (source: NonNullable<StatementRow['source']>) => {
    const routes: Record<string, string> = {
      purchase: `/purchases/${source.id}`,
      payment: '/supplier-payments',
      credit_note: '/debit-notes',
      return: '/purchase-returns',
    };
    return routes[source.kind];
  };
  const allocationHref = (allocation: NonNullable<StatementRow['source']>['allocations'][number]) => allocation.kind === 'purchase' ? `/purchases/${allocation.id}` : undefined;
  const scope = useMemo(() => {
    const period = !filters.from && !filters.to ? ts('all_periods') : [filters.from || '…', filters.to || '…'].join(' ← ');
    const branches = filters.branchIds.length === 0 ? ts('all_branches') : ts('branches_selected', { count: filters.branchIds.length });
    return `${branches} · ${period}`;
  }, [filters.branchIds, filters.from, filters.to, ts]);
  const actions = [
    { id: 'xlsx', label: busy === 'xlsx' ? t('generating') : t('export_excel'), icon: FileSpreadsheet, onSelect: () => void handleXlsx(), disabled: !!busy, busy: busy === 'xlsx' },
    { id: 'pdf', label: busy === 'pdf' ? t('generating') : t('download_pdf'), icon: Download, onSelect: () => void handlePdf(), disabled: !!busy, busy: busy === 'pdf' },
    { id: 'share', label: busy === 'share' ? t('generating') : t('share_pdf'), icon: Share2, onSelect: () => void handleShare(), disabled: !!busy, busy: busy === 'share' },
    { id: 'print', label: t('print'), icon: Printer, onSelect: () => printDocument(A4), disabled: !!busy },
  ];

  if (loading && !statement) return <div className="space-y-4"><Skeleton className="h-9 w-64" /><Skeleton className="h-16 w-full" /><Skeleton className="h-[560px] w-full" /></div>;

  if (loadError || !statement || !supplier) {
    return <div className="space-y-4"><Button asChild variant="ghost" size="sm"><Link href='/suppliers'><ArrowRight className="h-4 w-4" strokeWidth={1.7} />{t('back_to_supplier')}</Link></Button><div className="border border-border bg-surface p-10 text-center"><p className="text-sm text-negative">{t('load_error')}</p><Button variant="outline" className="mt-3" onClick={() => void load()}><RefreshCw className="h-4 w-4" strokeWidth={1.7} />{t('retry')}</Button></div></div>;
  }

  return (
    <div className="space-y-5">
      <div className="no-print flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="no-print" aria-label={t('back_to_supplier')}><Link href='/suppliers'><ArrowRight className="h-4 w-4" strokeWidth={1.7} /></Link></Button>
      </div>

      <ReportScreenHeader title={t('title')} description={supplier.name} scope={scope} actions={actions} actionsLabel={ts('report_actions')} />

      <ReportFilters value={filters} onChange={setFilters} />

      <ReportMetricGrid metrics={[
        { label: ts('opening_balance'), value: formatRiyal(statement.opening_balance) },
        { label: ts('closing_credit_balance'), value: formatRiyal(statement.closing_balance) },
      ]} />

      <Card>
        <CardHeader className="no-print"><CardTitle>{ts('entries')}</CardTitle><p className="mt-1 text-xs text-muted">{t('preview_hint')}</p></CardHeader>
        <CardContent className="space-y-3 print:p-0">
          <div className="no-print relative"><Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" strokeWidth={1.7} /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search')} aria-label={t('search')} className="h-10 ps-9" /></div>
          <div id="print-root" className="overflow-x-auto bg-surface"><div className="print-only border-b border-border px-6 py-5"><p className="text-xs text-muted">{supplier.name}</p><h2 className="mt-1 text-xl font-bold text-text">{t('title')}</h2><p className="mt-1 text-xs text-muted">{t('generated_at')}: {formatDateTime(new Date(), locale)}</p></div><LedgerTable opening={statement.opening_balance} rows={rows} sourceHref={sourceHref} allocationHref={allocationHref} creditBalance labels={{ date: ts('date'), number: ts('entry_number'), source: t('source'), description: ts('description'), settlement: t('settlement'), debit: ts('debit'), credit: ts('credit'), balance: ts('balance'), opening: ts('opening_balance'), empty: t('empty') }} /><p className="print-only border-t border-border px-6 py-3 text-xs text-muted">{t('footer')}</p></div>
        </CardContent>
      </Card>
    </div>
  );
}
