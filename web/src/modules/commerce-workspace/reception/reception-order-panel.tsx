'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { X } from 'lucide-react';
import { ErrorState, FormAlert, LoadingState } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCan } from '@/lib/use-can';
import { alertMessages } from '../alerts/messages';
import { acceptOrder, classifyAcceptError, failureMeansStale, type AcceptFailure } from '../orders/accept-order';
import { classifyOrdersError, type OrderDetail } from '../orders/contract';
import { FulfillmentSection } from '../orders/fulfillment-section';
import { ordersMessages } from '../orders/messages';
import { AcceptanceBadge, FulfillmentBadge, OrderStatusBadge, PaymentStatusBadge, formatOrderMoney } from '../orders/order-display';
import { fetchOrder } from '../orders/orders-api';
import { RejectOrderDialog } from '../orders/reject-order-dialog';
import { receptionMessages } from './messages';
import { scheduleText } from './order-card';

/**
 * لوحة طلب الاستقبال (COPS-H3-5c): إجراءات الاستقبال على الطلب المختار بلا مغادرة اللوحة. **لا منطق أهلية**: الإجراءات من عقد قراءة التفاصيل وحده
 * (`accept_action`/`reject_action`/`fulfillment_actions` + صلاحيتا `commerce.orders.manage`/`commerce.orders.cancel`) كنمط H1-5/H2-3، والخادم يحكم تحت الأقفال.
 * قفل الإرسال المكرر متزامن (`useRef`)، وبعد 409/404/شبكة تُقفل الإجراءات حتى يصل تحديث. تعيد استعمال القسم والحوار القائمين — لا نسخة ثانية من المنطق.
 */
