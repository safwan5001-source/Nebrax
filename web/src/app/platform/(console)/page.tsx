'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Building2, CalendarClock, FileText, RefreshCw, ShieldCheck, UsersRound, WalletCards } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { currentPlatformAdministrator, isPlatformAuthenticated } from '@/lib/platform-auth';
import { platformApi } from '@/lib/platform-api';
import { formatRiyal } from '@/lib/money';

interface MetricGroup {
  total: number;
  active: number;
  inactive: number;
}

interface SubscriptionMetrics {
  active: number;
  trials: number;
  renewals_next_7_days: number;
  renewals_next_30_days: number;
  renewals_next_60_days: number;
  renewal_value_at_risk_minor: number;
  renewal_value_at_risk: string;
  monthly_recurring_revenue_minor: number;
  monthly_recurring_revenue: string;
  annual_recurring_revenue_minor: number;
  annual_recurring_revenue: string;
  average_active_subscription_minor: number;
  average_active_subscription: string;
  by_plan: Array<{
    plan: string;
    active: number;
    monthly_recurring_revenue_minor: number;
    monthly_recurring_revenue: string;
  }>;
}

interface PlatformOverview {
  data: {
    tenants: MetricGroup;
    users: MetricGroup;
    subscriptions: SubscriptionMetrics;
  };
}

type T = (key: string, values?: Record<string, string | number | Date>) => string;

export default function PlatformDashboardPage() {
  const t = useTranslations('platform') as T;
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [overview, setOverview] = useState<PlatformOverview['data'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await platformApi<PlatformOverview>('/platform/overview');
      setOverview(response.data);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // التنقل وتسجيل الخروج واسم المشرف في PlatformShell. الصفحة تحتفظ بحارس الجلسة وحده.
  useEffect(() => {
    if (!isPlatformAuthenticated() || !currentPlatformAdministrator()) {
      router.replace('/platform/login');
      return;
    }
    setReady(true);
    load();
  }, [load, router]);

  if (!ready) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <Skeleton className="h-64" />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8" aria-busy={loading}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-primary" strokeWidth={1.7} aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-primary">{t('eyebrow')}</p>
            <h1 className="mt-0.5 text-xl font-semibold text-text">{t('title')}</h1>
            <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
          </div>
        </div>
        <Button variant="outline" className="h-11 shrink-0 self-start" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.7} aria-hidden="true" />
          {t('refresh')}
        </Button>
      </header>

      <p className="text-xs text-muted">{t('readOnly')}</p>

      {error ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-text">{t('loadFailed')}</p>
              <p className="mt-1 text-sm text-muted" role="alert">{error}</p>
            </div>
            <Button variant="outline" className="h-11" onClick={load}>
              <RefreshCw className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              {t('retry')}
            </Button>
          </CardContent>
        </Card>
      ) : !overview ? (
        <div className="space-y-4" data-testid="overview-skeleton">
          <Skeleton className="h-56" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
            <Skeleton className="h-40 sm:col-span-2 lg:col-span-1" />
          </div>
          <Skeleton className="h-32" />
          <Skeleton className="h-48" />
        </div>
      ) : (
        <>
          <RevenueSection metrics={overview.subscriptions} t={t} />
          <AccountsSection overview={overview} t={t} />
          <RenewalsSection metrics={overview.subscriptions} t={t} />
          <PlanSection metrics={overview.subscriptions} t={t} />
        </>
      )}
    </main>
  );
}

function SectionHeading({ id, icon: Icon, children }: { id: string; icon: typeof Building2; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
      <Icon className="h-4 w-4 text-muted" strokeWidth={1.7} aria-hidden="true" />
      {children}
    </h2>
  );
}

