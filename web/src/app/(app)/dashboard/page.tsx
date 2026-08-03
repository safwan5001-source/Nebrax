'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import {
  TrendingUp,
  TrendingDown,
  Users,
  Wallet,
  FileText,
  FilePlus,
  UserPlus,
  CreditCard,
  BarChart3,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Donut } from '@/components/charts/donut';
import { Sparkline } from '@/components/charts/sparkline';
import { api } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { mockDashboard } from '@/lib/mock-data';
import { formatRiyal, formatRiyalShort } from '@/lib/money';

interface IncomeStatement { total_revenue: string; total_expense: string; net_income: string }
interface Account { code: string; name: string; balance: string }
interface Invoice { id: string; number: string; invoice_date: string; total: string; status: string; payment_status: string }

const QUICK_ACTIONS: { href: string; key: string; icon: LucideIcon }[] = [
  { href: '/invoices', key: 'qa_invoice', icon: FilePlus },
  { href: '/partners', key: 'qa_partner', icon: UserPlus },
  { href: '/payments', key: 'qa_payment', icon: CreditCard },
  { href: '/reports', key: 'qa_reports', icon: BarChart3 },
];

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

  // سلاسل اتجاه آخر 7 أيام — مشتقّة من الفواتير المحمّلة فعلاً (لا نداء API إضافي).
  // النافذة تنتهي عند أحدث تاريخ فاتورة في البيانات، فتصمد أمام أي فجوة زمنية.
  const spark = useMemo(() => {
    const series = (valueOf: (i: Invoice) => number): number[] => {
      const days = 7;
      const buckets = new Array(days).fill(0) as number[];
      if (invoices.length === 0) return buckets;
      const maxTs = invoices.reduce((m, i) => Math.max(m, Date.parse(i.invoice_date)), 0);
      for (const inv of invoices) {
        const diff = Math.floor((maxTs - Date.parse(inv.invoice_date)) / 86_400_000);
        if (diff >= 0 && diff < days) buckets[days - 1 - diff] += valueOf(inv);
      }
      return buckets;
    };
    const unpaid = (i: Invoice) => (i.payment_status !== 'paid' ? Number(i.total) : 0);
    return {
      revenue: series((i) => Number(i.total)),      // كل مبيعات اليوم
      receivable: series(unpaid),                    // ذمم اليوم (غير المسدّد)
      cash: series((i) => (i.payment_status === 'paid' ? Number(i.total) : 0)), // محصّل اليوم
      count: series(() => 1),                        // عدد فواتير اليوم
    };
  }, [invoices]);

  type Kpi = { title: string; value: string | undefined; icon: LucideIcon; raw?: boolean; trend?: number[]; tone?: string };

  const netTone = Number(income?.net_income ?? 0) >= 0 ? 'var(--positive)' : 'var(--negative)';
  const liveKpis: Kpi[] = [
    { title: t('revenue'), value: income?.total_revenue, icon: TrendingUp, trend: spark.revenue, tone: 'var(--positive)' },
    { title: t('net_income'), value: income?.net_income, icon: TrendingUp, trend: spark.revenue, tone: netTone },
    { title: t('receivables'), value: receivables, icon: Users, trend: spark.receivable, tone: 'var(--primary)' },
    { title: t('cash'), value: cash, icon: Wallet, trend: spark.cash, tone: 'var(--primary)' },
  ];
  const demoKpis: Kpi[] = [
    { title: t('revenue'), value: mockDashboard.totalSales, icon: TrendingUp, trend: spark.revenue, tone: 'var(--positive)' },
    { title: t('overdue'), value: mockDashboard.overdue, icon: TrendingDown, trend: spark.receivable, tone: 'var(--warning)' },
    { title: t('cash'), value: mockDashboard.cash, icon: Wallet, trend: spark.cash, tone: 'var(--primary)' },
    { title: t('invoice_count'), value: String(mockDashboard.invoiceCount), icon: FileText, raw: true, trend: spark.count, tone: 'var(--primary)' },
  ];
  const kpis = isDemo() ? demoKpis : liveKpis;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-text">{t('title')}</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <Card key={k.title}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{k.title}</CardTitle>
                <Icon className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} />
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-7 w-28" />
                ) : (
                  <div className="flex items-end justify-between gap-2">
                    <div className="num text-lg font-semibold text-text">
                      {k.raw ? k.value : formatRiyalShort(k.value)}
                    </div>
                    {k.trend && (
                      <Sparkline data={k.trend} color={k.tone} label={t('spark_label')} className="mb-0.5" />
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium text-muted">{t('quick_actions')}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {QUICK_ACTIONS.map((a) => {
            const Icon = a.icon;
            return (
              <Link
                key={a.href}
                href={a.href}
                className="flex items-center gap-2.5 rounded border border-border bg-surface px-4 py-3 text-sm text-text transition-colors hover:border-primary hover:text-primary"
              >
                <Icon className="h-[18px] w-[18px] shrink-0 text-muted" strokeWidth={1.7} />
                <span className="truncate">{t(a.key)}</span>
              </Link>
            );
          })}
        </div>
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
