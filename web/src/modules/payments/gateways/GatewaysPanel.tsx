'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CreditCard, Plus, SlidersHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useCan } from '@/lib/use-can';
import { PaymentBrandMark } from '@/components/payments/payment-brand-mark';
import { gatewayProviderBrand } from '@/lib/payment-brand-registry';
import { ConnectionFormDialog } from '@/modules/payments/gateways/connection-form-dialog';
import {
  MANAGE_PERMISSION,
  VIEW_PERMISSION,
  apiErrorCode,
  apiErrorMessage,
  errorMessageKey,
  gatewayDisplayName,
  statusTone,
  type GatewayAction,
  type GatewayConnection,
} from '@/modules/payments/gateways/contract';
import { GatewayDetailSheet } from '@/modules/payments/gateways/GatewayDetailSheet';
import { EventsDialog } from '@/modules/payments/gateways/events-dialog';
import { RevokeDialog } from '@/modules/payments/gateways/revoke-dialog';
import { RotateCredentialsDialog } from '@/modules/payments/gateways/rotate-credentials-dialog';

type Transition = 'activate' | 'suspend';

/**
 * تبويب «بوابات الدفع» (PAY-H1-05 + PAY-SETTINGS-UX-2). اتصالات المزوّد التي يضيفها التاجر بنفسه، كبطاقات مختصرة (الشعار، الاسم، حالة الاتصال، البيئة) وزر «إدارة» واحد.
 * «إدارة» يفتح `GatewayDetailSheet` بكل الإعدادات القائمة (الاعتماد والمفاتيح، Webhooks، الاستردادات والتسويات، الأمان) وكل الإجراءات؛ لا نظام إعدادات موازٍ.
 * القراءة `payments.view`، والإجراءات (إضافة/تعديل/تفعيل/إيقاف/إلغاء/تدوير/سجل) `payment_gateways.manage`؛ الخادم هو الحاسم.
 * لا أسرار تُعرض أبداً: مؤشرات «محفوظ» فقط. المصدر الوحيد لإعدادات الاتصال هنا؛ تبويب «وسائل الدفع» يقرأ حالته المحسوبة ولا يخزّن مفاتيح.
 * `onChanged` يُعلم الصفحة بأي تغيّر في الاتصالات لإعادة حساب جاهزية الوسائل.
 */
