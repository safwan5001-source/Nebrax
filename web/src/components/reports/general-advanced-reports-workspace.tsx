'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Download, Printer, Share2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ReportFilters, EMPTY_FILTERS, filtersToQuery, type ReportFilterState } from '@/components/reports/report-filters';
import { ReportDocument, type ReportColumn } from '@/components/reports/report-document';
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
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<null | 'pdf' | 'share'>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [journal, setJournal] = useState<JournalReport | null>(null);
  const [cashFlow, setCashFlow] = useState<CashFlow | null>(null);
  const [tax, setTax] = useState<TaxReport | null>(null);

  useEffect(() => {
    if (tab !== 'ledger' || accounts.length > 0) return;
    api<{ data: Account[] }>('/accounts').then((response) => setAccounts(response.data)).catch(() => setAccounts([]));
  }, [accounts.length, tab]);

  const load = useCallback(() => {
    setFailed(false);
    if (tab === 'ledger' && !accountId) {
      setLoading(false);
      setLedger(null);
      return;
    }

    setLoading(true);
    const query = filtersToQuery(filters);
    let request: Promise<unknown>;
    if (tab === 'ledger') request = api<Ledger>(`/reports/account-ledger/${accountId}${appendAccount(query, accountId)}`).then(setLedger);
    else if (tab === 'journal') request = api<JournalReport>(`/reports/journal-entries${query}`).then(setJournal);
    else if (tab === 'cashflow') request = api<CashFlow>(`/reports/cash-flow${query}`).then(setCashFlow);
    else request = api<TaxReport>(`/reports/tax-report${query}`).then(setTax);

    request.catch(() => setFailed(true)).finally(() => setLoading(false));
  }, [accountId, filters, tab]);

  useEffect(() => load(), [load]);

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
    : tab === 'cashflow' ? <CashFlowTable cashFlow={cashFlow} loading={loading} g={g} />
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
        </div>
      </div>

      <ReportFilters value={filters} onChange={setFilters} />
      {tab === 'ledger' && (
        <Card className="no-print"><CardContent className="pt-5"><div className="max-w-md space-y-1.5"><label htmlFor="ledger-account" className="text-sm font-medium text-text">{g('account')}</label><Select id="ledger-account" value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">{g('allAccounts')}</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</Select></div></CardContent></Card>
      )}
      {tab === 'cashflow' && <p className="rounded border border-border bg-background p-3 text-xs leading-relaxed text-muted">{g('directCashFlowHint')}</p>}
      {tab === 'tax' && <p className="rounded border border-border bg-background p-3 text-xs leading-relaxed text-muted">{g('taxHint')}</p>}
      {reportBody}

      {doc && <Card><CardHeader className="no-print"><CardTitle>{t('preview')}</CardTitle></CardHeader><CardContent className="print:p-0"><div className="rounded bg-background p-3 print:bg-transparent print:p-0 [&_.print-only]:block"><DocumentScaler><ReportDocument title={doc.title} company={company} columns={doc.columns} rows={doc.rows} totalRow={doc.totalRow} /></DocumentScaler></div></CardContent></Card>}
    </div>
  );
}

function LedgerTable({ ledger, loading, g }: { ledger: Ledger | null; loading: boolean; g: ReturnType<typeof useTranslations> }) {
  return <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle>{ledger?.account.name ?? g('account')}</CardTitle>{ledger && <Badge tone="neutral" className="num">{g('closingBalance')}: {formatRiyal(ledger.closing_balance)}</Badge>}</CardHeader><CardContent>{loading || !ledger ? <Skeleton className="h-40 w-full" /> : <Table><THead><TR><TH>{g('date')}</TH><TH>{g('entryNumber')}</TH><TH>{g('description')}</TH><TH className="text-end">{g('debit')}</TH><TH className="text-end">{g('credit')}</TH><TH className="text-end">{g('balance')}</TH></TR></THead><TBody><TR className="bg-background"><TD colSpan={5}>{g('openingBalance')}</TD><TD className="num text-end">{formatRiyal(ledger.opening_balance)}</TD></TR>{ledger.rows.length === 0 ? <TR><TD colSpan={6} className="py-8 text-center text-muted">—</TD></TR> : ledger.rows.map((row) => <TR key={`${row.number}-${row.date}`}><TD className="num">{row.date}</TD><TD className="num">{row.number}</TD><TD>{row.description}</TD><TD className="num text-end">{formatRiyal(row.debit)}</TD><TD className="num text-end">{formatRiyal(row.credit)}</TD><TD className="num text-end font-medium">{formatRiyal(row.balance)}</TD></TR>)}</TBody></Table>}</CardContent></Card>;
}

