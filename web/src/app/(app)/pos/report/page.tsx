'use client';

/** تقرير X/Z من مصدر جلسة واحد؛ لا تختلط فيه فواتير جلسات أو فروع أخرى. */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Printer } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { api, ApiError } from '@/lib/api';
import { formatRiyal, formatRiyalShort, isNegative } from '@/lib/money';
import { ReportMetricGrid, ReportMobileRows, ReportScreenHeader } from '@/components/reports/report-workspace-ui';

interface Session {
  id: string; number: string; status: 'open' | 'closed';
  opening_balance: string; closing_balance: string | null;
  expected_balance: string | null; difference: string | null;
  opened_at: string | null; closed_at: string | null;
}
interface Report { cash_sales: string; cash_refunds: string; cash_in: string; cash_out: string; sales_count: number; returns_count: number; returns_total: string; net_sales: string; average: string; expected: string }
interface SessionSale { id: string; number: string; invoice_date: string | null; payment_type: string; total: string }
interface SessionReturn { id: string; number: string; return_date: string | null; payment_type: string; total: string }
interface ReportResponse { session: Session; report: Report; sales: SessionSale[]; returns: SessionReturn[] }

export default function PosReportPage() {
  const t = useTranslations('posReport');
  const ts = useTranslations('posSessions');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [sales, setSales] = useState<SessionSale[]>([]);
  const [returns, setReturns] = useState<SessionReturn[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const reportRequestId = useRef(0);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const result = await api<{ data: Session[] }>('/pos-sessions');
      setSessions(result.data);
      setSelectedId((current) => current && result.data.some((item) => item.id === current) ? current : result.data[0]?.id ?? '');
    } catch (cause) {
      setSessionsError(cause instanceof ApiError ? cause.message : t('load_failed'));
    } finally {
      setSessionsLoading(false);
    }
  }, [t]);

  const loadReport = useCallback(async () => {
    const requestId = ++reportRequestId.current;
    if (!selectedId) {
      setSession(null); setReport(null); setSales([]); setReturns([]); setReportError(null);
      return;
    }
    setReportLoading(true);
    setReportError(null);
    setSession(null); setReport(null); setSales([]); setReturns([]);
    try {
      const result = await api<ReportResponse>(`/pos-sessions/${selectedId}/report`);
      if (requestId !== reportRequestId.current) return;
      setSession(result.session); setReport(result.report); setSales(result.sales); setReturns(result.returns);
    } catch (cause) {
      if (requestId !== reportRequestId.current) return;
      setSession(null); setReport(null); setSales([]); setReturns([]);
      setReportError(cause instanceof ApiError ? cause.message : t('report_failed'));
    } finally {
      if (requestId === reportRequestId.current) setReportLoading(false);
    }
  }, [selectedId, t]);

  useEffect(() => { void loadSessions(); }, [loadSessions]);
  useEffect(() => { void loadReport(); }, [loadReport]);

  const closed = session?.status === 'closed';
  const metrics = useMemo(() => session ? [
    { label: ts('opening_balance'), value: formatRiyalShort(session.opening_balance) },
    { label: t('cash_sales'), value: report ? formatRiyalShort(report.cash_sales) : '—' },
    { label: ts('cash_refunds'), value: report ? formatRiyalShort(report.cash_refunds) : '—', tone: report && report.cash_refunds !== '0.00' ? 'negative' as const : undefined },
    { label: ts('cash_in_total'), value: report ? formatRiyalShort(report.cash_in) : '—' },
    { label: ts('cash_out_total'), value: report ? formatRiyalShort(report.cash_out) : '—' },
    { label: ts('net_sales'), value: report ? formatRiyalShort(report.net_sales) : '—' },
    { label: t('count'), value: report ? String(report.sales_count) : '—' },
    { label: ts('returns_count'), value: report ? String(report.returns_count) : '—' },
    { label: t('avg'), value: report ? formatRiyalShort(report.average) : '—' },
    { label: ts('expected'), value: report ? formatRiyalShort(report.expected) : '—' },
    ...(closed ? [
      { label: ts('closing_balance'), value: formatRiyalShort(session.closing_balance ?? '0') },
      { label: ts('difference'), value: formatRiyalShort(session.difference ?? '0'), tone: isNegative(session.difference ?? '0') ? 'negative' as const : undefined },
    ] : []),
  ] : [], [closed, report, session, t, ts]);
  const scope = session ? `${closed ? t('z_report') : t('x_report')} · ${session.number} · ${closed ? ts('closed_status') : ts('open_status')} · ${session.opened_at?.slice(0, 16).replace('T', ' ') ?? '—'}` : undefined;
  const columns = [{ label: t('number') }, { label: t('date') }, { label: t('total'), align: 'end' as const }];
  const rows = sales.map((sale) => [sale.number, sale.invoice_date ?? '—', formatRiyal(sale.total)]);
  const returnRows = returns.map((item) => [item.number, item.return_date ?? '—', `-${formatRiyal(item.total)}`]);

  return <div className="space-y-5">
    <ReportScreenHeader title={t('title')} description={t('subtitle')} scope={scope} actionsLabel={t('actions')} actions={[{ id: 'print', label: t('print'), icon: Printer, onSelect: () => window.print(), disabled: reportLoading || !report || Boolean(reportError) }]} />

    <div className="print-only border-b border-black pb-3"><h1 className="text-xl font-semibold">{t('title')}</h1>{scope && <p className="num mt-1 text-sm">{scope}</p>}</div>

    <div className="no-print w-full sm:max-w-xs">
      {sessionsLoading ? <Skeleton className="h-10 w-full" /> : sessionsError ? <div className="rounded border border-border bg-surface p-3"><p role="alert" className="text-sm text-negative">{sessionsError}</p><Button variant="outline" size="sm" className="mt-2" onClick={() => void loadSessions()}>{t('retry')}</Button></div> : sessions.length > 0 ? <Select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{sessions.map((item) => <option key={item.id} value={item.id}>{item.number} — {item.status === 'open' ? ts('open_status') : ts('closed_status')}</option>)}</Select> : <p className="text-sm text-muted">{ts('no_open')}</p>}
    </div>

    {reportError && <div className="rounded border border-border bg-surface p-4"><p role="alert" className="text-sm text-negative">{reportError}</p><Button variant="outline" size="sm" className="mt-2" onClick={() => void loadReport()}>{t('retry')}</Button></div>}
    {session && <div className="flex items-center gap-2 text-sm"><Badge tone={closed ? 'positive' : 'warning'}>{closed ? ts('closed_status') : ts('open_status')}</Badge>{session.opened_at && <span className="num text-muted">{session.opened_at.slice(0, 16).replace('T', ' ')}</span>}</div>}
    {reportLoading && !report ? <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-24 w-full" />)}</div> : <ReportMetricGrid metrics={metrics} />}

    {session && !reportError && <Card><CardHeader><CardTitle>{t('recent')}</CardTitle></CardHeader><CardContent>
      {reportLoading ? <Skeleton className="h-32 w-full" /> : sales.length === 0 ? <p className="py-8 text-center text-sm text-muted">{t('empty')}</p> : <>
        <ReportMobileRows columns={columns} rows={rows} primaryIndex={0} secondaryIndex={1} rowActions={sales.map((sale) => ({ href: `/invoices/${sale.id}`, label: sale.number }))} />
        <Table className="hidden md:table"><THead><TR><TH>{t('number')}</TH><TH>{t('date')}</TH><TH className="text-end">{t('total')}</TH></TR></THead><TBody>{sales.map((sale) => <TR key={sale.id}><TD><Link href={`/invoices/${sale.id}`} className="num font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{sale.number}</Link></TD><TD className="num text-muted">{sale.invoice_date ?? '—'}</TD><TD className="num text-end">{formatRiyal(sale.total)}</TD></TR>)}</TBody></Table>
      </>}
    </CardContent></Card>}

    {session && !reportError && <Card><CardHeader><CardTitle>{t('returns')}</CardTitle></CardHeader><CardContent>
      {reportLoading ? <Skeleton className="h-24 w-full" /> : returns.length === 0 ? <p className="py-8 text-center text-sm text-muted">{t('returns_empty')}</p> : <>
        <ReportMobileRows columns={columns} rows={returnRows} primaryIndex={0} secondaryIndex={1} />
        <Table className="hidden md:table"><THead><TR><TH>{t('number')}</TH><TH>{t('date')}</TH><TH className="text-end">{t('total')}</TH></TR></THead><TBody>{returns.map((item) => <TR key={item.id}><TD className="num font-medium text-text">{item.number}</TD><TD className="num text-muted">{item.return_date ?? '—'}</TD><TD className="num text-end text-negative">-{formatRiyal(item.total)}</TD></TR>)}</TBody></Table>
      </>}
    </CardContent></Card>}
  </div>;
}
