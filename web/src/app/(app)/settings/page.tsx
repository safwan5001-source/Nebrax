'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Building2,
  CircleAlert,
  Pencil,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TabPanel, Tabs, type TabDef } from '@/components/ui/tabs';
import { CompanyDialog } from '@/components/settings/company-dialog';
import { AccountPreferencesCard } from '@/components/settings/account-preferences-card';
import { AccountSecurityCard } from '@/components/settings/account-security-card';
import { AccountDataExportCard } from '@/components/settings/account-data-export-card';
import { api } from '@/lib/api';
import { currentUser, persistUser, type AuthUser } from '@/lib/auth';
import type { Company } from '@/lib/company';

type AccountTab = 'account' | 'subscription' | 'security' | 'data';

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
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-muted">{label}</span>
        <span className="num shrink-0 text-text" dir="ltr">
          {limit === null ? `${used} / ∞` : `${used} / ${limit}`}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/70" aria-hidden="true">
        <div
          className={`h-full rounded-full transition-[width] ${near ? 'bg-warning' : 'bg-primary'}`}
          style={{ width: limit ? `${pct}%` : '4%' }}
        />
      </div>
    </div>
  );
}

function DetailRow({ label, value, numeric = false }: { label: string; value: string; numeric?: boolean }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border/70 py-2.5 last:border-b-0">
      <dt className="shrink-0 text-sm text-muted">{label}</dt>
      <dd className={`min-w-0 truncate text-end text-sm text-text ${numeric ? 'num' : ''}`} dir={numeric ? 'ltr' : undefined}>
        {value}
      </dd>
    </div>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: typeof Building2; children: React.ReactNode }) {
  return (
    <CardTitle className="flex items-center gap-2 text-base">
      <Icon className="h-4 w-4 text-muted" strokeWidth={1.7} aria-hidden="true" />
      {children}
    </CardTitle>
  );
}