function RevenueSection({ metrics, t }: { metrics: SubscriptionMetrics; t: T }) {
  const scope: Array<{ key: 'Contracted' | 'Invoiced' | 'Collected'; shown: boolean }> = [
    { key: 'Contracted', shown: true },
    { key: 'Invoiced', shown: false },
    { key: 'Collected', shown: false },
  ];
  return (
    <section aria-labelledby="platform-revenue">
      <SectionHeading id="platform-revenue" icon={WalletCards}>{t('revenueTitle')}</SectionHeading>
      <Card>
        <CardContent className="grid grid-cols-1 gap-6 p-5 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <p className="text-sm font-medium text-muted">{t('monthlyRecurringRevenue')}</p>
            <p className="num mt-2 text-2xl font-bold text-text min-[400px]:text-3xl sm:text-4xl">{formatRiyal(metrics.monthly_recurring_revenue)}</p>
            <p className="mt-5 text-sm font-medium text-muted">{t('annualRecurringRevenue')}</p>
            <p className="num mt-1 text-xl font-semibold text-text">{formatRiyal(metrics.annual_recurring_revenue)}</p>
            <p className="mt-4 text-xs leading-relaxed text-muted">{t('contractedRevenueNotice')}</p>
          </div>
          <div className="border-t border-border pt-5 lg:border-s lg:border-t-0 lg:ps-6 lg:pt-0">
            <h3 className="text-sm font-semibold text-text">{t('revenueScopeTitle')}</h3>
            <dl className="mt-3 space-y-3">
              {scope.map(({ key, shown }) => (
                // مجموعة صالحة في `dl`: `div` يضم `dt` و`dd` فقط. الحالة وصفٌ ثانٍ للمصطلح نفسه (`dd`) لا `span` شقيق،
                // والشبكة تُبقي المظهر السابق: العنوان والوصف في عمود، والشارة في العمود الآخر على الشاشات العريضة.
                <div key={key} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-4">
                  <dt className="min-w-0 text-sm font-medium text-text sm:col-start-1">{t(`scope${key}`)}</dt>
                  <dd className="mt-0.5 min-w-0 text-xs leading-relaxed text-muted sm:col-start-1">{t(`scope${key}Desc`)}</dd>
                  <dd
                    className={
                      shown
                        ? 'mt-1 w-fit shrink-0 rounded bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:self-start sm:mt-0'
                        : 'mt-1 w-fit shrink-0 rounded border border-border px-2 py-0.5 text-xs font-medium text-muted sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:self-start sm:mt-0'
                    }
                  >
                    {shown ? t('scopeShown') : t('scopeNotReported')}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function AccountsSection({ overview, t }: { overview: PlatformOverview['data']; t: T }) {
  return (
    <section aria-labelledby="platform-accounts">
      <SectionHeading id="platform-accounts" icon={Building2}>{t('accountsTitle')}</SectionHeading>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard title={t('tenants')} icon={Building2} metrics={overview.tenants} t={t} />
        <MetricCard title={t('users')} icon={UsersRound} metrics={overview.users} t={t} />
        <Card className="sm:col-span-2 lg:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle>{t('subscriptions')}</CardTitle>
            <FileText className="h-5 w-5 text-muted" strokeWidth={1.7} aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <p className="num text-4xl font-bold leading-none text-text">{overview.subscriptions.active}</p>
            <p className="mt-2 text-sm text-muted">{t('activeSubscriptions')}</p>
            <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
              <div>
                <dt className="text-muted">{t('trials')}</dt>
                <dd className="num mt-1 text-lg font-semibold text-text">{overview.subscriptions.trials}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function RenewalsSection({ metrics, t }: { metrics: SubscriptionMetrics; t: T }) {
  const items = [
    { label: t('renewalsNext7Days'), value: metrics.renewals_next_7_days },
    { label: t('renewalsNext30Days'), value: metrics.renewals_next_30_days },
    { label: t('renewalsNext60Days'), value: metrics.renewals_next_60_days },
  ];
  return (
    <section aria-labelledby="platform-renewals">
      <SectionHeading id="platform-renewals" icon={CalendarClock}>{t('renewalsTitle')}</SectionHeading>
      <Card>
        <CardContent className="p-5">
          <dl className="grid grid-cols-3 gap-4">
            {items.map((item) => (
              <div key={item.label} className="min-w-0">
                <dt className="text-sm text-muted">{item.label}</dt>
                <dd className="num mt-1 text-2xl font-semibold text-text">{item.value}</dd>
              </div>
            ))}
          </dl>
          <dl className="mt-4 border-t border-border pt-4">
            <dt className="text-sm text-muted">{t('renewalValueAtRisk')}</dt>
            <dd className="num mt-1 text-2xl font-semibold text-text">{formatRiyal(metrics.renewal_value_at_risk)}</dd>
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-muted">{t('renewalsNote')}</p>
        </CardContent>
      </Card>
    </section>
  );
}

function PlanSection({ metrics, t }: { metrics: SubscriptionMetrics; t: T }) {
  return (
    <section aria-labelledby="platform-plans">
      <SectionHeading id="platform-plans" icon={FileText}>{t('planBreakdown')}</SectionHeading>
      <Card>
        <CardContent className="p-5">
          {metrics.by_plan.length === 0 ? (
            <p className="text-sm text-muted">{t('noSubscriptions')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-96 text-sm">
                <thead className="border-b border-border text-xs text-muted">
                  <tr>
                    <th scope="col" className="pb-2 text-start font-medium">{t('plan')}</th>
                    <th scope="col" className="pb-2 text-end font-medium">{t('activeSubscriptions')}</th>
                    <th scope="col" className="pb-2 text-end font-medium">{t('monthlyRecurringRevenue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.by_plan.map((plan) => (
                    <tr key={plan.plan} className="border-b border-border last:border-0">
                      <th scope="row" className="py-2.5 text-start font-medium text-text">{plan.plan}</th>
                      <td className="num py-2.5 text-end text-text">{plan.active}</td>
                      <td className="num py-2.5 text-end text-text">{formatRiyal(plan.monthly_recurring_revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function MetricCard({ title, icon: Icon, metrics, t }: { title: string; icon: typeof Building2; metrics: MetricGroup; t: T }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>{title}</CardTitle>
        <Icon className="h-5 w-5 text-muted" strokeWidth={1.7} aria-hidden="true" />
      </CardHeader>
      <CardContent>
        <p className="num text-4xl font-bold leading-none text-text">{metrics.total}</p>
        <p className="mt-2 text-sm text-muted">{t('total')}</p>
        <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
          <div>
            <dt className="text-muted">{t('active')}</dt>
            <dd className="num mt-1 text-lg font-semibold text-text">{metrics.active}</dd>
          </div>
          <div>
            <dt className="text-muted">{t('inactive')}</dt>
            <dd className="num mt-1 text-lg font-semibold text-text">{metrics.inactive}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