export function GatewaysPanel({ canManage, demo, onChanged }: { canManage: boolean; demo: boolean; onChanged?: () => void }) {
  const t = useTranslations('paymentGateways');
  const locale = useLocale();
  const askConfirm = useConfirm();
  const { success, error: toastError } = useToast();
  const { hydrated } = useCan();
  const [connections, setConnections] = useState<GatewayConnection[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [formState, setFormState] = useState<{ editing: GatewayConnection | null; nonce: number } | null>(null);
  const [rotating, setRotating] = useState<GatewayConnection | null>(null);
  const [revoking, setRevoking] = useState<GatewayConnection | null>(null);
  const [viewingEvents, setViewingEvents] = useState<GatewayConnection | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    api<{ data: GatewayConnection[] }>('/payment-gateways')
      .then((response) => setConnections(response.data))
      .catch((err) => setLoadError(apiErrorMessage(err) ?? t('loadFailed')));
  }, [t]);

  useEffect(() => {
    if (hydrated) load();
  }, [hydrated, load]);

  function upsert(next: GatewayConnection) {
    setConnections((current) => {
      const list = current ?? [];
      return list.some((item) => item.id === next.id) ? list.map((item) => (item.id === next.id ? next : item)) : [next, ...list];
    });
    onChanged?.();
  }

  function failure(err: unknown, fallback: string) {
    const code = apiErrorCode(err);
    toastError(code && t.has(errorMessageKey(code)) ? t(errorMessageKey(code)) : (apiErrorMessage(err) ?? fallback));
  }

  async function transition(connection: GatewayConnection, action: Transition) {
    const name = gatewayDisplayName(connection, locale);
    const ok = await askConfirm({
      message: t(`confirm.${action}`, { name }),
      tone: action === 'activate' ? 'default' : 'danger',
    });
    if (!ok) return;
    setBusy(connection.id);
    try {
      const response = await api<{ data: GatewayConnection }>(`/payment-gateways/${connection.id}/${action}`, { method: 'POST', body: {} });
      upsert(response.data);
      success(t(`done.${action}`));
    } catch (err) {
      failure(err, t('actionFailed'));
    } finally {
      setBusy(null);
    }
  }

  /** التحقق قراءة آمنة لدى المزوّد (لا أثر مالي) فلا يحتاج تأكيداً؛ النتيجة تُعرض فوراً وسجل الاتصال يحفظ المحاولة. */
  async function verify(connection: GatewayConnection) {
    setBusy(connection.id);
    try {
      const response = await api<{ data: GatewayConnection }>(`/payment-gateways/${connection.id}/verify`, { method: 'POST', body: {} });
      upsert(response.data);
      success(t('done.verify'));
    } catch (err) {
      failure(err, t('actionFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function remove(connection: GatewayConnection) {
    if (!(await askConfirm({ message: t('confirm.delete', { name: gatewayDisplayName(connection, locale) }), tone: 'danger' }))) return;
    setBusy(connection.id);
    try {
      await api(`/payment-gateways/${connection.id}`, { method: 'DELETE' });
      setConnections((current) => (current ?? []).filter((item) => item.id !== connection.id));
      onChanged?.();
      success(t('done.delete'));
    } catch (err) {
      failure(err, t('actionFailed'));
    } finally {
      setBusy(null);
    }
  }

  const detailConnection = connections?.find((item) => item.id === detailId) ?? null;

  function run(connection: GatewayConnection, action: GatewayAction) {
    switch (action) {
      case 'edit': return setFormState({ editing: connection, nonce: Date.now() });
      case 'rotate': return setRotating(connection);
      case 'revoke': return setRevoking(connection);
      case 'events': return setViewingEvents(connection);
      case 'delete': return void remove(connection);
      case 'verify': return void verify(connection);
      default: return void transition(connection, action);
    }
  }

  return (
    <div className="space-y-5">
      {demo && <p role="note" className="rounded-md border border-dashed border-border px-4 py-2 text-xs text-muted" data-testid="pg-demo">{t('demoReadOnly')}</p>}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle>{t('list')}</CardTitle>
          {canManage && (
            <Button size="sm" onClick={() => setFormState({ editing: null, nonce: Date.now() })}>
              <Plus className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              {t('add')}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {loadError ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">
              <span>{loadError}</span>
              <Button size="sm" variant="outline" onClick={load}>{t('retry')}</Button>
            </div>
          ) : connections === null ? (
            <div className="space-y-2" role="status" aria-busy="true" aria-label={t('loading')}>
              {[0, 1].map((n) => <Skeleton key={n} className="h-28 w-full" />)}
            </div>
          ) : connections.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-12 text-center" data-testid="pg-empty">
              <CreditCard className="mx-auto h-8 w-8 text-muted" strokeWidth={1.5} aria-hidden="true" />
              <p className="mt-3 font-medium text-text">{t('empty')}</p>
              <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted">{t('emptyHint')}</p>
              {canManage && (
                <Button className="mt-4" variant="outline" onClick={() => setFormState({ editing: null, nonce: Date.now() })}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {t('add')}
                </Button>
              )}
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="pg-list">
              {connections.map((connection) => {
                const brand = gatewayProviderBrand(connection.provider);
                return (
                  <li key={connection.id} className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-4" data-testid={`pg-item-${connection.id}`}>
                    <div className="flex min-w-0 items-start gap-3">
                      {brand ? <PaymentBrandMark brand={brand} withIcon className="mt-0.5" /> : null}
                      <div className="min-w-0 flex-1">
                        <h2 className="break-words font-medium text-text">{gatewayDisplayName(connection, locale)}</h2>
                        <p className="mt-0.5 text-xs text-muted">{t(`providers.${connection.provider}`)}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5" data-testid={`pg-badges-${connection.id}`}>
                      <Badge tone={statusTone(connection.status)}>{t(`status.${connection.status}`)}</Badge>
                      <Badge tone={connection.environment === 'live' ? 'neutral' : 'muted'}>{t(`environments.${connection.environment}`)}</Badge>
                      {connection.status !== 'revoked' && (
                        <Badge tone={connection.verified_at ? 'positive' : 'muted'}>{connection.verified_at ? t('card.verified') : t('card.notVerified')}</Badge>
                      )}
                    </div>
                    <div className="mt-auto flex items-center justify-end border-t border-border pt-3">
                      <Button size="sm" variant="outline" onClick={() => setDetailId(connection.id)} data-testid={`pg-details-${connection.id}`}>
                        <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                        {t('actions.manage')}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {formState && (
        <ConnectionFormDialog
          key={formState.nonce}
          open
          editing={formState.editing}
          onClose={() => setFormState(null)}
          onSaved={(saved) => {
            upsert(saved);
            success(formState.editing ? t('done.edit') : t('done.create'));
            setFormState(null);
          }}
        />
      )}
      <RotateCredentialsDialog
        connection={rotating}
        onClose={() => setRotating(null)}
        onRotated={(rotated) => {
          upsert(rotated);
          success(t('done.rotate'));
          setRotating(null);
        }}
      />
      <RevokeDialog
        connection={revoking}
        name={revoking ? gatewayDisplayName(revoking, locale) : ''}
        onClose={() => setRevoking(null)}
        onRevoked={(revoked) => {
          upsert(revoked);
          success(t('done.revoke'));
          setRevoking(null);
        }}
      />
      <EventsDialog connection={viewingEvents} onClose={() => setViewingEvents(null)} />
      <GatewayDetailSheet
        connection={detailConnection}
        canManage={canManage}
        busy={detailConnection !== null && busy === detailConnection.id}
        onClose={() => setDetailId(null)}
        onAction={(connection, action) => {
          setDetailId(null);
          run(connection, action);
        }}
      />
    </div>
  );
}
