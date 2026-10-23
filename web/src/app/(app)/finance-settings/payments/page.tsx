'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, CreditCard, History, KeyRound, Pause, Pencil, Play, Plus, ShieldOff, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/formatting';
import { isDemo } from '@/lib/demo';
import { useCan } from '@/lib/use-can';
import { PaymentBrandMark } from '@/components/payments/payment-brand-mark';
import { gatewayProviderBrand } from '@/lib/payment-brand-registry';
import { ConnectionFormDialog } from '@/modules/payments/gateways/connection-form-dialog';
import {
  MANAGE_PERMISSION,
  VIEW_PERMISSION,
  activationBlock,
  apiErrorCode,
  apiErrorMessage,
  errorMessageKey,
  availableActions,
  gatewayDisplayName,
  statusTone,
  type GatewayAction,
  type GatewayConnection,
} from '@/modules/payments/gateways/contract';
import { EventsDialog } from '@/modules/payments/gateways/events-dialog';
import { RevokeDialog } from '@/modules/payments/gateways/revoke-dialog';
import { RotateCredentialsDialog } from '@/modules/payments/gateways/rotate-credentials-dialog';

type Transition = 'activate' | 'suspend';

/**
 * الإعدادات › المالية › بوابات الدفع (PAY-H1-05). اتصالات المزوّد التي يضيفها التاجر بنفسه.
 * القراءة `payments.view`، والإجراءات (إضافة/تعديل/تفعيل/إيقاف/إلغاء/تدوير/سجل) `payment_gateways.manage`؛ الخادم هو الحاسم.
 * لا أسرار تُعرض أبداً: مؤشرات «محفوظ» فقط. التحقق من اعتماد مزوّد حقيقي يصل مع أول محوّل (PAY-H2-01)، فالتفعيل
 * لمزوّد حقيقي غير مُتحقَّق منه معطّل بسببه المعلن، ولا نزيّف تحققاً.
 */
