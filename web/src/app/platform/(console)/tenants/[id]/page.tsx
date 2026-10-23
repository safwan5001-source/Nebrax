'use client';

import Link from 'next/link';
import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronLeft, Copy, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ContractManagementCard, type ContractSubscription } from '@/components/platform/contract-management-card';
import { CommercialOperationsCard } from '@/components/platform/commercial-operations-card';
import { ApplicationOverrideCard } from '@/components/platform/application-override-card';
import { AiActionControlsCard } from '@/components/platform/ai-action-controls-card';
import { ConfirmDialog } from '@/components/platform/confirm-dialog';
import { ApiError } from '@/lib/api';
import { isPlatformAuthenticated } from '@/lib/platform-auth';
import { platformApi } from '@/lib/platform-api';

const PLAN_OPTIONS = ['free', 'basic', 'pro', 'enterprise'] as const;

interface Subscription extends ContractSubscription {}

interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  account_number: number | null;
  support_number: number | null;
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
  const [accessDialogOpen, setAccessDialogOpen] = useState(false);
  const accessButtonRef = useRef<HTMLButtonElement>(null);

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

  async function copyReference(value: number | null) {
    if (value === null || !navigator.clipboard) return;

    try {
      await navigator.clipboard.writeText(String(value));
      setNotice(t('referenceCopied'));
    } catch {
      setError(t('loadFailed_detail'));
    }
  }

  async function savePlan() {
    setSaving(true);
    setNotice(null);
    setError(null);
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
    setError(null);
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

  // الحوار وحده يطلب التأكيد؛ فتحه لا يرسل شيئاً. الحمولة هي نفسها: { is_active }.
  async function setActive(goingActive: boolean) {
    setSaving(true);
    setNotice(null);
    setError(null);
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
      setAccessDialogOpen(false);
    }
  }

  const goingActive = tenant ? !tenant.is_active : false;

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="space-y-3">
        <Button asChild variant="ghost" className="-ms-2 h-11 px-2">
          <Link href="/platform/tenants">
            <ChevronLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.7} aria-hidden="true" />
            {t('backToTenants')}
          </Link>
        </Button>
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-1 h-6 w-6 shrink-0 text-primary" strokeWidth={1.7} aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="break-words text-xl font-semibold text-text">{tenant?.name ?? t('detailTitle')}</h1>
            {tenant && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted">
                <span className="break-all" dir="ltr">{tenant.slug}</span>
                <Badge wrap tone={tenant.is_active ? 'positive' : 'negative'}>{tenant.is_active ? t('active') : t('inactive')}</Badge>
                <Badge wrap tone="muted">{tenant.plan}</Badge>
              </div>
            )}
          </div>
        </div>
      </header>

      {error && (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-negative" role="alert">{error}</p>
            <Button variant="outline" className="h-11" onClick={load}>{t('retry')}</Button>
          </CardContent>
        </Card>
      )}

      {notice && (
        <div className="rounded border border-positive/20 bg-positive/10 px-3 py-2 text-sm text-positive" role="status">
          {notice}
        </div>
      )}

      {loading && !tenant ? (
        <div className="space-y-4" data-testid="tenant-skeleton">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : !tenant ? null : (
        <div className="space-y-6" aria-busy={loading}>
          <section aria-labelledby="tenant-identity">
            <Card>
              <CardHeader>
                <CardTitle as="h2" id="tenant-identity">{t('detailTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Info label={t('accountNumber')}>
                  <ReferenceValue value={tenant.account_number} copyLabel={t('copyReference')} onCopy={copyReference} />
                </Info>
                <Info label={t('supportNumber')}>
                  <ReferenceValue value={tenant.support_number} copyLabel={t('copyReference')} onCopy={copyReference} />
                </Info>
                <Info label={t('contactName')} value={tenant.contact?.name ?? '—'} />
                <Info label={t('contact')} value={tenant.contact?.email ?? '—'} ltr breakAll />
                <Info label={t('phone')} value={tenant.contact?.phone ?? '—'} ltr />
                <Info label={t('status')}>
                  <Badge wrap tone={tenant.is_active ? 'positive' : 'negative'}>
                    {tenant.is_active ? t('active') : t('inactive')}
                  </Badge>
                </Info>
                <Info label={t('plan')} value={tenant.plan} />
                <Info label={t('trialEndsAt')} value={tenant.trial_ends_at ?? t('noTrial')} ltr={Boolean(tenant.trial_ends_at)} />
                <Info label={t('subscriptionEndsAt')} value={tenant.subscription_ends_at ?? '—'} ltr={Boolean(tenant.subscription_ends_at)} />
                <Info label={t('activeUsers')} value={String(tenant.active_users_count)} />
                <Info label={t('totalUsers')} value={String(tenant.users_count)} />
                <Info label={t('registeredOn')} value={tenant.created_at ?? '—'} ltr={Boolean(tenant.created_at)} />
              </CardContent>
            </Card>
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section aria-labelledby="tenant-plan">
              <Card className="h-full">
                <CardHeader><CardTitle as="h2" id="tenant-plan">{t('changePlan')}</CardTitle></CardHeader>
                <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="sm:w-44">
                    <label htmlFor="tenant-plan-select" className="mb-1.5 block text-sm font-medium text-muted">{t('currentPlan')}</label>
                    <Select id="tenant-plan-select" value={planChoice} onChange={(e) => setPlanChoice(e.target.value)} className="h-11">
                      {PLAN_OPTIONS.map((plan) => (
                        <option key={plan} value={plan}>{plan}</option>
                      ))}
                    </Select>
                  </div>
                  <Button wrap className="min-h-11 w-full sm:w-auto" onClick={savePlan} disabled={saving || planChoice === tenant.plan}>
                    {saving ? t('saving') : t('savePlan')}
                  </Button>
                </CardContent>
              </Card>
            </section>

            <section aria-labelledby="tenant-trial">
              <Card className="h-full">
                <CardHeader><CardTitle as="h2" id="tenant-trial">{t('trialManagement')}</CardTitle></CardHeader>
                <CardContent className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                  <div className="sm:w-44">
                    <label htmlFor="tenant-trial-date" className="mb-1.5 block text-sm font-medium text-muted">{t('newTrialEndDate')}</label>
                    <Input id="tenant-trial-date" type="date" dir="ltr" value={trialDate} onChange={(e) => setTrialDate(e.target.value)} className="h-11" />
                  </div>
                  <Button className="h-11 w-full sm:w-auto" onClick={() => saveTrial(false)} disabled={saving || !trialDate}>
                    {saving ? t('saving') : t('saveTrial')}
                  </Button>
                  <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={() => saveTrial(true)} disabled={saving || !tenant.trial_ends_at}>
                    {t('clearTrial')}
                  </Button>
                </CardContent>
              </Card>
            </section>
          </div>

          <div className="space-y-6">
            <ContractManagementCard tenantId={tenantId} subscriptions={tenant.subscriptions} onChanged={load} />
            <CommercialOperationsCard tenantId={tenantId} onChanged={load} />
            <ApplicationOverrideCard tenantId={tenantId} onChanged={load} />
            <AiActionControlsCard tenantId={tenantId} />
          </div>

          <section aria-labelledby="tenant-access">
            <Card className="border-negative/40">
              <CardHeader>
                <CardTitle as="h2" id="tenant-access" className="flex items-center gap-2 text-text">
                  <ShieldAlert className="h-4 w-4 text-negative" strokeWidth={1.7} aria-hidden="true" />
                  {t('accessManagement')}
                  <span className="min-w-0 rounded border border-negative/40 px-1.5 py-0.5 text-xs font-medium text-negative">{t('sensitiveAction')}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted">{t('accessNotice')}</p>
                <Button
                  ref={accessButtonRef as React.Ref<HTMLElement>}
                  variant={tenant.is_active ? 'danger' : 'primary'}
                  className="h-11 w-full sm:w-auto"
                  onClick={() => setAccessDialogOpen(true)}
                  disabled={saving}
                >
                  {tenant.is_active && <ShieldAlert className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />}
                  {tenant.is_active ? t('deactivate') : t('activate')}
                </Button>
              </CardContent>
            </Card>
          </section>

          <p className="text-center text-xs text-muted">{t('auditNotice')}</p>
        </div>
      )}

      {tenant && (
        <ConfirmDialog
          open={accessDialogOpen}
          onCancel={() => setAccessDialogOpen(false)}
          onConfirm={() => void setActive(goingActive)}
          title={t(goingActive ? 'activateDialogTitle' : 'deactivateDialogTitle', { name: tenant.name })}
          description={goingActive ? t('confirmActivate') : t('confirmDeactivate')}
          confirmLabel={goingActive ? t('activate') : t('deactivate')}
          confirmVariant={goingActive ? 'primary' : 'danger'}
          confirmIcon={goingActive ? undefined : <ShieldAlert className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />}
          cancelLabel={t('goBack')}
          closeLabel={t('close')}
          busy={saving}
          returnFocusTo={accessButtonRef.current}
        />
      )}
    </main>
  );
}

function ReferenceValue({ value, copyLabel, onCopy }: { value: number | null; copyLabel: string; onCopy: (value: number | null) => void }) {
  return (
    <span className="flex items-center gap-1" dir="ltr">
      <span className="num">{value ?? '—'}</span>
      {value !== null && (
        // مساحة اللمس 44px بحشوٍ لا بتكبير الأيقونة.
        <Button type="button" variant="ghost" size="sm" className="h-11 w-11 p-0" onClick={() => onCopy(value)} aria-label={copyLabel} title={copyLabel}>
          <Copy className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
        </Button>
      )}
    </span>
  );
}

function Info({ label, value, children, ltr, breakAll }: { label: string; value?: string; children?: React.ReactNode; ltr?: boolean; breakAll?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-muted">{label}</p>
      <div className={`num mt-1 font-medium text-text${breakAll ? ' break-all' : ''}`} dir={ltr ? 'ltr' : undefined}>{children ?? value}</div>
    </div>
  );
}