function JournalTable({ journal, loading, g, t }: { journal: JournalReport | null; loading: boolean; g: ReturnType<typeof useTranslations>; t: ReturnType<typeof useTranslations> }) {
  return <Card><CardHeader><CardTitle>{g('journalEntries')}</CardTitle></CardHeader><CardContent>{loading || !journal ? <Skeleton className="h-40 w-full" /> : <Table><THead><TR><TH>{g('date')}</TH><TH>{g('entryNumber')}</TH><TH>{g('description')}</TH><TH className="text-end">{g('debit')}</TH><TH className="text-end">{g('credit')}</TH></TR></THead><TBody>{journal.rows.length === 0 ? <TR><TD colSpan={5} className="py-8 text-center text-muted">{t('empty')}</TD></TR> : journal.rows.flatMap((entry) => entry.lines.map((line, index) => <TR key={`${entry.entry_id}-${line.account_id}`} className={index === 0 ? 'border-t-2 border-border' : ''}><TD className="num">{index === 0 ? entry.date : ''}</TD><TD className="num">{index === 0 ? entry.number : ''}</TD><TD>{line.account_code} — {line.account_name}</TD><TD className="num text-end">{formatRiyal(line.debit)}</TD><TD className="num text-end">{formatRiyal(line.credit)}</TD></TR>))}<TR className="font-semibold"><TD /><TD /><TD>{t('total')}</TD><TD className="num text-end">{formatRiyal(journal.total_debit)}</TD><TD className="num text-end">{formatRiyal(journal.total_credit)}</TD></TR></TBody></Table>}</CardContent></Card>;
}

function CashFlowTable({ cashFlow, loading, g }: { cashFlow: CashFlow | null; loading: boolean; g: ReturnType<typeof useTranslations> }) {
  const sections: Array<[keyof Pick<CashFlow, 'operating' | 'investing' | 'financing'>, string]> = [['operating', g('operating')], ['investing', g('investing')], ['financing', g('financing')]];
  return <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle>{g('cashFlow')}</CardTitle>{cashFlow && <Badge tone={Number(cashFlow.net_cash_flow) >= 0 ? 'positive' : 'negative'} className="num">{formatRiyal(cashFlow.net_cash_flow)}</Badge>}</CardHeader><CardContent>{loading || !cashFlow ? <Skeleton className="h-40 w-full" /> : <Table><THead><TR><TH>{g('date')}</TH><TH>{g('entryNumber')}</TH><TH>{g('description')}</TH><TH className="text-end">{g('inflows')}</TH><TH className="text-end">{g('outflows')}</TH><TH className="text-end">{g('netCashFlow')}</TH></TR></THead><TBody>{sections.map(([key, label]) => <CashSectionRows key={key} label={label} section={cashFlow[key]} g={g} />)}<TR className="border-t-2 border-border font-semibold"><TD colSpan={5}>{g('netCashFlow')}</TD><TD className="num text-end">{formatRiyal(cashFlow.net_cash_flow)}</TD></TR></TBody></Table>}</CardContent></Card>;
}

function CashSectionRows({ label, section, g }: { label: string; section: CashSection; g: ReturnType<typeof useTranslations> }) {
  return <><TR className="bg-background"><TD colSpan={6} className="text-xs font-semibold text-muted">{label}</TD></TR>{section.entries.map((entry) => <TR key={`${label}-${entry.number}`}><TD className="num">{entry.date}</TD><TD className="num">{entry.number}</TD><TD>{entry.description}</TD><TD className="num text-end">{entry.inflow === '0.00' ? '—' : formatRiyal(entry.inflow)}</TD><TD className="num text-end">{entry.outflow === '0.00' ? '—' : formatRiyal(entry.outflow)}</TD><TD className="num text-end">{formatRiyal(entry.net)}</TD></TR>)}<TR className="font-medium"><TD colSpan={3}>{label}</TD><TD className="num text-end">{formatRiyal(section.inflows)}</TD><TD className="num text-end">{formatRiyal(section.outflows)}</TD><TD className="num text-end">{formatRiyal(section.net)}</TD></TR></>;
}

function TaxCard({ tax, loading, g }: { tax: TaxReport | null; loading: boolean; g: ReturnType<typeof useTranslations> }) {
  const payable = tax?.status === 'payable';
  return <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle>{g('taxReport')}</CardTitle>{tax && <Badge tone={payable ? 'warning' : 'positive'}>{payable ? g('taxPayable') : g('taxRecoverable')}</Badge>}</CardHeader><CardContent>{loading || !tax ? <Skeleton className="h-32 w-full" /> : <dl className="divide-y divide-border rounded border border-border"><TaxRow label={g('outputVat')} amount={tax.output_vat} /><TaxRow label={g('inputVat')} amount={tax.input_vat} /><TaxRow label={g('netVat')} amount={tax.net_vat} strong /></dl>}</CardContent></Card>;
}

function TaxRow({ label, amount, strong = false }: { label: string; amount: string; strong?: boolean }) {
  return <div className={`flex items-center justify-between gap-4 px-4 py-3 ${strong ? 'font-semibold' : ''}`}><dt className="text-sm text-text">{label}</dt><dd className="num text-end">{formatRiyal(amount)}</dd></div>;
}
