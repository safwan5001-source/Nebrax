'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import {
  TrendingUp,
  Users,
  Wallet,
  Package,
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
import { KpiCard } from '@/components/dashboard/kpi-card';
import { SalesChart } from '@/components/dashboard/sales-chart';
import { ActivityFeed } from '@/components/dashboard/activity-feed';
import { Registers } from '@/components/dashboard/registers';
import { ReportFilters, EMPTY_FILTERS, filtersToQuery, type ReportFilterState } from '@/components/reports/report-filters';
import { api } from '@/lib/api';
import { barPercent, dailySeries, expenseTone, netIncome, toNumber } from '@/lib/dashboard';
import { formatNumberShort, formatRiyal, formatRiyalShort } from '@/lib/money';
import { cn } from '@/lib/utils';

interface IncomeStatement { total_revenue: string; total_expense: string; net_income: string }
interface Account { code: string; name: string; balance: string }
interface Invoice {
  id: string; number: string; invoice_date: string; total: string;
  status: string; payment_status: string;
}
interface InventoryRow { total_value?: string; value?: string }

const QUICK_ACTIONS: { href: string; key: string; icon: LucideIcon }[] = [
  { href: '/invoices/new', key: 'qa_invoice', icon: FilePlus },
  { href: '/partners/new', key: 'qa_partner', icon: UserPlus },
  { href: '/payments', key: 'qa_payment', icon: CreditCard },
  { href: '/reports', key: 'qa_reports', icon: BarChart3 },
];

/**
 * لوحة التحكم v2.
 *
 * **الفلاتر نطاق عرضٍ لا سياق تطبيق:** شريط المرشّحات هنا هو `ReportFilters`
 * نفسه المستعمل في التقارير — يصفّي استعلامات هذه الصفحة وحدها. مبدّل الفرع
 * النشط يبقى في الشريط العلوي وحده مالكاً لترويسة `X-Branch-Id`؛ ولو صار هنا
 * مبدّلٌ ثانٍ لتناقض ما تقوله الترويسة مع ما تقوله الصفحة.
 *
 * لا حساب محاسبي هنا: الإيراد والمصروف والصافي من `/reports/income-statement`
 * المبني على الدفتر، والأرصدة من `/accounts`. ما يُشتقّ في الواجهة هو العرض
 * وحده (نِسب الأشرطة، السلاسل اليومية) عبر دوال خالصة مختبَرة في `lib/dashboard`.
 */
