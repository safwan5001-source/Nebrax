'use client';

/** أسلوب «دفتر التحليل»: تفاصيل قابلة للقراءة أولاً، ومستند الطباعة إجراء اختياري. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Download, Eye, EyeOff, Printer, Share2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ReportFilters, EMPTY_FILTERS, filtersToQuery, type ReportFilterState } from '@/components/reports/report-filters';
import { ReportDocument, type ReportColumn } from '@/components/reports/report-document';
import { ReportMobileRows } from '@/components/reports/report-workspace-ui';
import { StructuredFinancialStatement, type FinancialStatementSection, type FinancialStatementValue } from '@/components/reports/structured-financial-statement';
import { compareAmounts, comparisonPeriod, type ComparisonMode } from '@/components/reports/financial-comparison';
import { ReportDataTable, defaultReportTableLabels, type ReportTableViewState } from '@/components/reports/report-data-table';
import { ReportSavedViewsMenu, useSavedReportViews } from '@/components/reports/report-saved-views';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import { printDocument } from '@/modules/documents/services/export';
import { createReportPdf, downloadReportPdf, shareReportPdf } from '@/modules/reports/services/report-pdf';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { toCsv, downloadCsv } from '@/lib/export';
import { useCompany } from '@/lib/company';
import { useToast } from '@/components/ui/toast';

export type GeneralAdvancedReportTab = 'ledger' | 'journal' | 'cashflow' | 'tax';

interface Props {
  tab: GeneralAdvancedReportTab;
  heading: string;
}

interface Account { id: string; code: string; name: string }
interface LedgerRow { date: string; number: string; description: string; debit: string; credit: string; balance: string }
interface Ledger { account: Account; opening_balance: string; closing_balance: string; rows: LedgerRow[] }
interface JournalLine { account_id: string; account_code: string | null; account_name: string | null; description: string | null; debit: string; credit: string }
interface JournalEntry { entry_id: string; date: string; number: string; description: string; debit: string; credit: string; lines: JournalLine[] }
interface JournalReport { rows: JournalEntry[]; total_debit: string; total_credit: string }
interface CashEntry { date: string; number: string; description: string; inflow: string; outflow: string; net: string }
interface CashSection { inflows: string; outflows: string; net: string; entries: CashEntry[] }
interface CashFlow { operating: CashSection; investing: CashSection; financing: CashSection; net_cash_flow: string }
interface TaxReport { input_vat: string; output_vat: string; net_vat: string; status: 'payable' | 'recoverable' }
interface ReportDoc { title: string; columns: ReportColumn[]; rows: string[][]; totalRow?: string[]; exportName: string }

function appendAccount(query: string, accountId: string): string {
  if (!accountId) return query;
  return `${query || '?'}${query ? '&' : ''}account_id=${encodeURIComponent(accountId)}`;
}

export function GeneralAdvancedReportsWorkspace({ tab, heading }: Props) {
  const t = useTranslations('reports');
  const g = useTranslations('reports.general');
  const tPrint = useTranslations('documentPrint');
  const tReport = useTranslations('reportDoc');
  const locale = useLocale();
  const company = useCompany();
  const { success, error: toastError } = useToast();
  const [filters, setFilters] = useState<ReportFilterState>(EMPTY_FILTERS);
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>('none');
  const [comparisonCashFlow, setComparisonCashFlow] = useState<CashFlow | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonFailed, setComparisonFailed] = useState(false);
  const requestGeneration = useRef(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<null | 'pdf' | 'share'>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [journal, setJournal] = useState<JournalReport | null>(null);
  const [cashFlow, setCashFlow] = useState<CashFlow | null>(null);
  const [tax, setTax] = useState<TaxReport | null>(null);

  useEffect(() => {
    if (tab !== 'ledger' || accounts.length > 0) return;
    api<{ data: Account[] }>('/accounts').then((response) => setAccounts(response.data)).catch(() => setAccounts([]));
  }, [accounts.length, tab]);

  const cashFlowComparisonScope = useMemo(() => tab === 'cashflow' ? comparisonPeriod(comparisonMode, { from: filters.from, to: filters.to }) : null, [comparisonMode, filters, tab]);

  const load = useCallback(() => {
    const generation = ++requestGeneration.current;
    setFailed(false);
    setComparisonFailed(false);
    setComparisonLoading(false);
    if (tab === 'ledger' && !accountId) {
      setLoading(false);
      setLedger(null);
      return;
    }

    setLoading(true);
    const query = filtersToQuery(filters);
    const complete = () => { if (requestGeneration.current === generation) setLoading(false); };

    if (tab === 'cashflow' && cashFlowComparisonScope) {
      setComparisonCashFlow(null);
      setComparisonLoading(true);
      const currentRequest = api<CashFlow>(`/reports/cash-flow${query}`);
      const comparisonRequest = api<CashFlow>(`/reports/cash-flow${filtersToQuery({ ...filters, ...cashFlowComparisonScope })}`);
      Promise.allSettled([currentRequest, comparisonRequest]).then(([current, comparison]) => {
        if (requestGeneration.current !== generation) return;
        if (current.status !== 'fulfilled') {
          setComparisonCashFlow(null);
          setFailed(true);
          return;
        }
        setCashFlow(current.value);
        if (comparison.status === 'fulfilled') setComparisonCashFlow(comparison.value);
        else setComparisonFailed(true);
      }).finally(() => {
        if (requestGeneration.current === generation) {
          setComparisonLoading(false);
          complete();
        }
      });
      return;
    }

    let request: Promise<unknown>;
    if (tab === 'ledger') request = api<Ledger>(`/reports/account-ledger/${accountId}${appendAccount(query, accountId)}`).then((value) => requestGeneration.current === generation && setLedger(value));
    else if (tab === 'journal') request = api<JournalReport>(`/reports/journal-entries${query}`).then((value) => requestGeneration.current === generation && setJournal(value));
    else if (tab === 'cashflow') request = api<CashFlow>(`/reports/cash-flow${query}`).then((value) => requestGeneration.current === generation && setCashFlow(value));
    else request = api<TaxReport>(`/reports/tax-report${query}`).then((value) => requestGeneration.current === generation && setTax(value));

    request.catch(() => requestGeneration.current === generation && setFailed(true)).finally(complete);
  }, [accountId, cashFlowComparisonScope, filters, tab]);

  useEffect(() => load(), [load]);

  useEffect(() => {
    if (comparisonMode !== 'none' && !cashFlowComparisonScope && tab === 'cashflow') setComparisonMode('none');
  }, [cashFlowComparisonScope, comparisonMode, tab]);

  const doc = useMemo<ReportDoc | null>(() => {
    if (tab === 'ledger') {
      if (!ledger) return null;
      return {
        title: heading,
        columns: [{ label: g('date') }, { label: g('entryNumber') }, { label: g('description') }, { label: g('debit'), align: 'end' }, { label: g('credit'), align: 'end' }, { label: g('balance'), align: 'end' }],
        rows: ledger.rows.map((row) => [row.date, row.number, row.description, formatRiyal(row.debit), formatRiyal(row.credit), formatRiyal(row.balance)]),
        totalRow: ['', '', g('closingBalance'), '', '', formatRiyal(ledger.closing_balance)],
        exportName: `account-ledger-${ledger.account.code}`,
      };
    }
    if (tab === 'journal') {
      if (!journal) return null;
      return {
        title: heading,
        columns: [{ label: g('date') }, { label: g('entryNumber') }, { label: g('entryLines') }, { label: g('debit'), align: 'end' }, { label: g('credit'), align: 'end' }],
        rows: journal.rows.flatMap((entry) => entry.lines.map((line, index) => [
          index === 0 ? entry.date : '',
          index === 0 ? entry.number : '',
          `${line.account_code ?? ''} ${line.account_name ?? ''}`.trim(),
          formatRiyal(line.debit),
          formatRiyal(line.credit),
        ])),
        totalRow: ['', '', t('total'), formatRiyal(journal.total_debit), formatRiyal(journal.total_credit)],
        exportName: 'journal-entries',
      };
    }
    if (tab === 'cashflow') {
      if (!cashFlow) return null;
      const sections: Array<[keyof Pick<CashFlow, 'operating' | 'investing' | 'financing'>, string]> = [
        ['operating', g('operating')], ['investing', g('investing')], ['financing', g('financing')],
      ];
      return {
        title: heading,
        columns: [{ label: t('item') }, { label: g('date') }, { label: g('entryNumber') }, { label: g('description') }, { label: g('inflows'), align: 'end' }, { label: g('outflows'), align: 'end' }, { label: g('netCashFlow'), align: 'end' }],
        rows: sections.flatMap(([key, label]) => cashFlow[key].entries.map((entry) => [label, entry.date, entry.number, entry.description, formatRiyal(entry.inflow), formatRiyal(entry.outflow), formatRiyal(entry.net)])),
        totalRow: ['', '', '', g('netCashFlow'), '', '', formatRiyal(cashFlow.net_cash_flow)],
        exportName: 'cash-flow-direct',
      };
    }
    if (!tax) return null;
    return {
      title: heading,
      columns: [{ label: t('item') }, { label: t('amount'), align: 'end' }],
      rows: [[g('inputVat'), formatRiyal(tax.input_vat)], [g('outputVat'), formatRiyal(tax.output_vat)]],
      totalRow: [g('netVat'), formatRiyal(tax.net_vat)],
      exportName: 'vat-report',
    };
  }, [cashFlow, g, heading, journal, ledger, t, tab, tax]);

  function exportCsv() {
    if (!doc) return;
    downloadCsv(doc.exportName, toCsv(doc.columns.map((column) => column.label), [...doc.rows, ...(doc.totalRow ? [doc.totalRow] : [])]));
  }

  async function createPdf() {
    if (!doc) throw new Error(g('loadFailed'));
    return createReportPdf({
      ...doc,
      company,
      labels: { asOf: tReport('as_of'), vatNumber: tReport('vat_number'), crNumber: tPrint('cr_number'), footer: tReport('footer'), empty: t('empty') },
      locale,
    });
  }

  async function downloadPdf() {
    if (!doc) return;
    setBusy('pdf');
    try { downloadReportPdf(await createPdf(), doc.exportName); success(tPrint('downloaded_ok')); }
    catch { toastError(tPrint('export_failed')); }
    finally { setBusy(null); }
  }

  async function sharePdf() {
    if (!doc) return;
    setBusy('share');
    try {
      const result = await shareReportPdf(await createPdf(), doc.exportName, doc.title);
      success(result === 'shared' ? tPrint('shared_ok') : tPrint('downloaded_ok'));
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') toastError(tPrint('export_failed'));
    } finally { setBusy(null); }
  }

  const selectedLedger = tab === 'ledger' && !accountId;
  const reportBody = failed ? (
    <Card><CardContent className="flex flex-col items-center gap-3 py-10 text-center"><p className="text-sm text-muted">{g('loadFailed')}</p><Button variant="outline" size="sm" onClick={load}>{g('retry')}</Button></CardContent></Card>
  ) : selectedLedger ? (
    <Card><CardContent className="py-10 text-center text-sm text-muted">{g('selectAccount')}</CardContent></Card>
  ) : tab === 'ledger' ? <LedgerTable ledger={ledger} loading={loading} g={g} />
    : tab === 'journal' ? <JournalTable journal={journal} loading={loading} g={g} t={t} />
    : tab === 'cashflow' ? <CashFlowTable cashFlow={cashFlow} comparisonCashFlow={comparisonCashFlow} loading={loading} g={g} t={t} emptyLabel={t('empty')} />
    : <TaxCard tax={tax} loading={loading} g={g} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-text">{heading}</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={!doc || !!busy} onClick={exportCsv}><Download className="h-4 w-4" strokeWidth={1.7} />{t('csv')}</Button>
          <Button variant="outline" size="sm" disabled={!doc || !!busy} onClick={downloadPdf}><Download className="h-4 w-4" strokeWidth={1.7} />{busy === 'pdf' ? tPrint('generating') : t('pdf')}</Button>
          <Button variant="outline" size="sm" disabled={!doc || !!busy} onClick={sharePdf}><Share2 className="h-4 w-4" strokeWidth={1.7} />{busy === 'share' ? tPrint('generating') : t('share_pdf')}</Button>
          <Button variant="outline" size="sm" disabled={!doc || !!busy} onClick={() => printDocument({ widthMm: 210, heightMm: 297 })}><Printer className="h-4 w-4" strokeWidth={1.7} />{t('print')}</Button>
          <Button variant="outline" size="sm" disabled={!doc} aria-pressed={showPreview} onClick={() => setShowPreview((visible) => !visible)}>{showPreview ? <EyeOff className="h-4 w-4" strokeWidth={1.7} /> : <Eye className="h-4 w-4" strokeWidth={1.7} />}{t('preview')}</Button>
        </div>
      </div>

      <ReportFilters
        value={filters}
        onChange={setFilters}
        comparison={tab === 'cashflow' ? {
          value: comparisonMode,
          onChange: setComparisonMode,
          previousPeriodDisabled: !filters.from || !filters.to,
          previousYearDisabled: !filters.from || !filters.to,
        } : undefined}
      />
      {cashFlowComparisonScope && <p className="no-print rounded border border-border bg-background px-3 py-2 text-xs leading-relaxed text-muted" aria-live="polite">{`${t('current_period')}: ${filters.from} ← ${filters.to} · ${t('comparison_period')}: ${cashFlowComparisonScope.from} ← ${cashFlowComparisonScope.to}`}</p>}
      {comparisonLoading && <p className="no-print text-xs text-muted" role="status">{t('comparison_loading')}</p>}
      {comparisonFailed && <p className="no-print rounded border border-warning/30 bg-background px-3 py-2 text-xs leading-relaxed text-text" role="alert">{t('comparison_failed')}</p>}
      {tab === 'cashflow' && comparisonMode !== 'none' && <p className="no-print text-xs text-muted">{t('comparison_screen_only')}</p>}
      {tab === 'ledger' && (
        <Card className="no-print"><CardContent className="pt-5"><div className="max-w-md space-y-1.5"><label htmlFor="ledger-account" className="text-sm font-medium text-text">{g('account')}</label><Select id="ledger-account" value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">{g('allAccounts')}</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</Select></div></CardContent></Card>
      )}
      {tab === 'cashflow' && <p className="rounded border border-border bg-background p-3 text-xs leading-relaxed text-muted">{g('directCashFlowHint')}</p>}
      {tab === 'tax' && <p className="rounded border border-border bg-background p-3 text-xs leading-relaxed text-muted">{g('taxHint')}</p>}
      {reportBody}

      {showPreview && doc && <Card><CardHeader className="no-print"><CardTitle>{t('preview')}</CardTitle></CardHeader><CardContent className="print:p-0"><div className="rounded bg-background p-3 print:bg-transparent print:p-0 [&_.print-only]:block"><DocumentScaler><ReportDocument title={doc.title} company={company} columns={doc.columns} rows={doc.rows} totalRow={doc.totalRow} /></DocumentScaler></div></CardContent></Card>}
    </div>
  );
}

function LedgerTable({ ledger, loading, g }: { ledger: Ledger | null; loading: boolean; g: ReturnType<typeof useTranslations> }) {
  const locale = useLocale();
  const defaultViewState = useMemo<ReportTableViewState>(() => ({ columnVisibility: {}, sorting: [], density: 'compact', pageSize: 25, columnOrder: [], columnSizing: {} }), []);
  const savedViews = useSavedReportViews('general:account-ledger', defaultViewState);
  if (loading || !ledger) return <Card><CardContent><Skeleton className="h-40 w-full" /></CardContent></Card>;
  const columns = [
    { id: 'date', label: g('date'), hideable: false, size: 132, minSize: 112, maxSize: 180 },
    { id: 'number', label: g('entryNumber'), size: 144, minSize: 120, maxSize: 220 },
    { id: 'description', label: g('description'), size: 320, minSize: 180, maxSize: 520, wrap: true },
    { id: 'debit', label: g('debit'), align: 'end' as const, numeric: true },
    { id: 'credit', label: g('credit'), align: 'end' as const, numeric: true },
    { id: 'balance', label: g('balance'), align: 'end' as const, numeric: true },
  ];
  const rows = ledger.rows.map((row) => [
    row.date,
    row.number,
    row.description,
    formatRiyal(row.debit),
    formatRiyal(row.credit),
    formatRiyal(row.balance),
  ]);
  return <Card>
    <CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle>{ledger.account.name}</CardTitle><Badge tone="neutral" className="num">{g('closingBalance')}: {formatRiyal(ledger.closing_balance)}</Badge></CardHeader>
    <CardContent>
      {savedViews.loaded && <div className="no-print mb-3 flex justify-end md:hidden"><ReportSavedViewsMenu controller={savedViews} locale={locale} /></div>}
      <div className="space-y-3 md:hidden">
        <div className="flex items-center justify-between gap-3 rounded-lg bg-background px-3 py-2.5 text-sm"><span className="text-muted">{g('openingBalance')}</span><strong className="num">{formatRiyal(ledger.opening_balance)}</strong></div>
        {ledger.rows.length === 0 ? <p className="py-8 text-center text-sm text-muted">—</p> : ledger.rows.map((row) => <article key={`${row.number}-${row.date}`} className="rounded-xl border border-border bg-surface p-3"><div className="mb-2 flex items-start justify-between gap-3"><div><p className="num text-xs text-muted">{row.date}</p><p className="num mt-1 text-sm font-medium text-text">{row.number}</p></div><strong className="num text-sm">{formatRiyal(row.balance)}</strong></div><p className="mb-3 text-sm leading-5 text-text">{row.description}</p><dl className="grid grid-cols-2 gap-2 border-t border-border pt-2 text-xs"><div><dt className="text-muted">{g('debit')}</dt><dd className="num mt-1 font-medium">{formatRiyal(row.debit)}</dd></div><div><dt className="text-muted">{g('credit')}</dt><dd className="num mt-1 font-medium">{formatRiyal(row.credit)}</dd></div></dl></article>)}
        <div className="flex items-center justify-between gap-3 rounded-lg bg-background px-3 py-2.5 text-sm font-semibold"><span>{g('closingBalance')}</span><strong className="num">{formatRiyal(ledger.closing_balance)}</strong></div>
      </div>
      <div className="hidden md:block">
        <div className="mb-3 flex items-center justify-between gap-3 rounded border border-border bg-background px-3 py-2.5 text-sm">
          <span className="text-muted">{g('openingBalance')}</span>
          <strong className="num">{formatRiyal(ledger.opening_balance)}</strong>
        </div>
        <ReportDataTable
          columns={columns}
          rows={rows}
          totalRow={['', '', g('closingBalance'), '', '', formatRiyal(ledger.closing_balance)]}
          labels={defaultReportTableLabels(locale)}
          emptyText="—"
          viewState={savedViews.viewState}
          onViewStateChange={savedViews.setViewState}
          toolbarAddon={savedViews.loaded ? <ReportSavedViewsMenu controller={savedViews} locale={locale} /> : undefined}
          resizeDirection={locale.toLowerCase().startsWith('ar') ? 'rtl' : 'ltr'}
        />
      </div>
    </CardContent>
  </Card>;
}

export function JournalTable({ journal, loading, g, t }: { journal: JournalReport | null; loading: boolean; g: ReturnType<typeof useTranslations>; t: ReturnType<typeof useTranslations> }) {
  const openDetailsLabel = defaultReportTableLabels(useLocale()).openDetails;
  if (loading || !journal) return <Card><CardContent><Skeleton className="h-40 w-full" /></CardContent></Card>;
  const totalDebit = formatRiyal(journal.total_debit);
  const totalCredit = formatRiyal(journal.total_credit);

  return <Card><CardHeader><CardTitle>{g('journalEntries')}</CardTitle></CardHeader><CardContent>
    {journal.rows.length === 0 ? <p className="py-8 text-center text-sm text-muted">{t('empty')}</p> : <>
      <div className="space-y-3 md:hidden">
        {journal.rows.map((entry) => (
          <article key={entry.entry_id} className="rounded border border-border bg-surface p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="num text-xs text-muted">{entry.date}</p>
                <p className="num mt-1 text-sm font-semibold text-text">{entry.number}</p>
                <Link href={`/journal-entries/${entry.entry_id}`} prefetch={false} className="mt-2 inline-flex min-h-10 items-center text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={`${openDetailsLabel}: ${entry.number}`}>
                  {openDetailsLabel}
                </Link>
              </div>
            </div>
            {entry.description && <p className="mt-2 text-sm leading-5 text-text">{entry.description}</p>}
            <div className="mt-3 divide-y divide-border border-y border-border">
              {entry.lines.map((line, lineIndex) => (
                <div key={`${entry.entry_id}-${line.account_id}-${lineIndex}`} className="py-3 first:pt-2 last:pb-2">
                  <p className="text-sm font-medium text-text">{`${line.account_code ?? ''} — ${line.account_name ?? ''}`.trim() || '—'}</p>
                  {line.description && <p className="mt-1 text-xs text-muted">{line.description}</p>}
                  <dl className="mt-2 grid grid-cols-2 gap-3 text-xs">
                    <div><dt className="text-muted">{g('debit')}</dt><dd className="num mt-1 font-medium text-text">{formatRiyal(line.debit)}</dd></div>
                    <div><dt className="text-muted">{g('credit')}</dt><dd className="num mt-1 font-medium text-text">{formatRiyal(line.credit)}</dd></div>
                  </dl>
                </div>
              ))}
            </div>
          </article>
        ))}
        <article className="rounded border border-primary/25 bg-primary-soft p-3.5">
          <p className="text-sm font-semibold text-text">{t('total')}</p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div><dt className="text-muted">{g('debit')}</dt><dd className="num mt-1 font-semibold text-text">{totalDebit}</dd></div>
            <div><dt className="text-muted">{g('credit')}</dt><dd className="num mt-1 font-semibold text-text">{totalCredit}</dd></div>
          </dl>
        </article>
      </div>

      <div className="hidden overflow-hidden rounded border border-border bg-surface md:block">
        <div className="max-h-[62vh] overflow-auto">
          <Table>
            <THead className="sticky top-0 z-10 bg-surface">
              <TR>
                <TH scope="col">{g('date')}</TH>
                <TH scope="col">{g('entryNumber')}</TH>
                <TH scope="col">{g('description')}</TH>
                <TH scope="col" className="text-end">{g('debit')}</TH>
                <TH scope="col" className="text-end">{g('credit')}</TH>
              </TR>
            </THead>
            {journal.rows.map((entry) => (
              <TBody key={entry.entry_id} className="border-b-2 border-border last:border-0">
                {entry.lines.map((line, lineIndex) => (
                  <TR key={`${entry.entry_id}-${line.account_id}-${lineIndex}`}>
                    <TD className="num align-top">{lineIndex === 0 ? entry.date : ''}</TD>
                    <TD className="num align-top">{lineIndex === 0 ? <Link href={`/journal-entries/${entry.entry_id}`} prefetch={false} className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={`${openDetailsLabel}: ${entry.number}`}>{entry.number}</Link> : ''}</TD>
                    <TD>{`${line.account_code ?? ''} — ${line.account_name ?? ''}`.trim() || '—'}{line.description && <p className="mt-1 text-xs text-muted">{line.description}</p>}</TD>
                    <TD className="num text-end">{formatRiyal(line.debit)}</TD>
                    <TD className="num text-end">{formatRiyal(line.credit)}</TD>
                  </TR>
                ))}
              </TBody>
            ))}
            <tfoot className="sticky bottom-0 border-t border-primary/20 bg-primary-soft font-semibold text-text">
              <TR>
                <TD />
                <TD />
                <TD>{t('total')}</TD>
                <TD className="num text-end">{totalDebit}</TD>
                <TD className="num text-end">{totalCredit}</TD>
              </TR>
            </tfoot>
          </Table>
        </div>
      </div>
    </>}
  </CardContent></Card>;
}

function comparativeValues(current: string, comparison: string): FinancialStatementValue[] {
  const values = compareAmounts(current, comparison);
  return [
    { id: 'current', amount: values.current },
    { id: 'comparison', amount: values.comparison },
    { id: 'variance', amount: values.variance },
    { id: 'variance-percent', amount: values.variancePercent ?? '—' },
  ];
}

export function CashFlowTable({ cashFlow, comparisonCashFlow, loading, g, t, emptyLabel }: { cashFlow: CashFlow | null; comparisonCashFlow: CashFlow | null; loading: boolean; g: ReturnType<typeof useTranslations>; t: ReturnType<typeof useTranslations>; emptyLabel: string }) {
  const sections: Array<[keyof Pick<CashFlow, 'operating' | 'investing' | 'financing'>, string]> = [['operating', g('operating')], ['investing', g('investing')], ['financing', g('financing')]];
  if (loading || !cashFlow) return <Card><CardContent><Skeleton className="h-40 w-full" /></CardContent></Card>;

  const statementSections: FinancialStatementSection[] = sections.map(([key, label]) => {
    const section = cashFlow[key];
    return {
      id: key,
      label,
      rows: [
        ...(section.entries.length > 0
          ? section.entries.map((entry) => ({
            id: `${key}-${entry.date}-${entry.number}`,
            kind: 'detail' as const,
            code: `${entry.date} · ${entry.number}`,
            label: entry.description || entry.number,
            values: [
              { id: 'inflows', amount: entry.inflow },
              { id: 'outflows', amount: entry.outflow },
              { id: 'net', amount: entry.net, tone: 'auto' as const },
            ],
          }))
          : [{ id: `${key}-empty`, kind: 'empty' as const, label: emptyLabel }]),
        ...(comparisonCashFlow ? [] : [{
          id: `${key}-net`,
          kind: 'subtotal' as const,
          label: `${label} — ${g('netCashFlow')}`,
          values: [
            { id: 'inflows', amount: section.inflows },
            { id: 'outflows', amount: section.outflows },
            { id: 'net', amount: section.net, tone: 'auto' as const },
          ],
        }]),
      ],
    };
  });

  const netTone = Number(cashFlow.net_cash_flow) === 0 ? 'neutral' : Number(cashFlow.net_cash_flow) > 0 ? 'positive' : 'negative';
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{g('cashFlow')}</CardTitle>
        <Badge tone={netTone} className="num">{formatRiyal(cashFlow.net_cash_flow)}</Badge>
      </CardHeader>
      <CardContent>
        <StructuredFinancialStatement
          descriptionLabel={g('description')}
          columns={[
            { id: 'inflows', label: g('inflows') },
            { id: 'outflows', label: g('outflows') },
            { id: 'net', label: g('netCashFlow') },
          ]}
          sections={statementSections}
          grandTotal={comparisonCashFlow ? undefined : { id: 'net-cash-flow', kind: 'grand-total', label: g('netCashFlow'), values: [{ id: 'net', amount: cashFlow.net_cash_flow, tone: 'auto' }] }}
        />
        {comparisonCashFlow && (
          <div className="mt-4">
            <StructuredFinancialStatement
              descriptionLabel={g('description')}
              columns={[
                { id: 'current', label: t('current_amount'), priority: 'primary' },
                { id: 'comparison', label: t('comparison_amount'), priority: 'secondary' },
                { id: 'variance', label: t('variance'), priority: 'tertiary' },
                { id: 'variance-percent', label: t('variance_percent'), format: 'percentage', priority: 'tertiary' },
              ]}
              sections={[{
                id: 'cash-flow-comparison',
                label: t('comparison'),
                rows: sections.map(([key, label]) => ({
                  id: `${key}-comparison-net`,
                  kind: 'subtotal' as const,
                  label: `${label} — ${g('netCashFlow')}`,
                  values: comparativeValues(cashFlow[key].net, comparisonCashFlow[key].net),
                })),
              }]}
              grandTotal={{ id: 'comparative-net-cash-flow', kind: 'grand-total', label: g('netCashFlow'), values: comparativeValues(cashFlow.net_cash_flow, comparisonCashFlow.net_cash_flow) }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TaxCard({ tax, loading, g }: { tax: TaxReport | null; loading: boolean; g: ReturnType<typeof useTranslations> }) {
  const payable = tax?.status === 'payable';
  return <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle>{g('taxReport')}</CardTitle>{tax && <Badge tone={payable ? 'warning' : 'positive'}>{payable ? g('taxPayable') : g('taxRecoverable')}</Badge>}</CardHeader><CardContent>{loading || !tax ? <Skeleton className="h-32 w-full" /> : <dl className="divide-y divide-border rounded border border-border"><TaxRow label={g('outputVat')} amount={tax.output_vat} /><TaxRow label={g('inputVat')} amount={tax.input_vat} /><TaxRow label={g('netVat')} amount={tax.net_vat} strong /></dl>}</CardContent></Card>;
}

function TaxRow({ label, amount, strong = false }: { label: string; amount: string; strong?: boolean }) {
  return <div className={`flex items-center justify-between gap-4 px-4 py-3 ${strong ? 'font-semibold' : ''}`}><dt className="text-sm text-text">{label}</dt><dd className="num text-end">{formatRiyal(amount)}</dd></div>;
}
