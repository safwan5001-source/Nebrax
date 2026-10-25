'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CreditCard, Info, SlidersHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { PaymentBrandMark } from '@/components/payments/payment-brand-mark';
import { paymentBrandPresentation } from '@/lib/payment-brand-registry';
import { MethodManageSheet } from '@/modules/payments/methods/MethodManageSheet';
import {
  canToggle,
  isEnabledNotReady,
  methodErrorKey,
  methodTone,
  type ManageDraft,
  type OnlineMethod,
} from '@/modules/payments/methods/contract';

/**
 * تبويب «وسائل الدفع» (PAY-SETTINGS-UX-2): صفٌّ مختصر لكل وسيلة — الشعار والاسم والحالة ومفتاح «إظهار» وزر «إدارة».
 * «إظهار للعميل» اختيار التاجر (يجوز قبل جاهزية البوابة)، والجاهزية للتحصيل حالة محسوبة منفصلة. زر «إدارة» يفتح لوحة الإعدادات المخزَّنة فعلاً
 * (البوابة الافتراضية، فواتير/متجر) بلا خيارات وهمية. الصفحة لا تخزّن مفاتيح ولا اعتمادات — تلك في «إدارة» البوابة.
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
  const [managing, setManaging] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(false);
    api<{ data: OnlineMethod[] }>('/online-payment-methods')
      .then((response) => setMethods(response.data))
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  /** PUT واحد؛ يستبدل الصف بما ردّه الخادم (لا تفاؤل). يعيد true عند النجاح. */
  async function save(method: OnlineMethod, body: Record<string, unknown>, doneKey: string): Promise<boolean> {
    setBusy(method.key);
    try {
      const response = await api<{ data: OnlineMethod }>(`/online-payment-methods/${method.key}`, { method: 'PUT', body });
      setMethods((current) => (current ?? []).map((item) => (item.key === method.key ? response.data : item)));
      success(t(doneKey));
      return true;
    } catch (err) {
      toastError(t(`errors.${methodErrorKey(err)}`));
      load(); // الحالة قد تكون تغيّرت في الخادم (اتصال عُلّق مثلاً)
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function saveManage(method: OnlineMethod, changes: Partial<ManageDraft>) {
    if (await save(method, changes, 'done.saved')) setManaging(null);
  }

  const managed = methods?.find((item) => item.key === managing) ?? null;

  return (
    <div className="space-y-4">
      <div role="note" className="flex items-start gap-2 rounded-md border border-border bg-primary-soft/40 px-3 py-2.5 text-xs leading-relaxed text-text" data-testid="pm-scope-note">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.7} aria-hidden="true" />
        <div className="min-w-0 space-y-1">
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
              {[0, 1, 2, 3].map((n) => <Skeleton key={n} className="h-14 w-full" />)}
            </div>
          ) : methods.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-12 text-center" data-testid="pm-empty">
              <CreditCard className="mx-auto h-8 w-8 text-muted" strokeWidth={1.5} aria-hidden="true" />
              <p className="mt-3 text-sm text-muted">{t('empty')}</p>
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border" data-testid="pm-list">
              {methods.map((method) => {
                const brand = paymentBrandPresentation(method.key);
                const switchId = `pm-switch-${method.key}`;
                const labelId = `pm-label-${method.key}`;
                return (
                  <li key={method.key} className="p-3" data-testid={`pm-item-${method.key}`}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
                        <span id={labelId} className="min-w-0">
                          {brand ? <PaymentBrandMark brand={brand} withIcon /> : <span className="text-sm font-semibold text-text">{method.key}</span>}
                        </span>
                        <Badge tone={methodTone(method.status)} data-testid={`pm-status-${method.key}`}>{t(`status.${method.status}`)}</Badge>
                      </div>
                      <div className="flex items-center justify-between gap-3 sm:justify-end">
                        <div className="flex items-center gap-2">
                          <label id={`${switchId}-l`} htmlFor={switchId} className="text-xs text-muted">{t('showToCustomer')}</label>
                          <Switch
                            id={switchId}
                            checked={method.enabled}
                            disabled={!canToggle(canManage) || busy === method.key}
                            aria-labelledby={`${switchId}-l ${labelId}`}
                            onCheckedChange={(next) => void save(method, { enabled: next }, next ? 'done.enabled' : 'done.disabled')}
                          />
                        </div>
                        <Button size="sm" variant="outline" onClick={() => setManaging(method.key)} data-testid={`pm-manage-${method.key}`}>
                          <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                          {t('manage.open')}
                        </Button>
                      </div>
                    </div>
                    {isEnabledNotReady(method) && (
                      <p className="mt-2 text-xs leading-relaxed text-warning" data-testid={`pm-hint-${method.key}`}>{t('hintNotReady')}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <MethodManageSheet
        method={managed}
        canManage={canManage}
        saving={managed !== null && busy === managed.key}
        onClose={() => setManaging(null)}
        onSave={(method, changes) => void saveManage(method, changes)}
        onOpenGateways={() => {
          setManaging(null);
          onOpenGateways();
        }}
      />
    </div>
  );
}
