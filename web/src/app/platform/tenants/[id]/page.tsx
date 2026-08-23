'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ContractManagementCard, type ContractSubscription } from '@/components/platform/contract-management-card';
import { CommercialOperationsCard } from '@/components/platform/commercial-operations-card';
import { ApiError } from '@/lib/api';
import { isPlatformAuthenticated } from '@/lib/platform-auth';
import { platformApi } from '@/lib/platform-api';

const PLAN_OPTIONS = ['free', 'basic', 'pro', 'enterprise'] as const;

interface Subscription extends ContractSubscription {}

interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  plan: string;
  is_active: boolean;
  trial_ends_at: string | null;
  subscription_ends_at: string | null;
  created_at: string | null;
  users_count: number;
  active_users_count: number;
  contact: { name: string; email: string; phone: string | null } | null;
  subscriptions: Subscription[];
}

export default function PlatformTenantDetailPage() {
  const t = useTranslations('platformTenants');
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const tenantId = params.id;

  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [planChoice, setPlanChoice] = useState('free');
  const [trialDate, setTrialDate] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await platformApi<{ data: TenantDetail }>(`/platform/tenants/${tenantId}`);
      setTenant(response.data);
      setPlanChoice(response.data.plan);
      setTrialDate(response.data.trial_ends_at ?? '');
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t('loadFailed_detail'));
    } finally {
      setLoading(false);
    }
  }, [tenantId, t]);

  useEffect(() => {
    if (!isPlatformAuthenticated()) {
      router.replace('/platform/login');
      return;
    }
    load();
  }, [load, router]);

  async function savePlan() {
    setSaving(true);
    setNotice(null);
    try {
      const response = await platformApi<{ data: TenantDetail }>(`/platform/tenants/${tenantId}`, {
        method: 'PATCH',
        body: { plan: planChoice },
      });
      setTenant(response.data);
      setNotice(t('planUpdated'));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t('loadFailed_detail'));
    } finally {
      setSaving(false);
    }
  }

  async function saveTrial(clear: boolean) {
    setSaving(true);
    setNotice(null);
    try {
      const response = await platformApi<{ data: TenantDetail }>(`/platform/tenants/${tenantId}`, {
        method: 'PATCH',
        body: { trial_ends_at: clear ? null : trialDate || null },
      });
      setTenant(response.data);
      setTrialDate(response.data.trial_ends_at ?? '');
      setNotice(t('trialUpdated'));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t('loadFailed_detail'));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    if (!tenant) return;
    const goingActive = !tenant.is_active;
    const confirmed = window.confirm(goingActive ? t('confirmActivate') : t('confirmDeactivate'));
    if (!confirmed) return;

    setSaving(true);
    setNotice(null);
    try {
      const response = await platformApi<{ data: TenantDetail }>(`/platform/tenants/${tenantId}`, {
        method: 'PATCH',
        body: { is_active: goingActive },
      });
      setTenant(response.data);
      setNotice(t('statusUpdated'));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t('loadFailed_detail'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-primary" strokeWidth={1.7} aria-hidden="true" />
            <div>
              <h1 className="text-xl font-semibold text-text">{tenant?.name ?? t('detailTitle')}</h1>
              {tenant && <p className="mt-1 text-sm text-muted">{tenant.slug}</p>}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => router.push('/platform/tenants')}>
            <ArrowRight className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
            {t('back')}
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-4xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
        {error && (
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-negative" role="alert">{error}</p>
              <Button variant="outline" className="mt-3" onClick={load}>{t('retry')}</Button>
            </CardContent>
          </Card>
        )}

        {notice && (
          <div className="rounded border border-positive/20 bg-positive/10 px-3 py-2 text-sm text-positive" role="status">
            {notice}
          </div>
        )}

        {loading || !tenant ? (
          <div className="space-y-4">
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>{t('detailTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
                <Info label={t('contactName')} value={tenant.contact?.name ?? '—'} />
                <Info label={t('contact')} value={tenant.contact?.email ?? '—'} />
                <Info label={t('phone')} value={tenant.contact?.phone ?? '—'} />
                <Info label={t('status')}>
                  <Badge tone={tenant.is_active ? 'positive' : 'negative'}>
                    {tenant.is_active ? t('active') : t('inactive')}
                  </Badge>
                </Info>
                <Info label={t('plan')} value={tenant.plan} />
                <Info label={t('trialEndsAt')} value={tenant.trial_ends_at ?? t('noTrial')} />
                <Info label={t('activeUsers')} value={String(tenant.active_users_count)} />
                <Info label={t('totalUsers')} value={String(tenant.users_count)} />
                <Info label={t('registeredOn')} value={tenant.created_at ?? '—'} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>{t('changePlan')}</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-muted">{t('currentPlan')}</label>
                  <Select value={planChoice} onChange={(e) => setPlanChoice(e.target.value)} className="w-40">
                    {PLAN_OPTIONS.map((plan) => (
                      <option key={plan} value={plan}>{plan}</option>
                    ))}
                  </Select>
                </div>
                <Button onClick={savePlan} disabled={saving || planChoice === tenant.plan}>
                  {saving ? t('saving') : t('savePlan')}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>{t('trialManagement')}</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-muted">{t('newTrialEndDate')}</label>
                  <Input type="date" value={trialDate} onChange={(e) => setTrialDate(e.target.value)} className="w-44" />
                </div>
                <Button onClick={() => saveTrial(false)} disabled={saving || !trialDate}>
                  {saving ? t('saving') : t('saveTrial')}
                </Button>
                <Button variant="outline" onClick={() => saveTrial(true)} disabled={saving || !tenant.trial_ends_at}>
                  {t('clearTrial')}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>{t('accessManagement')}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted">{t('accessNotice')}</p>
                <Button variant={tenant.is_active ? 'danger' : 'primary'} onClick={toggleActive} disabled={saving}>
                  {tenant.is_active ? t('deactivate') : t('activate')}
                </Button>
              </CardContent>
            </Card>

            <ContractManagementCard tenantId={tenantId} subscriptions={tenant.subscriptions} onChanged={load} />
            <CommercialOperationsCard tenantId={tenantId} onChanged={load} />

            <p className="text-center text-xs text-muted">{t('auditNotice')}</p>
          </>
        )}
      </div>
    </main>
  );
}

function Info({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div>
      <p className="text-muted">{label}</p>
      <div className="num mt-1 font-medium text-text">{children ?? value}</div>
    </div>
  );
}