export function ReceptionOrderPanel({
  orderId,
  alertPending,
  acking,
  ackFailed,
  onAcknowledge,
  onClose,
  onChanged,
}: {
  orderId: string;
  alertPending: boolean;
  acking: boolean;
  ackFailed: boolean;
  onAcknowledge: (orderId: string) => void;
  onClose: () => void;
  /** يُستدعى بعد أي تغيّر ناجح أو حالة قديمة ليعيد اللوحة جلب أعمدتها. */
  onChanged: () => void;
}) {
  const locale = useLocale();
  const { t } = receptionMessages(locale);
  const orders = ordersMessages(locale);
  const alerts = alertMessages(locale);
  const { can } = useCan();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorKind, setErrorKind] = useState<ReturnType<typeof classifyOrdersError> | null>(null);
  const [stale, setStale] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [acceptFailure, setAcceptFailure] = useState<AcceptFailure | null>(null);
  const [justAccepted, setJustAccepted] = useState(false);
  const [justRejected, setJustRejected] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const acceptInFlight = useRef(false);
  const seq = useRef(0);
  const closeRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async (initial: boolean) => {
    const mine = ++seq.current;
    if (initial) {
      setLoading(true);
      setErrorKind(null);
    }
    try {
      const result = await fetchOrder(orderId);
      if (mine !== seq.current) return;
      setOrder(result);
      setStale(false);
      setRefreshFailed(false);
      setErrorKind(null);
    } catch (error) {
      if (mine !== seq.current) return;
      const kind = classifyOrdersError(error);
      if (initial || kind === 'not_found') {
        setOrder(null);
        setErrorKind(kind);
      } else {
        setRefreshFailed(true);
      }
    } finally {
      if (mine === seq.current && initial) setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    setStale(false);
    setJustAccepted(false);
    setJustRejected(false);
    setAcceptFailure(null);
    void load(true);
  }, [load]);

  // Escape يغلق اللوحة — إلا إن كان فوقها حوار آخر مفتوح (للحوار الأعلى أولوية).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // حوار آخر **ظاهر** فوق اللوحة (رفض/تنفيذ) له الأولوية؛ الحوارات المغلقة/المخفية في الغلاف لا تُعدّ.
      const others = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter((el) => el.dataset.testid !== 'reception-panel' && !el.closest('[inert],[aria-hidden="true"],[hidden]') && getComputedStyle(el).display !== 'none');
      if (others.length > 0) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);

    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => closeRef.current?.focus(), []);

  const markStale = useCallback(() => {
    setStale(true);
    setRefreshFailed(false);
    onChanged();
    void load(false);
  }, [load, onChanged]);

  const updated = useCallback((next: OrderDetail) => {
    setOrder(next);
    onChanged();
  }, [onChanged]);

  async function handleAccept() {
    if (acceptInFlight.current || stale || order === null) return;
    acceptInFlight.current = true;
    setAccepting(true);
    setAcceptFailure(null);
    try {
      updated(await acceptOrder(order.id));
      setJustAccepted(true);
    } catch (error) {
      const failed = classifyAcceptError(error);
      setAcceptFailure(failed);
      if (failureMeansStale(failed)) markStale();
    } finally {
      acceptInFlight.current = false;
      setAccepting(false);
    }
  }

  const canManage = can('commerce.orders.manage');
  const cancelled = order?.lifecycle_status === 'cancelled' || order?.cancellation?.cancelled === true;
  const canAccept = order !== null && canManage && order.accept_action?.available === true && !cancelled;
  const canReject = order !== null && canManage && can('commerce.orders.cancel') && order.reject_action?.available === true && !cancelled;
  const when = order ? scheduleText(order.schedule ?? null, locale) : null;
  const title = order?.number ?? '…';
  const failureText = acceptFailure ? `${orders.label('acceptError', acceptFailure.kind)}${acceptFailure.reason ? ` ${orders.label('blocked', acceptFailure.reason)}` : ''}` : null;
  const bigButton = 'min-h-11 px-5';

  return (
    <>
      <div className="fixed inset-0 z-40 bg-text opacity-40" aria-hidden="true" onClick={onClose} data-testid="panel-backdrop" />
      <aside
        role="dialog"
        aria-modal="false"
        aria-label={`${t('panelFulfillment')} ${title}`}
        data-testid="reception-panel"
        className="fixed inset-y-0 end-0 z-40 flex h-dvh w-full flex-col border-s border-border bg-surface shadow-lg sm:max-w-md"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="num text-base font-semibold text-text" dir="ltr">{title}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            data-testid="panel-close"
            className="inline-flex h-11 w-11 items-center justify-center rounded text-muted hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X className="h-5 w-5" aria-hidden="true" />
            <span className="sr-only">{t('panelClose')}</span>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {loading ? (
            <LoadingState variant="cards" rows={2} />
          ) : errorKind !== null || order === null ? (
            <ErrorState message={errorKind === 'not_found' ? orders.t('detailNotFound') : errorKind === 'network' ? orders.t('networkError') : t('panelLoadError')} onRetry={errorKind === 'not_found' ? undefined : () => void load(true)} />
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                <OrderStatusBadge status={order.lifecycle_status ?? order.status} locale={locale} />
                <PaymentStatusBadge status={order.payment.status} locale={locale} />
                <AcceptanceBadge order={order} locale={locale} />
                <FulfillmentBadge fulfillment={order.fulfillment} locale={locale} />
                <Badge tone="neutral">{orders.label('delivery', order.delivery_method)}</Badge>
              </div>

              {stale && (
                <FormAlert tone="warning">
                  <p data-testid="panel-stale">{t('panelStale')}</p>
                  {refreshFailed && (
                    <Button type="button" variant="outline" className="mt-2 min-h-11" onClick={() => void load(false)}>{t('panelRefresh')}</Button>
                  )}
                </FormAlert>
              )}

              {(canAccept || canReject) && (
                <div className="space-y-2" data-testid="panel-decision">
                  {order.acceptance?.effective_mode === 'manual' && !order.acceptance.accepted_at && <p className="text-sm text-muted">{orders.t('acceptAwaitingNote')}</p>}
                  <div className="flex flex-wrap gap-2">
                    {canAccept && (
                      <Button type="button" className={bigButton} disabled={accepting || stale} aria-busy={accepting} onClick={() => void handleAccept()} data-testid="panel-accept">
                        {accepting ? orders.t('acceptSubmitting') : orders.t('acceptAction')}
                      </Button>
                    )}
                    {canReject && (
                      <Button type="button" variant="outline" className={bigButton} disabled={accepting || stale} onClick={() => setRejectOpen(true)} data-testid="panel-reject">
                        {orders.t('rejectAction')}
                      </Button>
                    )}
                  </div>
                </div>
              )}
              {failureText && <div role="alert"><FormAlert tone="error">{failureText}</FormAlert></div>}
              {justAccepted && <div role="status"><FormAlert tone="info">{orders.t('acceptSuccess')}</FormAlert></div>}
              {justRejected && <div role="status"><FormAlert tone="info">{orders.t('rejectSuccess')}</FormAlert></div>}

              {alertPending && (
                <div className="space-y-1">
                  <Button type="button" variant="outline" className={bigButton} disabled={acking} onClick={() => onAcknowledge(order.id)} data-testid="panel-ack">
                    {acking ? alerts.t('acking') : alerts.t('ack')}
                  </Button>
                  <p className="text-xs text-muted">{alerts.t('ackHint')}</p>
                  {ackFailed && <p role="alert" className="text-xs text-negative">{alerts.t('ackFailed')}</p>}
                </div>
              )}

              {(order.fulfillment !== undefined || order.fulfillment_actions !== undefined) && (
                <section aria-label={t('panelFulfillment')} className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted">{t('panelFulfillment')}</h3>
                  <FulfillmentSection order={order} canManage={canManage} stale={stale} onUpdated={updated} onStale={markStale} large />
                </section>
              )}

              <section aria-label={t('panelCustomer')} className="space-y-1 text-sm">
                <h3 className="text-xs font-semibold text-muted">{t('panelCustomer')}</h3>
                <p className="font-medium text-text"><bdi>{order.contact.name ?? order.customer.name ?? '—'}</bdi></p>
                {(order.contact.phone ?? order.customer.phone) && (
                  <a className="num inline-flex min-h-11 items-center text-primary underline-offset-2 hover:underline" dir="ltr" href={`tel:${order.contact.phone ?? order.customer.phone}`}>
                    {order.contact.phone ?? order.customer.phone}
                  </a>
                )}
              </section>

              <section aria-label={t('panelDelivery')} className="space-y-1 text-sm">
                <h3 className="text-xs font-semibold text-muted">{t('panelDelivery')}</h3>
                {when !== null && <p data-testid="panel-schedule"><Badge tone="warning" wrap>{t('scheduledFor', { when })}</Badge></p>}
                {order.delivery_method === 'pickup' ? (
                  <p className="text-muted">{orders.t('pickupNote')}</p>
                ) : order.shipping_address ? (
                  <p className="text-text"><bdi>{[order.shipping_address.city, order.shipping_address.district, order.shipping_address.street].filter(Boolean).join('، ')}</bdi></p>
                ) : (
                  <p className="text-muted">{orders.t('noAddress')}</p>
                )}
              </section>

              <section aria-label={t('panelItems')} className="space-y-1">
                <h3 className="text-xs font-semibold text-muted">{t('panelItems')}</h3>
                <ul className="divide-y divide-border rounded border border-border text-sm">
                  {order.items.map((line) => (
                    <li key={line.id} className="flex items-start justify-between gap-2 px-3 py-2">
                      <span className="min-w-0 text-text"><bdi>{line.product_name}</bdi>{line.variant ? <span className="text-xs text-muted"> · <bdi>{line.variant}</bdi></span> : null}</span>
                      <span className="num shrink-0 text-muted">× {line.quantity}</span>
                    </li>
                  ))}
                </ul>
                <p className="num text-sm font-medium text-text">{orders.t('orderTotal')}: {formatOrderMoney(order.total)}</p>
              </section>

              <Link href={`/commerce/orders/${order.id}`} className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-2 hover:underline">
                {t('panelOpenFull')}
              </Link>
            </>
          )}
        </div>
      </aside>

      {/* يُركَّب عند الفتح فقط كما في order-detail: كل محاولة تبدأ بحالة نظيفة (قفل/أخطاء/حقول) — Codex P2. */}
      {order !== null && rejectOpen && (
        <RejectOrderDialog
          open={rejectOpen}
          orderNumber={order.number}
          orderId={order.id}
          onClose={() => setRejectOpen(false)}
          onRejected={(next) => { setRejectOpen(false); setJustRejected(true); updated(next); }}
          // الحوار يبقى مفتوحاً مقفلاً يعرض سبب الفشل (409/شبكة) حتى يغلقه المشغّل — كما في order-detail؛ الإغلاق يفكّ تركيبه فتبدأ المحاولة التالية نظيفة (Codex P2).
          onStale={markStale}
        />
      )}
    </>
  );
}
