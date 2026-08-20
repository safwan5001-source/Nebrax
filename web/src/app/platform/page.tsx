'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Building2, LogOut, RefreshCw, ShieldCheck, UsersRound } from 'lucide-react';
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

interface MetricGroup {
  total: number;
  active: number;
  inactive: number;
}

interface PlatformOverview {
  data: {
    tenants: MetricGroup;
    users: MetricGroup;
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
          </div>
        ) : (
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-label={t('title')}>
            <MetricCard title={t('tenants')} icon={Building2} metrics={overview.tenants} t={t} />
            <MetricCard title={t('users')} icon={UsersRound} metrics={overview.users} t={t} />
          </section>
        )}
      </div>
    </main>
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
