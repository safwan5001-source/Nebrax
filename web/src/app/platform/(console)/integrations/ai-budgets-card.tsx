'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { platformApi } from '@/lib/platform-api';
import { buildBudgetPayload, microToUsd, usagePercent, type AiBudgetOverview, type BudgetForm, type BudgetRow } from './ai-budgets';

type Tenant = { id: string; name: string };

const fieldClass = 'h-11 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40';
const num = (value: number): string => value.toLocaleString('en-US');

function Usage({ row, label }: { row: BudgetRow; label: string }): JSX.Element {
  const percent = usagePercent(row);

  return (
    <div className="space-y-1" role="group" aria-label={label}>
      <div className="h-2 w-full overflow-hidden rounded bg-border" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label}>
        <div className={percent >= 90 ? 'h-full bg-negative' : 'h-full bg-primary'} style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs text-muted" dir="ltr">
        {num(row.used_tokens + row.reserved_tokens)} / {num(row.cap_tokens)} tokens · ${microToUsd(row.used_cost_micro_usd + row.reserved_cost_micro_usd)} / ${microToUsd(row.cap_cost_micro_usd)}
      </p>
    </div>
  );
}

/**
 * ميزانيات الذكاء الاصطناعي (AI-07): واجهة فوق `GET/PUT /platform/ai-budgets` التي تكتب عبر `AiBudgetService` نفسه.
 * لا حساب مالي هنا: الأسقف أعداد صحيحة (رموز، micro-USD) تُبنى في `ai-budgets.ts` بلا float، والخادم هو المرجع
 * لكل قيد (فترة ماضية، حدود قصوى، سقف المؤسسة ≤ السقف العالمي). كلمة المرور لا تُخزَّن بعد الإرسال.
 */