export default function PaymentGatewaysPage() {
  const t = useTranslations('paymentGateways');
  const locale = useLocale();
  const askConfirm = useConfirm();
  const { success, error: toastError } = useToast();
  const { can, hydrated } = useCan();
  const canView = can(VIEW_PERMISSION);
  // وضع المعاينة بلا خادم: لا يُحاكي هذا المسار، فتُعطَّل الإجراءات بدل نجاحٍ كاذب.
  const [demo, setDemo] = useState(false);
  useEffect(() => setDemo(isDemo()), []);
  const canManage = can(MANAGE_PERMISSION) && !demo;

  const [connections, setConnections] = useState<GatewayConnection[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [formState, setFormState] = useState<{ editing: GatewayConnection | null; nonce: number } | null>(null);
  const [rotating, setRotating] = useState<GatewayConnection | null>(null);
  const [revoking, setRevoking] = useState<GatewayConnection | null>(null);
  const [viewingEvents, setViewingEvents] = useState<GatewayConnection | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    api<{ data: GatewayConnection[] }>('/payment-gateways')
      .then((response) => setConnections(response.data))
      .catch((err) => setLoadError(apiErrorMessage(err) ?? t('loadFailed')));
  }, [t]);

  useEffect(() => {
    if (hydrated && canView) load();
  }, [hydrated, canView, load]);

  function upsert(next: GatewayConnection) {
    setConnections((current) => {
      const list = current ?? [];
      return list.some((item) => item.id === next.id) ? list.map((item) => (item.id === next.id ? next : item)) : [next, ...list];
    });
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

  async function remove(connection: GatewayConnection) {
    if (!(await askConfirm({ message: t('confirm.delete', { name: gatewayDisplayName(connection, locale) }), tone: 'danger' }))) return;
    setBusy(connection.id);
    try {
      await api(`/payment-gateways/${connection.id}`, { method: 'DELETE' });
      setConnections((current) => (current ?? []).filter((item) => item.id !== connection.id));
      success(t('done.delete'));
    } catch (err) {
      failure(err, t('actionFailed'));
    } finally {
      setBusy(null);
    }
  }

  function run(connection: GatewayConnection, action: GatewayAction) {
    switch (action) {
      case 'edit': return setFormState({ editing: connection, nonce: Date.now() });
      case 'rotate': return setRotating(connection);
      case 'revoke': return setRevoking(connection);
      case 'events': return setViewingEvents(connection);
      case 'delete': return void remove(connection);
      default: return void transition(connection, action);
    }
  }

  function actionButtons(connection: GatewayConnection) {
    const actions = availableActions(connection, canManage);
    if (actions.length === 0) return null;
    const blocked = activationBlock(connection);
    const disabled = busy === connection.id;
    const icons: Record<GatewayAction, typeof Pencil> = {
      edit: Pencil, rotate: KeyRound, activate: Play, suspend: Pause, revoke: ShieldOff, delete: Trash2, events: History,
    };

    return (
      <div className="flex flex-wrap justify-end gap-1">
        {actions.map((action) => {
          const Icon = icons[action];
          const isBlocked = action === 'activate' && blocked !== null;
          return (
            <Button
              key={action}
              size="sm"
              variant={action === 'revoke' || action === 'delete' ? 'ghost' : 'outline'}
              disabled={disabled || isBlocked}
              title={isBlocked ? t('activationBlocked') : undefined}
              onClick={() => run(connection, action)}
            >
              <Icon className={`h-3.5 w-3.5 ${action === 'revoke' || action === 'delete' ? 'text-negative' : ''}`} strokeWidth={1.7} aria-hidden="true" />
              {t(`actions.${action}`)}
            </Button>
          );
        })}
      </div>
    );
  }

  function detailRows(connection: GatewayConnection) {
    return (
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-xs">
        <dt className="text-muted">{t('fields.secretKey')}</dt>
        <dd className="text-text">{connection.has_secret_key ? t('fields.saved') : t('fields.missing')}</dd>
        <dt className="text-muted">{t('fields.webhookSecret')}</dt>
        <dd className="text-text">{connection.has_webhook_secret ? t('fields.saved') : t('fields.missing')}</dd>
        <dt className="text-muted">{t('fields.credentialVersion')}</dt>
        <dd className="num text-text">{connection.credential_version}</dd>
        <dt className="text-muted">{t('fields.verified')}</dt>
        <dd className="text-text">{connection.verified_at ? formatDateTime(connection.verified_at, locale) : t('fields.notVerified')}</dd>
        {connection.previous_secret_valid_until && (
          <>
            <dt className="text-muted">{t('fields.graceUntil')}</dt>
            <dd className="num text-text">{formatDateTime(connection.previous_secret_valid_until, locale)}</dd>
          </>
        )}
      </dl>
    );
  }

  if (hydrated && !canView) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Header t={t} canManage={false} onAdd={() => {}} />
        <p role="note" className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted" data-testid="pg-denied">{t('denied')}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Header t={t} canManage={canManage} onAdd={() => setFormState({ editing: null, nonce: Date.now() })} />
      {demo && <p role="note" className="rounded-md border border-dashed border-border px-4 py-2 text-xs text-muted" data-testid="pg-demo">{t('demoReadOnly')}</p>}

      <Card>
        <CardHeader><CardTitle>{t('list')}</CardTitle></CardHeader>
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
            <ul className="space-y-3" data-testid="pg-list">
              {connections.map((connection) => (
                <li key={connection.id} className="rounded-md border border-border p-4" data-testid={`pg-item-${connection.id}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-3">
                      {(() => {
                        const brand = gatewayProviderBrand(connection.provider);
                        return brand ? <PaymentBrandMark brand={brand} withIcon className="mt-0.5" /> : null;
                      })()}
                      <div className="min-w-0">
                        <h2 className="font-medium text-text">{gatewayDisplayName(connection, locale)}</h2>
                        <p className="mt-0.5 text-xs text-muted">{t(`providers.${connection.provider}`)}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone={connection.environment === 'live' ? 'neutral' : 'muted'}>{t(`environments.${connection.environment}`)}</Badge>
                      <Badge tone={statusTone(connection.status)}>{t(`status.${connection.status}`)}</Badge>
                    </div>
                  </div>
                  {detailRows(connection)}
                  {activationBlock(connection) !== null && connection.status !== 'revoked' && (
                    <p className="mt-3 rounded bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">{t('activationBlocked')}</p>
                  )}
                  <div className="mt-3 border-t border-border pt-3">{actionButtons(connection)}</div>
                </li>
              ))}
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
    </div>
  );
}

function Header({ t, canManage, onAdd }: { t: ReturnType<typeof useTranslations>; canManage: boolean; onAdd: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('back')}>
          <Link href="/finance-settings"><ArrowRight className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" strokeWidth={1.7} /></Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{t('subtitle')}</p>
        </div>
      </div>
      {canManage && (
        <Button onClick={onAdd}>
          <Plus className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          {t('add')}
        </Button>
      )}
    </div>
  );
}
