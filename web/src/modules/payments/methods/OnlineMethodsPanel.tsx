'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CreditCard, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { PaymentBrandMark } from '@/components/payments/payment-brand-mark';
import { paymentBrandPresentation } from '@/lib/payment-brand-registry';
import {
  canToggle,
  methodErrorKey,
  methodTone,
  nextStep,
  toggleBlockReason,
  type OnlineMethod,
} from '@/modules/payments/methods/contract';

/**
 * تبويب «وسائل الدفع» (PAY-SETTINGS-UX): وسائل الدفع **الإلكتروني للعميل** (مدى/فيزا/ماستركارد/Apple Pay) وحالتها المحسوبة في الخادم.
 * مفتاح «إظهار للعميل» هو السلوك الوحيد القابل للضبط وهو مشروط بجاهزية محسوبة؛ البوابة الافتراضية معروضة قراءةً فقط لأن التوجيه متعدد البوابات غير مبنيّ
 * (H2-04) ولا تحويل تلقائي بين البوابات. الصفحة لا تخزّن مفاتيح ولا اعتمادات — تلك في تبويب البوابات وحده.
 */
export function OnlineMethodsPanel({
  canManage,
  refreshKey,
  onOpenGateways,
}: {
  canManage: boolean;
  /** يتغيّر حين تتغيّر اتصالات البوابات فتُعاد قراءة الجاهزية المحسوبة. */
  refreshKey: number;
  onOpenGateways: () => void;
}) {
  const t = useTranslations('onlinePaymentMethods');
  const { success, error: toastError } = useToast();
  const [methods, setMethods] = useState<OnlineMethod[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(false);
    api<{ data: OnlineMethod[] }>('/online-payment-methods')
      .then((response) => setMethods(response.data))
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function toggle(method: OnlineMethod, enabled: boolean) {
    setBusy(method.key);
    try {
      const response = await api<{ data: OnlineMethod }>(`/online-payment-methods/${method.key}`, { method: 'PUT', body: { enabled } });
      setMethods((current) => (current ?? []).map((item) => (item.key === method.key ? response.data : item)));
      success(t(enabled ? 'done.enabled' : 'done.disabled'));
    } catch (err) {
      toastError(t(`errors.${methodErrorKey(err)}`));
      load(); // الحالة قد تكون تغيّرت في الخادم (اتصال عُلّق مثلاً)
    } finally {
      setBusy(null);
    }
  }

  function stepText(method: OnlineMethod) {
    const step = nextStep(method);
    return step ? t(`step.${step}`) : null;
  }

  return (
    <div className="space-y-4">
      <div role="note" className="flex items-start gap-2 rounded-md border border-border bg-primary-soft/40 px-3 py-2.5 text-xs leading-relaxed text-text" data-testid="pm-scope-note">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.7} aria-hidden="true" />
        <div className="space-y-1">
          <p>{t('scope')}</p>
          <p>
            {t('scopeSeparate')}{' '}
            <Link href="/payment-methods" className="text-primary underline-offset-2 hover:underline">{t('scopeLink')}</Link>
          </p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>{t('list')}</CardTitle></CardHeader>
        <CardContent>
          {loadError ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">
              <span>{t('loadFailed')}</span>
              <Button size="sm" variant="outline" onClick={load}>{t('retry')}</Button>
            </div>
          ) : methods === null ? (
            <div className="space-y-2" role="status" aria-busy="true" aria-label={t('loading')}>
              {[0, 1, 2, 3].map((n) => <Skeleton key={n} className="h-24 w-full" />)}
            </div>
          ) : methods.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-12 text-center" data-testid="pm-empty">
              <CreditCard className="mx-auto h-8 w-8 text-muted" strokeWidth={1.5} aria-hidden="true" />
              <p className="mt-3 text-sm text-muted">{t('empty')}</p>
            </div>
          ) : (
            <ul className="space-y-3" data-testid="pm-list">
              {methods.map((method) => {
                const brand = paymentBrandPresentation(method.key);
                const block = toggleBlockReason(method, canManage);
                const step = stepText(method);
                const switchId = `pm-switch-${method.key}`;
                const reasonId = `pm-reason-${method.key}`;
                return (
                  <li key={method.key} className="rounded-md border border-border p-4" data-testid={`pm-item-${method.key}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-col gap-1.5">
                        {brand ? <PaymentBrandMark brand={brand} withIcon /> : <span className="text-sm font-semibold text-text">{method.key}</span>}
                        <Badge tone={methodTone(method.status)} className="w-fit" data-testid={`pm-status-${method.key}`}>{t(`status.${method.status}`)}</Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <label htmlFor={switchId} className="text-xs text-muted">{t('showToCustomer')}</label>
                        <Switch
                          id={switchId}
                          checked={method.enabled && method.status === 'enabled'}
                          disabled={!canToggle(method, canManage) || busy === method.key}
                          aria-describedby={reasonId}
                          onCheckedChange={(next) => void toggle(method, next)}
                        />
                      </div>
                    </div>

                    <p id={reasonId} className="mt-3 text-xs leading-relaxed text-muted" data-testid={`pm-reason-${method.key}`}>
                      {block ? t(`blocked.${block}`) : method.status === 'enabled' ? t('reasonEnabled') : t('reasonDisabled')}
                    </p>
                    {step && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 rounded bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
                        <span className="min-w-0 flex-1">{step}</span>
                        <Button size="sm" variant="outline" onClick={onOpenGateways}>{t('openGateways')}</Button>
                      </div>
                    )}

                    <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-xs">
                      <dt className="text-muted">{t('defaultGateway')}</dt>
                      <dd className="text-text" data-testid={`pm-gateway-${method.key}`}>
                        <bdi dir="auto">{method.effective_gateway ? t('autoGateway', { name: method.effective_gateway.name }) : t('noGateway')}</bdi>
                      </dd>
                      <dt className="text-muted">{t('usage')}</dt>
                      <dd className="flex flex-wrap gap-1.5">
                        <Badge tone={method.usage.invoices && method.status === 'enabled' ? 'positive' : 'muted'}>{t('usageInvoices')}</Badge>
                        <Badge tone="muted" data-testid={`pm-store-${method.key}`}>{t('usageStoreUnavailable')}</Badge>
                      </dd>
                    </dl>
                    {method.multiple_eligible_gateways && (
                      <p role="note" className="mt-2 text-xs leading-relaxed text-muted" data-testid={`pm-multi-${method.key}`}>{t('multiGateway')}</p>
                    )}

                    {method.connections.length > 0 && (
                      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t('connections')}>
                        {method.connections.map((connection) => (
                          <li key={connection.gateway_id}>
                            <Badge tone={connection.eligible ? 'positive' : 'muted'}>
                              {connection.gateway_name} · {t(connection.eligible ? 'eligible' : connection.requires_provider_setup ? 'providerSetup' : 'notReady')}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