export function AiBudgetsCard(): JSX.Element {
  const t = useTranslations('platformIntegrations');
  const [overview, setOverview] = useState<AiBudgetOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [form, setForm] = useState<BudgetForm>({ scope: 'global', tenantId: '', period: '', tokens: '', usd: '', password: '' });
  const [tenantQuery, setTenantQuery] = useState('');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (period?: string) => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await platformApi<{ data: AiBudgetOverview }>(`/platform/ai-budgets${period ? `?period=${encodeURIComponent(period)}` : ''}`);
      const data = response?.data;
      // شكل غير متوقع (خادم أقدم/ردّ ناقص) = فشل تحميل صريح لا شاشة مكسورة.
      if (!data || typeof data.period !== 'string' || !data.policy || !data.limits || !Array.isArray(data.tenants) || !Array.isArray(data.by_feature)) throw new Error('shape');
      setOverview(data);
      setForm((current) => ({ ...current, period: current.period || data.current_period }));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const query = tenantQuery.trim();
    const id = ++seq.current;
    if (query.length < 2) {
      setTenants([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const response = await platformApi<{ data: Tenant[] }>(`/platform/tenants?${new URLSearchParams({ search: query, per_page: '8' }).toString()}`);
        if (id === seq.current) setTenants(response.data ?? []);
      } catch {
        if (id === seq.current) setTenants([]);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [tenantQuery]);

  async function save(): Promise<void> {
    if (!overview) return;
    const built = buildBudgetPayload(form, overview.limits, overview.current_period);
    if (!built.ok) {
      setNotice({ ok: false, message: t(`aiBudgetError_${built.error}`) });

      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const response = await platformApi<{ data: AiBudgetOverview }>('/platform/ai-budgets', { method: 'PUT', body: built.payload });
      setOverview(response.data);
      setNotice({ ok: true, message: t('aiBudgetSaved') });
    } catch (error) {
      const message = error instanceof ApiError && error.status === 422 ? t('aiBudgetRejected') : t('saveFailed');
      setNotice({ ok: false, message });
    } finally {
      setForm((current) => ({ ...current, password: '' }));
      setBusy(false);
    }
  }

  function edit(tenantId: string | null, row: BudgetRow): void {
    setForm((current) => ({
      ...current,
      scope: tenantId === null ? 'global' : 'tenant',
      tenantId: tenantId ?? '',
      tokens: String(row.cap_tokens),
      usd: (row.cap_cost_micro_usd / 1_000_000).toFixed(6).replace(/\.?0+$/, '') || '0',
    }));
  }

  return (
    <Card className="xl:col-span-2" aria-labelledby="ai-budgets-title">
      <CardHeader>
        <CardTitle id="ai-budgets-title">{t('aiBudgetTitle')}</CardTitle>
        <p className="text-sm text-muted">{t('aiBudgetDescription')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && !overview ? (
          <div className="space-y-2" data-testid="ai-budgets-skeleton"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
        ) : loadError || !overview ? (
          <div className="flex flex-wrap items-start gap-3">
            <p role="alert" className="min-w-0 flex-1 text-sm text-negative">{t('aiBudgetLoadFailed')}</p>
            <Button variant="outline" className="h-11" onClick={() => void load()}>{t('retry')}</Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge wrap tone={overview.policy.meter_document_extraction ? 'positive' : 'muted'}>{overview.policy.meter_document_extraction ? t('aiBudgetMeterOn') : t('aiBudgetMeterOff')}</Badge>
              <Badge wrap tone={overview.policy.assistant_provider === 'mock' ? 'muted' : 'warning'}>{t('aiBudgetProvider', { provider: overview.policy.assistant_provider })}</Badge>
              <Badge wrap tone={overview.policy.assistant_external_network_enabled ? 'warning' : 'muted'}>{overview.policy.assistant_external_network_enabled ? t('aiBudgetNetworkOn') : t('aiBudgetNetworkOff')}</Badge>
              <span className="text-muted" dir="ltr">{overview.period}</span>
            </div>
            {overview.over_allocated ? <p role="status" className="text-sm text-warning">{t('aiBudgetOverAllocated')}</p> : null}

            <section aria-label={t('aiBudgetGlobal')} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-text">{t('aiBudgetGlobal')}</p>
                {overview.global ? <Button variant="outline" className="h-11" onClick={() => edit(null, overview.global as BudgetRow)}>{t('aiBudgetEdit')}</Button> : null}
              </div>
              {overview.global ? <Usage row={overview.global} label={t('aiBudgetGlobal')} /> : <p className="text-sm text-negative">{t('aiBudgetNoGlobal')}</p>}
            </section>

            <section aria-label={t('aiBudgetTenants')} className="space-y-2">
              <p className="font-medium text-text">{t('aiBudgetTenants')}</p>
              {overview.tenants.length === 0 ? <p className="text-sm text-muted">{t('aiBudgetNoTenants')}</p> : (
                <ul className="space-y-2">
                  {overview.tenants.map((row) => (
                    <li key={row.tenant_id} className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="break-words text-sm font-medium text-text">{row.tenant_name ?? row.tenant_id}</p>
                        <Usage row={row} label={row.tenant_name ?? row.tenant_id} />
                      </div>
                      <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={() => edit(row.tenant_id, row)}>{t('aiBudgetEdit')}</Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-label={t('aiBudgetByFeature')} className="space-y-1">
              <p className="font-medium text-text">{t('aiBudgetByFeature')}</p>
              {overview.by_feature.length === 0 ? <p className="text-sm text-muted">{t('aiBudgetNoUsage')}</p> : (
                <ul className="text-sm text-muted">
                  {overview.by_feature.map((row) => (
                    <li key={row.feature} dir="ltr" className="flex flex-wrap gap-x-3">
                      <span className="font-medium text-text">{row.feature}</span>
                      <span>{num(row.requests)} req</span><span>{num(row.failed)} failed</span><span>{num(row.tokens)} tokens</span><span>${row.cost_usd}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <form className="space-y-3 rounded-md border border-border p-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
              <p className="font-medium text-text">{t('aiBudgetSet')}</p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="ai-budget-scope">{t('aiBudgetScope')}</Label>
                  <select id="ai-budget-scope" className={fieldClass} value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value === 'tenant' ? 'tenant' : 'global' })}>
                    <option value="global">{t('aiBudgetGlobal')}</option>
                    <option value="tenant">{t('aiBudgetTenantOne')}</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ai-budget-period">{t('aiBudgetPeriod')}</Label>
                  <Input id="ai-budget-period" className="h-11" dir="ltr" placeholder="YYYY-MM" value={form.period} onChange={(event) => setForm({ ...form, period: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ai-budget-tokens">{t('aiBudgetTokens')}</Label>
                  <Input id="ai-budget-tokens" className="h-11" dir="ltr" inputMode="numeric" value={form.tokens} onChange={(event) => setForm({ ...form, tokens: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ai-budget-usd">{t('aiBudgetUsd')}</Label>
                  <Input id="ai-budget-usd" className="h-11" dir="ltr" inputMode="decimal" value={form.usd} onChange={(event) => setForm({ ...form, usd: event.target.value })} />
                </div>
              </div>
              {form.scope === 'tenant' ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="ai-budget-tenant-search">{t('aiBudgetTenantSearch')}</Label>
                    <Input id="ai-budget-tenant-search" className="h-11" type="search" autoComplete="off" value={tenantQuery} onChange={(event) => setTenantQuery(event.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ai-budget-tenant">{t('aiBudgetTenantOne')}</Label>
                    <select id="ai-budget-tenant" className={fieldClass} value={form.tenantId} onChange={(event) => setForm({ ...form, tenantId: event.target.value })}>
                      <option value="">{t('aiBudgetTenantChoose')}</option>
                      {form.tenantId !== '' && !tenants.some((tenant) => tenant.id === form.tenantId) ? <option value={form.tenantId}>{overview.tenants.find((row) => row.tenant_id === form.tenantId)?.tenant_name ?? form.tenantId}</option> : null}
                      {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
                    </select>
                  </div>
                </div>
              ) : null}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ai-budget-password">{t('currentPassword')}</Label>
                  <Input id="ai-budget-password" className="h-11" type="password" autoComplete="current-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
                </div>
                <div className="flex items-end sm:justify-end">
                  <Button type="submit" className="h-11 w-full sm:w-auto" disabled={busy}>{busy ? t('aiBudgetSaving') : t('aiBudgetSave')}</Button>
                </div>
              </div>
              <p className="text-xs text-muted">{t('aiBudgetHint')}</p>
              {notice ? (notice.ok ? <p role="status" className="text-sm text-positive">{notice.message}</p> : <p role="alert" className="text-sm text-negative">{notice.message}</p>) : null}
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default AiBudgetsCard;
