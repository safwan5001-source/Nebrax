'use client';

/**
 * أسلوب «دفتر التحليل»: تظهر الوردية ونطاقها ومؤشراتها قبل التفاصيل، وتتحول
 * الفواتير النقدية إلى صفوف قابلة للقراءة باللمس على الجوال.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatRiyal, formatRiyalShort, isNegative } from '@/lib/money';
import { cn } from '@/lib/utils';
import { ReportMetricGrid, ReportMobileRows, ReportScreenHeader } from '@/components/reports/report-workspace-ui';

interface Invoice { id: string; number: string; invoice_date: string; total: string; status: string; payment_type: string }
interface Session {
  id: string; number: string; status: string;
  opening_balance: string; closing_balance: string | null;
  expected_balance: string | null; difference: string | null;
  opened_at: string | null; closed_at: string | null;
}
interface Report { cash_sales: string; sales_count: number; average: string; expected: string }

export default function PosReportPage() {
  const t = useTranslations('posReport');
  const ts = useTranslations('posSessions');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ data: Session[] }>('/pos-sessions')
      .then((r) => { setSessions(r.data); if (r.data[0]) setSelectedId(r.data[0].id); })
      .catch(() => {});
    api<{ data: Invoice[] }>('/invoices').then((r) => setInvoices(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedId) { setReport(null); return; }
    setReportLoading(true);
    api<{ session: Session; report: Report }>(`/pos-sessions/${selectedId}/report`)
      .then((r) => setReport(r.report))
      .catch(() => setReport(null))
      .finally(() => setReportLoading(false));
  }, [selectedId]);

  const session = useMemo(() => sessions.find((s) => s.id === selectedId) ?? null, [sessions, selectedId]);
  const closed = session?.status === 'closed';

  // بطاقات مؤشّرات الوردية (X/Z).
  const kpis: { label: string; value: string; tone?: 'muted' | 'negative' }[] = session
    ? [
        { label: ts('opening_balance'), value: formatRiyalShort(session.opening_balance) },
        { label: t('cash_sales'), value: report ? formatRiyalShort(report.cash_sales) : '—' },
        { label: t('count'), value: report ? String(report.sales_count) : '—' },
        { label: t('avg'), value: report ? formatRiyalShort(report.average) : '—' },
        { label: ts('expected'), value: report ? formatRiyalShort(report.expected) : '—' },
        ...(closed
          ? [
              { label: ts('closing_balance'), value: formatRiyalShort(session.closing_balance ?? '0') },
              { label: ts('difference'), value: formatRiyalShort(session.difference ?? '0'), tone: (isNegative(session.difference ?? '0') ? 'negative' : 'muted') as 'muted' | 'negative' },
            ]
          : []),
      ]
    : [];

  const recentCash = invoices.filter((i) => i.payment_type === 'cash' && i.status === 'posted').slice(0, 10);
  const scope = session
    ? `${closed ? ts('closed_status') : ts('open_status')} · ${session.opened_at?.slice(0, 16).replace('T', ' ') ?? '—'}`
    : ts('no_open');
  const metrics = kpis.map((k) => ({ label: k.label, value: k.value, tone: k.tone === 'negative' ? 'negative' as const : undefined }));
  const recentColumns = [
    { label: t('number') },
    { label: t('date') },
    { label: t('total'), align: 'end' as const },
  ];
  const recentRows = recentCash.map((invoice) => [invoice.number, invoice.invoice_date, formatRiyal(invoice.total)]);

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <ReportScreenHeader title={t('title')} description={t('subtitle')} scope={scope} />
        <div className="no-print w-full sm:max-w-xs">
          {sessions.length > 0 ? (
            <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.number} — {s.status === 'open' ? ts('open_status') : ts('closed_status')}
                </option>
              ))}
            </Select>
          ) : (
            <p className="text-sm text-muted">{ts('no_open')}</p>
          )}
        </div>
      </div>

      {session && (
        <div className="flex items-center gap-2 text-sm">
          <Badge tone={closed ? 'positive' : 'warning'}>{closed ? ts('closed_status') : ts('open_status')}</Badge>
          {session.opened_at && <span className="num text-muted">{session.opened_at.slice(0, 16).replace('T', ' ')}</span>}
        </div>
      )}

      {reportLoading && !report ? (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-24 w-full" />)}</div>
      ) : <ReportMetricGrid metrics={metrics} />}

      <Card>
        <CardHeader><CardTitle>{t('recent')}</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : recentCash.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">{t('empty')}</p>
          ) : (
            <>
            <ReportMobileRows columns={recentColumns} rows={recentRows} primaryIndex={0} secondaryIndex={1} />
            <Table className="hidden md:table">
              <THead>
                <TR><TH>{t('number')}</TH><TH>{t('date')}</TH><TH className="text-end">{t('total')}</TH></TR>
              </THead>
              <TBody>
                {recentCash.map((i) => (
                  <TR key={i.id}>
                    <TD className="num">{i.number}</TD>
                    <TD className="num text-muted">{i.invoice_date}</TD>
                    <TD className="num text-end">{formatRiyal(i.total)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
