'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { TrendingUp, TrendingDown, Users, Wallet, FileText, type LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Donut } from '@/components/charts/donut';
import { api } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { mockDashboard } from '@/lib/mock-data';
import { formatRiyal } from '@/lib/money';

interface IncomeStatement { total_revenue: string; total_expense: string; net_income: string }
interface Account { code: string; name: string; balance: string }
interface Invoice { id: string; number: string; invoice_date: string; total: string; status: string; payment_status: string }

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const ts = useTranslations('status');
  const ti = useTranslations('invoices');
  const [loading, setLoading] = useState(true);
  const [income, setIncome] = useState<IncomeStatement | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  useEffect(() => {
    Promise.all([
      api<IncomeStatement>('/reports/income-statement'),
      api<{ data: Account[] }>('/accounts'),
      api<{ data: Invoice[] }>('/invoices'),
    ])
      .then(([inc, acc, inv]) => {
        setIncome(inc);
        setAccounts(acc.data);
        setInvoices(inv.data);
      })
      .finally(() => setLoading(false));
  }, []);

  const balanceOf = (code: string) => accounts.find((a) => a.code === code)?.balance ?? '0';
  const receivables = balanceOf('1130');
  const cash = String(Number(balanceOf('1110')) + Number(balanceOf('1120')));

  const revenue = Number(income?.total_revenue ?? 0);
  const expense = Number(income?.total_expense ?? 0);
  const maxRE = Math.max(revenue, expense, 1);

  const payCount = (s: string) => invoices.filter((i) => i.payment_status === s).length;
  const payeSegments = [
    { label: ts('paid'), value: payCount('paid'), color: 'var(--positive)' },
    { label: ts('partial'), value: payCount('partial'), color: 'var(--warning)' },
    { label: ts('unpaid'), value: payCount('unpaid'), color: 'var(--muted)' },
  ];

  type Kpi = { title: string; value: string | undefined; icon: LucideIcon; raw?: boolean };

  const liveKpis: Kpi[] = [
    { title: t('revenue'), value: income?.total_revenue, icon: TrendingUp },
    { title: t('net_income'), value: income?.net_income, icon: TrendingUp },
    { title: t('receivables'), value: receivables, icon: Users },
    { title: t('cash'), value: cash, icon: Wallet },
  ];
  const demoKpis: Kpi[] = [
    { title: t('revenue'), value: mockDashboard.totalSales, icon: TrendingUp },
    { title: t('overdue'), value: mockDashboard.overdue, icon: TrendingDown },
    { title: t('cash'), value: mockDashboard.cash, icon: Wallet },
    { title: t('invoice_count'), value: String(mockDashboard.invoiceCount), icon: FileText, raw: true },
  ];
  const kpis = isDemo() ? demoKpis : liveKpis;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-text">{t('title')}</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <Card key={k.title}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{k.title}</CardTitle>
                <Icon className="h-4 w-4 text-muted" strokeWidth={1.7} />
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-7 w-28" />
                ) : (
                  <div className="num text-lg font-semibold text-text">
                    {k.raw ? k.value : formatRiyal(k.value)}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('revenue_vs_expense')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <>
                <Bar label={t('revenue')} value={revenue} max={maxRE} tone="bg-positive" />
                <Bar label={t('expense')} value={expense} max={maxRE} tone="bg-negative" />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('invoice_status')}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-28 w-full" /> : <Donut segments={payeSegments} />}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('recent_invoices')}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>{ti('number')}</TH>
                    <TH>{ti('date')}</TH>
                    <TH className="text-end">{ti('total')}</TH>
                    <TH>{ti('status')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {invoices.slice(0, 5).map((inv) => (
                    <TR key={inv.id}>
                      <TD className="num">{inv.number}</TD>
                      <TD className="num text-muted">{inv.invoice_date}</TD>
                      <TD className="num text-end">{formatRiyal(inv.total)}</TD>
                      <TD>
                        <Badge tone={inv.status === 'posted' ? 'positive' : 'muted'}>{ts(inv.status)}</Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Bar({ label, value, max, tone }: { label: string; value: number; max: number; tone: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="num text-text">{formatRiyal(value)}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-border/60">
        <div className={`h-full rounded ${tone}`} style={{ width: `${(value / max) * 100}%` }} />
      </div>
    </div>
  );
}
