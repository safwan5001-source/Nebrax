'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Building2, LogOut, RefreshCw, ServerCog, ShieldCheck, Tag, Users2, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import {
  currentPlatformAdministrator,
  isPlatformAuthenticated,
  platformLogout,
  type PlatformAdministrator,
} from '@/lib/platform-auth';
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

export default function PlatformDashboardPage() {
  const t = useTranslations('platform');
  const router = useRouter();
  const [administrator, setAdministrator] = useState<PlatformAdministrator | null>(null);
  const [overview, setOverview] = useState<PlatformOverview['data'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

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

  useEffect(() => {
    if (!isPlatformAuthenticated()) {
      router.replace('/platform/login');
      return;
    }

    const current = currentPlatformAdministrator();
    if (!current) {
      router.replace('/platform/login');
      return;
    }

    setAdministrator(current);
    load();
  }, [load, router]);

  async function signOut() {
    setSigningOut(true);
    await platformLogout();
    router.replace('/platform/login');
  }

  if (!administrator) {
    return <main className="min-h-screen bg-background p-5"><Skeleton className="mx-auto h-64 max-w-5xl" /></main>;
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-primary" strokeWidth={1.7} aria-hidden="true" />
            <div>
              <p className="text-xs font-semibold text-primary">{t('eyebrow')}</p>
              <h1 className="mt-0.5 text-xl font-semibold text-text">{t('title')}</h1>
              <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="max-w-48 truncate text-xs text-muted">{t('signedInAs', { name: administrator.name })}</span>
            <Button asChild variant="outline" size="sm"><Link href='/platform/tenants'>
              <Users2 className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              {t('manageTenants')}
            </Link></Button>
            <Button asChild variant="outline" size="sm"><Link href='/platform/prices'>
              <Tag className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              {t('managePrices')}
            </Link></Button>
            <Button asChild variant="outline" size="sm"><Link href='/platform/integrations'>
              <ServerCog className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              {t('manageIntegrations')}
            </Link></Button>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.7} aria-hidden="true" />
              {t('refresh')}
            </Button>
            <Button variant="outline" size="sm" onClick={signOut} disabled={signingOut}>
              <LogOut className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              {signingOut ? t('signingOut') : t('logout')}
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5 flex flex-wrap items-center gap-2 text-xs text-muted">
          <ShieldCheck className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
          <span>{t('readOnly')}</span>
        </div>

        {error ? (
          <Card>
            <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-text">{t('loadFailed')}</p>
                <p className="mt-1 text-sm text-muted" role="alert">{error}</p>
              </div>
              <Button variant="outline" onClick={load}>
                <RefreshCw className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                {t('retry')}
              </Button>
            </CardContent>
          </Card>
        ) : loading || !overview ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Skeleton className="h-52" />
            <Skeleton className="h-52" />
            <Skeleton className="h-80 sm:col-span-2" />
          </div>
        ) : (
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-label={t('title')}>
            <MetricCard title={t('tenants')} icon={Building2} metrics={overview.tenants} t={t} />
            <MetricCard title={t('users')} icon={UsersRound} metrics={overview.users} t={t} />
            <SubscriptionCard metrics={overview.subscriptions} t={t} />
          </section>
        )}
      </div>
    </main>
  );
}

function SubscriptionCard({
  metrics,
  t,
}: {
  metrics: SubscriptionMetrics;
  t: (key: string, values?: Record<string, string | number | Date>) => string;
}) {
  return (
    <Card className="sm:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>{t('subscriptions')}</CardTitle>
        <span className="text-xs text-muted">{t('readOnly')}</span>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-5 border-b border-border pb-5 sm:grid-cols-[1.4fr_1fr] sm:items-end">
          <div>
            <p className="text-sm font-medium text-muted">{t('monthlyRecurringRevenue')}</p>
            <p className="num mt-2 text-3xl font-bold text-text">{formatRiyal(metrics.monthly_recurring_revenue)}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">{t('contractedRevenueNotice')}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-muted">{t('annualRecurringRevenue')}</p><p className="num mt-1 text-lg font-semibold text-text">{formatRiyal(metrics.annual_recurring_revenue)}</p></div>
            <div><p className="text-muted">{t('trials')}</p><p className="num mt-1 text-lg font-semibold text-text">{metrics.trials}</p></div>
            <div><p className="text-muted">{t('renewalsNext7Days')}</p><p className="num mt-1 text-lg font-semibold text-text">{metrics.renewals_next_7_days}</p></div>
            <div><p className="text-muted">{t('renewalsNext30Days')}</p><p className="num mt-1 text-lg font-semibold text-text">{metrics.renewals_next_30_days}</p></div>
            <div><p className="text-muted">{t('renewalsNext60Days')}</p><p className="num mt-1 text-lg font-semibold text-text">{metrics.renewals_next_60_days}</p></div>
            <div><p className="text-muted">{t('renewalValueAtRisk')}</p><p className="num mt-1 text-lg font-semibold text-text">{formatRiyal(metrics.renewal_value_at_risk)}</p></div>
          </div>
        </div>

        <div className="mt-5">
          <h2 className="text-sm font-semibold text-text">{t('planBreakdown')}</h2>
          {metrics.by_plan.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{t('noSubscriptions')}</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-96 text-sm">
                <thead className="border-b border-border text-start text-xs text-muted">
                  <tr>
                    <th className="pb-2 text-start font-medium">{t('plan')}</th>
                    <th className="pb-2 text-end font-medium">{t('activeSubscriptions')}</th>
                    <th className="pb-2 text-end font-medium">{t('monthlyRecurringRevenue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.by_plan.map((plan) => (
                    <tr key={plan.plan} className="border-b border-border last:border-0">
                      <td className="py-2.5 font-medium text-text">{plan.plan}</td>
                      <td className="num py-2.5 text-end text-text">{plan.active}</td>
                      <td className="num py-2.5 text-end text-text">{formatRiyal(plan.monthly_recurring_revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MetricCard({
  title,
  icon: Icon,
  metrics,
  t,
}: {
  title: string;
  icon: typeof Building2;
  metrics: MetricGroup;
  t: (key: string, values?: Record<string, string | number | Date>) => string;
}) {
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