export default function SettingsPage() {
  const t = useTranslations('settings');
  const [user, setUser] = useState<AuthUser | null>(() => currentUser());
  const canManage = user?.role === 'owner' || user?.role === 'admin';

  const [tab, setTab] = useState<AccountTab>('account');
  const [sub, setSub] = useState<Subscription | null>(null);
  const [loadingSubscription, setLoadingSubscription] = useState(true);
  const [subscriptionError, setSubscriptionError] = useState(false);
  const [company, setCompany] = useState<Company | null>(null);
  const [loadingCompany, setLoadingCompany] = useState(true);
  const [companyError, setCompanyError] = useState(false);
  const [companyDialog, setCompanyDialog] = useState(false);

  const loadSubscription = useCallback(() => {
    setLoadingSubscription(true);
    setSubscriptionError(false);

    api<Subscription>('/subscription')
      .then((response) => setSub(response))
      .catch(() => setSubscriptionError(true))
      .finally(() => setLoadingSubscription(false));
  }, []);

  const loadCompany = useCallback(() => {
    setLoadingCompany(true);
    setCompanyError(false);

    api<{ company: Company; user?: AuthUser }>('/me')
      .then((response) => {
        setCompany(response.company);
        if (response.user) {
          persistUser(response.user);
          setUser(response.user);
        }
      })
      .catch(() => setCompanyError(true))
      .finally(() => setLoadingCompany(false));
  }, []);

  useEffect(() => {
    loadSubscription();
    loadCompany();
  }, [loadCompany, loadSubscription]);

  const tabs: TabDef[] = [
    { id: 'account', label: t('account_tab') },
    { id: 'subscription', label: t('subscription_tab') },
    { id: 'security', label: t('security_tab') },
    { id: 'data', label: t('data_tab') },
  ];

  const subscriptionDate = sub?.trial_ends_at ?? sub?.subscription_ends_at ?? null;
  const subscriptionDateLabel = sub?.trial_ends_at ? t('trial_ends') : t('subscription_ends');
  const canEditCompany = canManage && sub?.active === true;

  const subscriptionCard = (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <SectionTitle icon={UsersRound}>{t('subscription_usage')}</SectionTitle>
          <p className="text-sm text-muted">{t('subscription_summary_hint')}</p>
        </div>
        {!loadingSubscription && sub && (
          <Badge tone={sub.active ? 'positive' : 'negative'}>{sub.active ? t('active') : t('expired')}</Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {loadingSubscription ? (
          <Skeleton className="h-36 w-full" />
        ) : subscriptionError || !sub ? (
          <div className="rounded border border-negative/20 bg-negative/5 p-3 text-sm text-negative" role="alert">
            <p>{t('subscription_load_failed')}</p>
            <Button variant="ghost" size="sm" className="mt-1 px-0 text-negative hover:bg-transparent" onClick={loadSubscription}>
              {t('retry')}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted">{t('plan')}</span>
              <Badge tone="neutral">{t(`plans.${sub.plan}`)}</Badge>
            </div>
            {subscriptionDate && (
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted">{subscriptionDateLabel}</span>
                <span className="num text-text" dir="ltr">{subscriptionDate}</span>
              </div>
            )}
            <div className="space-y-3 border-t border-border pt-4">
              <UsageBar label={t('invoices_usage')} used={sub.usage.invoices_this_month} limit={sub.limits.invoices_per_month} />
              <UsageBar label={t('users_usage')} used={sub.usage.users} limit={sub.limits.users} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );

  const companyCard = (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {company?.logo ? (
            <img src={company.logo} alt="" className="h-10 w-10 shrink-0 rounded border border-border object-contain" />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-border bg-primary-soft text-base font-semibold text-primary" aria-hidden="true">
              {company?.name?.trim().slice(0, 1) || '—'}
            </div>
          )}
          <div className="min-w-0 space-y-1">
            <SectionTitle icon={Building2}>{t('company')}</SectionTitle>
            {company && <p className="truncate text-sm text-muted">{company.name}</p>}
          </div>
        </div>
        {canManage && company && (
          <Button variant="outline" size="sm" disabled={!canEditCompany} onClick={() => setCompanyDialog(true)}>
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
            {t('edit_company')}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {loadingCompany ? (
          <Skeleton className="h-28 w-full" />
        ) : companyError || !company ? (
          <div className="rounded border border-negative/20 bg-negative/5 p-3 text-sm text-negative" role="alert">
            <p>{t('company_load_failed')}</p>
            <Button variant="ghost" size="sm" className="mt-1 px-0 text-negative hover:bg-transparent" onClick={loadCompany}>
              {t('retry')}
            </Button>
          </div>
        ) : (
          <dl className="grid gap-x-6 sm:grid-cols-2">
            <DetailRow label={t('company_name')} value={company.name} />
            <DetailRow label={t('account_number')} value={company.account_number?.toString() ?? '—'} numeric />
            <DetailRow label={t('support_number')} value={company.support_number?.toString() ?? '—'} numeric />
            <DetailRow label={t('vat_number')} value={company.vat_number ?? '—'} numeric />
            <DetailRow label={t('cr_number')} value={company.cr_number ?? '—'} numeric />
            <DetailRow label={t('base_currency')} value={company.currency ?? '—'} numeric />
            <DetailRow label={t('country')} value={company.country ?? '—'} numeric />
          </dl>
        )}
      </CardContent>
    </Card>
  );

  const accountCard = (
    <Card>
      <CardHeader>
        <SectionTitle icon={UserRound}>{t('account')}</SectionTitle>
      </CardHeader>
      <CardContent>
        <dl>
          <DetailRow label={t('name')} value={user?.name ?? '—'} />
          <DetailRow label={t('email')} value={user?.email ?? '—'} numeric />
          <div className="flex items-center justify-between gap-3 py-2.5">
            <dt className="text-sm text-muted">{t('role')}</dt>
            <dd><Badge tone="muted">{t(`roles.${user?.role ?? 'staff'}`)}</Badge></dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );

  const preferenceCard = <AccountPreferencesCard user={user} onSaved={setUser} />;
  const securityCard = <AccountSecurityCard user={user} onUserChanged={setUser} />;
  const dataCard = <AccountDataExportCard isOwner={user?.role === 'owner'} />;

  return (
    <div className="space-y-5">
      <header className="space-y-3 border-b border-border pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted">{t('breadcrumb')}</p>
            <h1 className="text-xl font-semibold text-text">{t('account_settings')}</h1>
            <p className="text-sm text-muted">{t('account_settings_hint')}</p>
          </div>
          {!loadingSubscription && sub && (
            <Badge tone={sub.active ? 'positive' : 'negative'}>{sub.active ? t('subscription_active') : t('subscription_expired')}</Badge>
          )}
        </div>
        {!loadingSubscription && sub && !sub.active && (
          <div className="flex gap-2 rounded border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-text" role="alert">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={1.8} aria-hidden="true" />
            <p>{t('subscription_expired_notice')}</p>
          </div>
        )}
      </header>

      <Tabs tabs={tabs} value={tab} onChange={(next) => setTab(next as AccountTab)} />

      {tab === 'account' && (
        <TabPanel id="account">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="space-y-4">
              {companyCard}
              <div className="grid gap-4 lg:grid-cols-2">
                {accountCard}
                {preferenceCard}
              </div>
            </div>
            <aside className="space-y-4">{subscriptionCard}</aside>
          </div>
        </TabPanel>
      )}

      {tab === 'subscription' && (
        <TabPanel id="subscription">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <SectionTitle icon={UsersRound}>{t('subscription')}</SectionTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted">{t('subscription_management_not_available')}</p>
                </CardContent>
              </Card>
            </div>
            <aside>{subscriptionCard}</aside>
          </div>
        </TabPanel>
      )}

      {tab === 'security' && <TabPanel id="security">{securityCard}</TabPanel>}
      {tab === 'data' && <TabPanel id="data">{dataCard}</TabPanel>}

      {companyDialog && (
        <CompanyDialog open onClose={() => setCompanyDialog(false)} onSaved={loadCompany} company={company} />
      )}
    </div>
  );
}
