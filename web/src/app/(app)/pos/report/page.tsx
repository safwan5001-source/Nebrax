'use client';

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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
        </div>
        <div className="min-w-56">
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

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {(reportLoading && !report ? Array.from({ length: 5 }) : kpis).map((k, i) => (
          <Card key={(k as { label?: string })?.label ?? i}>
            {reportLoading && !report ? (
              <CardContent className="py-6"><Skeleton className="h-6 w-24" /></CardContent>
            ) : (
              <>
                <CardHeader><CardTitle>{(k as { label: string }).label}</CardTitle></CardHeader>
                <CardContent>
                  <div className={cn('num text-lg font-semibold', (k as { tone?: string }).tone === 'negative' ? 'text-negative' : 'text-text')}>
                    {(k as { value: string }).value}
                  </div>
                </CardContent>
              </>
            )}
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>{t('recent')}</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : recentCash.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">{t('empty')}</p>
          ) : (
            <Table>
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
