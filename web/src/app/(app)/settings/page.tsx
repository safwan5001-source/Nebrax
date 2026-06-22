'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { currentUser } from '@/lib/auth';

interface Subscription {
  plan: string;
  active: boolean;
  trial_ends_at: string | null;
  subscription_ends_at: string | null;
  limits: { invoices_per_month: number | null; users: number | null };
  usage: { invoices_this_month: number; users: number };
}

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const near = limit !== null && pct >= 80;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="num text-text">
          {used} / {limit ?? '∞'}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-border/60">
        <div
          className={`h-full rounded ${near ? 'bg-warning' : 'bg-primary'}`}
          style={{ width: limit ? `${pct}%` : '4%' }}
        />
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const t = useTranslations('settings');
  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const user = currentUser();

  useEffect(() => {
    api<Subscription>('/subscription').then(setSub).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-text">{t('title')}</h1>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t('subscription')}</CardTitle>
            {sub && (
              <Badge tone={sub.active ? 'positive' : 'negative'}>{sub.active ? t('active') : t('expired')}</Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {loading || !sub ? (
              <Skeleton className="h-28 w-full" />
            ) : (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">{t('plan')}</span>
                  <Badge tone="neutral">{t(`plans.${sub.plan}`)}</Badge>
                </div>
                {sub.trial_ends_at && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted">{t('trial_ends')}</span>
                    <span className="num text-text">{sub.trial_ends_at}</span>
                  </div>
                )}
                {sub.subscription_ends_at && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted">{t('subscription_ends')}</span>
                    <span className="num text-text">{sub.subscription_ends_at}</span>
                  </div>
                )}
                <div className="space-y-2 border-t border-border pt-3">
                  <UsageBar label={t('invoices_usage')} used={sub.usage.invoices_this_month} limit={sub.limits.invoices_per_month} />
                  <UsageBar label={t('users_usage')} used={sub.usage.users} limit={sub.limits.users} />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('account')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">{t('name')}</dt>
                <dd className="text-text">{user?.name}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">{t('email')}</dt>
                <dd className="num text-text">{user?.email}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">{t('role')}</dt>
                <dd><Badge tone="muted">{t(`roles.${user?.role}`)}</Badge></dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