export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const ts = useTranslations('status');
  const ti = useTranslations('invoices');

  /**
   * ═══════════════════════════════════════════════════════════════
   *  الفترة الافتراضية على اللوحة: **اليوم**
   * ═══════════════════════════════════════════════════════════════
   *  اللوحة شاشة تشغيل يومية — «كم بعنا اليوم» لا «كم بعنا منذ التأسيس».
   *
   *  والافتراض هنا **محليّ للّوحة** لا في `EMPTY_FILTERS`: ذلك الثابت مشترك
   *  مع شاشات التقارير، وميزانُ مراجعةٍ ليومٍ واحد بلا معنى. تغييره هناك كان
   *  سيُفرغ كل تقرير من مضمونه بسطر واحد.
   */
  const [filters, setFilters] = useState<ReportFilterState>(() => {
    const today = new Date().toISOString().slice(0, 10);

    return { ...EMPTY_FILTERS, from: today, to: today };
  });
  const [loading, setLoading] = useState(true);
  const [income, setIncome] = useState<IncomeStatement | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [inventoryValue, setInventoryValue] = useState<string>('0');
  const [mobileTab, setMobileTab] = useState<'activity' | 'invoices'>('activity');

  const query = filtersToQuery(filters);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api<IncomeStatement>(`/reports/income-statement${query}`),
      api<{ data: Account[] }>('/accounts'),
      api<{ data: Invoice[] }>('/invoices'),
      api<{ data: InventoryRow[]; total_value?: string }>('/inventory').catch(() => null),
    ])
      .then(([inc, acc, inv, stock]) => {
        setIncome(inc);
        setAccounts(acc.data);
        setInvoices(inv.data);
        if (stock) {
          // قيمة المخزون: الإجمالي إن أرسله الخادم، وإلا مجموع صفوف التقرير.
          const total = stock.total_value
            ?? String(stock.data?.reduce((s, r) => s + toNumber(r.total_value ?? r.value), 0) ?? 0);
          setInventoryValue(total);
        }
      })
      .finally(() => setLoading(false));
  }, [query]);

  const balanceOf = (code: string) => accounts.find((a) => a.code === code)?.balance ?? '0';
  const cash = toNumber(balanceOf('1110')) + toNumber(balanceOf('1120'));
  const receivables = toNumber(balanceOf('1130'));

  const revenue = toNumber(income?.total_revenue);
  const expense = toNumber(income?.total_expense);
  const net = netIncome(income?.total_revenue, income?.total_expense, income?.net_income);
  const maxRE = Math.max(revenue, expense, 1);

  const payCount = (s: string) => invoices.filter((i) => i.payment_status === s).length;
  const paymentSegments = [
    { label: ts('paid'), value: payCount('paid'), color: 'var(--positive)' },
    { label: ts('partial'), value: payCount('partial'), color: 'var(--warning)' },
    { label: ts('unpaid'), value: payCount('unpaid'), color: 'var(--muted)' },
  ];

  // سلاسل المؤشّرات — مشتقّة من الفواتير المحمّلة فعلاً، بلا نداء إضافي.
  const spark = useMemo(() => {
    const rows = (valueOf: (i: Invoice) => number) =>
      invoices.map((i) => ({ date: i.invoice_date, amount: valueOf(i) }));

    return {
      sales: dailySeries(rows((i) => toNumber(i.total))),
      cash: dailySeries(rows((i) => (i.payment_status === 'paid' ? toNumber(i.total) : 0))),
      receivable: dailySeries(rows((i) => (i.payment_status !== 'paid' ? toNumber(i.total) : 0))),
    };
  }, [invoices]);

  return (
    <div className="space-y-6">
      {/* ١ — العنوان وشريط الفلاتر */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-2xl font-bold text-text">{t('title')}</h1>
        <ReportFilters value={filters} onChange={setFilters} />
      </div>

      {/* ٢ — صفّ المؤشّرات: ٣ بطاقات على الديسكتوب، شبكة ٢×٢ على الجوال */}
      {/* الترتيب يختلف بين المقاسين عمداً: الجوال يبدأ ببطاقة الأداء المالي
          (أهمّ ما يُقرأ أولاً على شاشة ضيّقة)، والديسكتوب يضعها ثالثةً كالمرجع. */}
      {/* `auto-rows-fr`: صفوف الشبكة تتقاسم الارتفاع بالتساوي. بدونه يقيس كل
          صفّ نفسه على محتواه، فيعلو صفُّ البطاقة ذات السطر الفرعي على الآخر
          وتبدو الشبكة مهلهلة — تساوٍ داخل الصفّ لا بين الصفّين. */}
      <div className="grid auto-rows-fr grid-cols-2 gap-3.5 lg:grid-cols-4">
        <div className="order-2 lg:order-1">
        <KpiCard
          label={t('cash')}
          value={formatNumberShort(cash)}
          unit={t('currency')}
          icon={Wallet}
          trend={spark.cash}
          trendLabel={t('spark_label')}
          loading={loading}
        />
        </div>
        <div className="order-3 lg:order-2">
        <KpiCard
          label={t('receivables')}
          value={formatNumberShort(receivables)}
          unit={t('currency')}
          icon={Users}
          trend={spark.receivable}
          trendLabel={t('spark_label')}
          loading={loading}
        />
        </div>
        {/* البطاقة المدمجة: المبيعات رقماً رئيسياً والصافي سطراً فرعياً.
            اسمها «الأداء المالي» لا «إجمالي المبيعات»: صارت تحمل رقمين —
            والاسم القديم يصف أحدهما فيُخفي الآخر. */}
        <div className="order-1 lg:order-3">
        <KpiCard
          label={t('financial_performance')}
          value={formatNumberShort(revenue)}
          unit={t('currency')}
          icon={TrendingUp}
          tone="positive"
          trend={spark.sales}
          trendLabel={t('spark_label')}
          sub={{
            label: t('net_after_expenses'),
            value: formatRiyalShort(String(net)),
            tone: net < 0 ? 'negative' : 'positive',
          }}
          loading={loading}
        />
        </div>
        {/* قيمة المخزون — رابعةً في المقاسين: تُكمل شبكة ٢×٢ على الجوال وصفّ
            الأربع على الديسكتوب. كانت مخفيّة على الواسع، فيرى صاحب الشاشة
            الأكبر معلوماتٍ **أقلّ** — وهو عكس ما تعنيه المساحة. */}
        <div className="order-4 lg:order-4">
          <KpiCard
            label={t('inventory_value')}
            value={formatNumberShort(inventoryValue)}
            unit={t('currency')}
            icon={Package}
            sub={{ label: t('inventory_note_short'), value: '', tone: 'muted' }}
            loading={loading}
          />
        </div>
      </div>

      {/* ٣ — إجراءات سريعة */}
      <section>
        <h2 className="mb-3 text-[15px] font-semibold text-text">{t('quick_actions')}</h2>
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          {QUICK_ACTIONS.map((a) => {
            const Icon = a.icon;
            return (
              <Link
                key={a.href}
                href={a.href}
                className="flex items-center justify-between rounded-[10px] border border-border bg-surface px-4 py-4 text-sm font-semibold text-text transition-colors hover:border-primary hover:bg-primary-soft"
              >
                <span className="truncate">{t(a.key)}</span>
                {/* `muted` كبقية شاشات التطبيق — الإطار والعنوان يكفيان لإبراز الإجراء. */}
                <Icon className="h-[18px] w-[18px] shrink-0 text-muted" strokeWidth={1.7} />
              </Link>
            );
          })}
        </div>
      </section>

      {/* ٤ + ٥ — قيمة المخزون (ديسكتوب) بجانب رسم المبيعات */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[300px_1fr]">
        <Card className="hidden rounded-2xl lg:block">
          <CardContent className="flex flex-col gap-3.5 p-5">
            {/* أيقونة عارية — لا صندوق ملوّن (DESIGN_SYSTEM.md). */}
            <Package className="h-[19px] w-[19px] text-muted" strokeWidth={1.7} />
            <div>
              <p className="text-[13px] font-medium text-muted">{t('inventory_value')}</p>
              {loading ? (
                <Skeleton className="mt-1.5 h-8 w-32" />
              ) : (
                <p className="num mt-1.5 text-[28px] font-bold leading-tight text-text">
                  {formatNumberShort(inventoryValue)}{' '}
                  <span className="text-[13px] font-medium text-muted">{t('currency')}</span>
                </p>
              )}
            </div>
            <p className="text-xs leading-relaxed text-muted">{t('inventory_note')}</p>
          </CardContent>
        </Card>

        <SalesChart query={query} />
      </div>

      {/* ٦ — حالة السداد + الإيرادات مقابل المصروفات */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader className="p-5 pb-0">
            <CardTitle className="text-[14.5px] font-semibold text-text">{t('invoice_status')}</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            {loading ? <Skeleton className="h-28 w-full" /> : <Donut segments={paymentSegments} />}
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="p-5 pb-0">
            <CardTitle className="text-[14.5px] font-semibold text-text">{t('revenue_vs_expense')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            {loading ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <>
                <Bar label={t('revenue')} value={revenue} max={maxRE} tone="positive" />
                <Bar label={t('expense')} value={expense} max={maxRE} tone={expenseTone(expense)} />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ٧ — النشاطات + أحدث الفواتير: عمودان على الديسكتوب، مبدّل على الجوال */}
      <div className="hidden gap-3.5 lg:grid lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader className="p-5 pb-0">
            <CardTitle className="text-[14.5px] font-semibold text-text">{t('activity')}</CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-2">
            <ActivityFeed />
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="p-5 pb-0">
            <CardTitle className="text-[14.5px] font-semibold text-text">{t('recent_invoices')}</CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-2">
            <RecentInvoices invoices={invoices} loading={loading} ti={ti} ts={ts} />
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl lg:hidden">
        <CardContent className="p-4">
          <div role="tablist" className="mb-3.5 flex rounded-[11px] bg-background p-[3px]">
            {(['activity', 'invoices'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={mobileTab === k}
                onClick={() => setMobileTab(k)}
                className={cn(
                  'flex-1 rounded-[9px] py-2 text-center text-[12.5px] font-semibold transition-colors',
                  mobileTab === k ? 'bg-primary text-white' : 'bg-background text-muted'
                )}
              >
                {t(k === 'activity' ? 'activity' : 'recent_invoices')}
              </button>
            ))}
          </div>
          {mobileTab === 'activity' ? (
            <ActivityFeed limit={4} />
          ) : (
            <RecentInvoices invoices={invoices} loading={loading} ti={ti} ts={ts} />
          )}
        </CardContent>
      </Card>

      {/* ٨ — صناديق البيع */}
      <Registers />
    </div>
  );
}

function RecentInvoices({
  invoices,
  loading,
  ti,
  ts,
}: {
  invoices: Invoice[];
  loading: boolean;
  ti: (k: string) => string;
  ts: (k: string) => string;
}) {
  if (loading) return <Skeleton className="h-32 w-full" />;

  const rows = invoices.slice(0, 5);

  return (
    <>
      {/* بطاقات على الضيّق وجدول على الواسع — `DESIGN_SYSTEM.md`: «الجداول →
          بطاقات على الجوال». جدولٌ بأربعة أعمدة في عرض ٤١٢px يلفّ كل خلية
          سطرين فيصير أقلّ قابلية للقراءة من قائمة. */}
      <ul className="space-y-2 sm:hidden">
        {rows.map((inv) => (
          <li key={inv.id} className="rounded border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <Link href={`/invoices/${inv.id}`} className="num font-semibold text-primary hover:underline">
                {inv.number}
              </Link>
              <Badge tone={inv.status === 'posted' ? 'positive' : 'muted'}>{ts(inv.status)}</Badge>
            </div>
            <div className="mt-1.5 flex items-baseline justify-between gap-2 text-xs">
              <span className="num text-muted">{inv.invoice_date}</span>
              <span className="num font-semibold text-text">{formatRiyal(inv.total)}</span>
            </div>
          </li>
        ))}
      </ul>

      <div className="hidden sm:block">
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
            {rows.map((inv) => (
              <TR key={inv.id}>
                <TD>
                  <Link href={`/invoices/${inv.id}`} className="num font-semibold text-primary hover:underline">
                    {inv.number}
                  </Link>
                </TD>
                <TD className="num text-muted">{inv.invoice_date}</TD>
                <TD className="num text-end">{formatRiyal(inv.total)}</TD>
                <TD>
                  <Badge tone={inv.status === 'posted' ? 'positive' : 'muted'}>{ts(inv.status)}</Badge>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </>
  );
}

/** شريط نسبة — يحمرّ للمصروف متى وُجد فعلاً، ويبقى محايداً بصفر. */
function Bar({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: 'positive' | 'negative' | 'neutral';
}) {
  const fill =
    tone === 'positive'
      ? 'bg-positive'
      : tone === 'negative'
        ? 'bg-negative'
        : 'bg-border';

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-[13.5px]">
        <span className="font-medium text-muted">{label}</span>
        <span className="num font-bold text-text">{formatRiyal(value)}</span>
      </div>
      <div className="h-[9px] w-full overflow-hidden rounded-md bg-background">
        <div className={cn('h-full rounded-md', fill)} style={{ width: `${barPercent(value, max)}%` }} />
      </div>
    </div>
  );
}
