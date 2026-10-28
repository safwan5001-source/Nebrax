'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { ClipboardList, TriangleAlert } from 'lucide-react';
import { DetailPage, DetailSummary, EmptyState, ErrorState, FormAlert, LoadingState, type DetailSection } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/formatting';
import { useCan } from '@/lib/use-can';
import { ACTIVE_STORE_QUERY_PARAM, withStoreParam } from '@/modules/commerce-workspace/active-store';
import { useOptionalCommerceStoreContext } from '@/modules/commerce-workspace/store-context';
import { CancelOrderDialog } from './cancel-order-dialog';
import { classifyOrdersError, lifecycleOf, type OrderAddress, type OrderDetail } from './contract';
import { ordersMessages, type OrdersMessageKey } from './messages';
import { OrderStatusBadge, PaymentStatusBadge, formatOrderMoney } from './order-display';
import { fetchOrder } from './orders-api';
import { ORDERS_LIST_QUERY_KEY } from './orders-list';

function savedListQuery(): string {
  try {
    return window.sessionStorage.getItem(ORDERS_LIST_QUERY_KEY) ?? '';
  } catch {
    return '';
  }
}

const ADDRESS_FIELDS: [keyof OrderAddress & string, OrdersMessageKey][] = [
  ['recipient_name', 'recipient'],
  ['phone', 'phone'],
  ['country', 'country'],
  ['region', 'region'],
  ['city', 'city'],
  ['district', 'district'],
  ['street', 'street'],
  ['building_no', 'buildingNo'],
  ['additional_number', 'additionalNumber'],
  ['postal_code', 'postalCode'],
  ['notes', 'notes'],
];

export function OrderDetailView({ id }: { id: string }) {
  const locale = useLocale();
  const { t, label } = ordersMessages(locale);
  const storeContext = useOptionalCommerceStoreContext();
  const activeStoreId = storeContext?.selectedStoreId ?? null;

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorKind, setErrorKind] = useState<ReturnType<typeof classifyOrdersError> | null>(null);
  const { can } = useCan();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [justCancelled, setJustCancelled] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setErrorKind(null);
    fetchOrder(id)
      .then((result) => !cancelled && setOrder(result))
      .catch((error) => {
        if (cancelled) return;
        setOrder(null);
        setErrorKind(classifyOrdersError(error));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => load(), [load]);

  /** تحديث صامت من الخادم (بعد سباق 409/شبكة): لا يعيد شاشة التحميل ولا يمسح البيانات الحالية إن فشل. */
  const refresh = useCallback(() => {
    fetchOrder(id)
      .then((result) => setOrder(result))
      .catch((error) => {
        if (classifyOrdersError(error) === 'not_found') {
          setOrder(null);
          setErrorKind('not_found');
        }
      });
  }, [id]);

  const backHref = useMemo(() => {
    const params = new URLSearchParams(typeof window === 'undefined' ? '' : savedListQuery());
    if (activeStoreId) params.set(ACTIVE_STORE_QUERY_PARAM, activeStoreId);
    const qs = params.toString();
    return qs ? `/commerce/orders?${qs}` : '/commerce/orders';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStoreId, order]);

  if (loading) return <LoadingState variant="cards" rows={3} />;
  if (errorKind === 'not_found') {
    return <EmptyState icon={ClipboardList} title={t('detailNotFound')} description={t('detailNotFoundHint')} action={<BackLink href={backHref} label={t('back')} />} />;
  }
  if (errorKind === 'forbidden') {
    return <EmptyState icon={ClipboardList} title={t('forbidden')} description={`${t('restrictedHint')} ${t('capabilityHint')}`} action={<BackLink href={backHref} label={t('back')} />} />;
  }
  if (errorKind !== null || order === null) {
    return <ErrorState message={errorKind === 'network' ? t('networkError') : t('detailLoadError')} onRetry={load} />;
  }

  const posted = order.accounting.posted;
  const lifecycle = lifecycleOf(order);
  const isCancelled = lifecycle === 'cancelled';
  // العقد استرشادي: غيابه ⇒ لا إجراء (بوابة مغلقة أو بلا صلاحية). الزرّ ليس حماية — الخادم يحكم دائماً.
  const cancelAction = order.cancel_action;
  const canCancel = can('commerce.orders.cancel') && cancelAction?.available === true && !isCancelled;
  const cancelBlocked = !isCancelled && can('commerce.orders.cancel') && cancelAction?.available === false ? cancelAction.blocked_reason : undefined;
  const isPickup = order.delivery_method === 'pickup';
  const money = formatOrderMoney;

  const sections: DetailSection[] = [
    {
      id: 'customer',
      title: t('sectionCustomer'),
      content: (
        <DefinitionGrid
          rows={[
            [t('name'), order.contact.name ?? order.customer.name],
            [t('company'), order.contact.company],
            [t('phone'), order.contact.phone, true],
            [t('email'), order.contact.email, true],
            [t('vatNumber'), order.contact.vat_number, true],
            [t('crNumber'), order.contact.cr_number, true],
          ]}
        />
      ),
    },
    {
      id: 'delivery',
      title: t('sectionDelivery'),
      content: (
        <div className="space-y-4">
          <p className="text-sm">
            <Badge tone="neutral">{label('delivery', order.delivery_method)}</Badge>
          </p>
          {isPickup ? <p className="text-sm text-muted">{t('pickupNote')}</p> : null}
          {order.shipping_address && !isPickup ? (
            <div>
              <h3 className="mb-2 text-xs font-semibold text-muted">{t('shippingAddress')}</h3>
              <DefinitionGrid rows={ADDRESS_FIELDS.map(([key, msg]) => [t(msg), order.shipping_address?.[key] ?? null] as [string, string | null])} />
            </div>
          ) : !isPickup ? (
            <p className="text-sm text-muted">{t('noAddress')}</p>
          ) : null}
          {order.schedule ? (
            <div>
              <h3 className="mb-2 text-xs font-semibold text-muted">{t('schedule')}</h3>
              <DefinitionGrid
                rows={[
                  [t('scheduleDate'), order.schedule.date, true],
                  [
                    t('scheduleSlot'),
                    (locale === 'en' ? order.schedule.slot.label_en : order.schedule.slot.label) ??
                      order.schedule.slot.label ??
                      [order.schedule.slot.start_time, order.schedule.slot.end_time].filter(Boolean).join(' – '),
                  ],
                ]}
              />
            </div>
          ) : null}
          {order.gift ? (
            <div>
              <h3 className="mb-2 text-xs font-semibold text-muted">{t('gift')}</h3>
              <DefinitionGrid
                rows={[
                  [t('giftRecipient'), [order.gift.recipient_name, order.gift.recipient_phone].filter(Boolean).join(' · ') || null],
                  [t('giftSender'), order.gift.hide_sender ? t('giftSenderHidden') : order.gift.sender_display_name],
                  [t('giftMessage'), order.gift.message],
                ]}
              />
            </div>
          ) : null}
        </div>
      ),
    },
    {
      id: 'items',
      title: t('sectionItems'),
      count: order.items.length,
      flush: true,
      content: (
        <div>
          <ul className="divide-y divide-border" aria-label={t('sectionItems')}>
            {order.items.map((line) => (
              <li key={line.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-text">
                    <bdi>{line.product_name}</bdi>
                    {line.parent_line_id ? <Badge tone="muted" className="ms-2">{t('addonOf')}</Badge> : null}
                  </div>
                  {line.variant ? <div className="text-xs text-muted"><bdi>{line.variant}</bdi></div> : null}
                  {line.personalization.length > 0 ? (
                    <dl className="mt-1 space-y-0.5 text-xs text-muted" aria-label={t('personalization')}>
                      {line.personalization.map((p) => (
                        <div key={p.key} className="flex gap-1">
                          <dt>{(locale === 'en' ? p.label_en : null) ?? p.label}:</dt>
                          <dd className="text-text"><bdi>{p.value_label ?? p.value ?? '—'}</bdi></dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </div>
                <div className="num text-end">
                  <div>{line.quantity}{line.unit_name ? ` ${line.unit_name}` : ''} × {money(line.unit_price)}</div>
                  <div className="font-medium text-text">{money(line.line_total)}</div>
                </div>
              </li>
            ))}
          </ul>
          <p className="border-t border-border px-4 py-2 text-xs text-muted">{t('noTaxDiscountNote')}</p>
        </div>
      ),
    },
    {
      id: 'payment',
      title: t('sectionPayment'),
      content: (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <PaymentStatusBadge status={order.payment.status} locale={locale} />
            <span className="text-sm text-muted">{label('method', order.payment.method)}</span>
          </div>
          <DefinitionGrid
            rows={[
              [t('methodName'), order.payment.payment_method_name],
              [t('collectedAt'), order.payment.collected_at ? formatDateTime(order.payment.collected_at, locale) : null, true],
              [t('paidAt'), order.payment.paid_at ? formatDateTime(order.payment.paid_at, locale) : null, true],
              [t('cancelledAt'), order.payment.cancelled_at ? formatDateTime(order.payment.cancelled_at, locale) : null, true],
              [t('collectionNote'), order.payment.collection_note],
            ]}
          />
          {order.payment.method === 'online' ? (
            <div>
              <h3 className="mb-2 text-xs font-semibold text-muted">{t('attempts')}</h3>
              {order.payment.attempts.length === 0 ? (
                <p className="text-sm text-muted">{t('noAttempts')}</p>
              ) : (
                <ul className="divide-y divide-border rounded border border-border">
                  {order.payment.attempts.map((attempt) => (
                    <li key={attempt.id} className="space-y-1 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Badge tone={attempt.review_reasons.length > 0 ? 'warning' : 'muted'}>{label('capture', attempt.capture_status)}</Badge>
                        <span className="num text-xs text-muted">{formatDateTime(attempt.created_at, locale)}</span>
                      </div>
                      <div className="num text-xs text-muted">
                        {t('attemptAmount')}: {money(attempt.amount)} · {t('attemptCaptured')}: {money(attempt.captured)}
                      </div>
                      {attempt.review_reasons.length > 0 ? (
                        <div className="text-xs text-warning">
                          {t('reviewReasons')}: <span className="num">{attempt.review_reasons.join(', ')}</span>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      id: 'accounting',
      title: t('sectionAccounting'),
      content: order.accounting.posted ? (
        <div className="space-y-3">
          <Badge tone="positive">{t('accountingPosted')}</Badge>
          <DefinitionGrid
            rows={[
              [t('accountingDate'), order.accounting.accounting_date, true],
              [t('accountingAmount'), money(order.accounting.amount), true],
            ]}
          />
          <Button asChild variant="outline" size="sm">
            <Link href={`/invoices/${order.accounting.invoice_id}`}>{t('openInvoice')}</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Badge tone="warning">{t('accountingNotPosted')}</Badge>
          {order.payment.method === 'cod' || order.payment.method === 'pay_on_pickup' ? (
            <p className="text-sm text-muted">{t('accountingCodHint')}</p>
          ) : null}
        </div>
      ),
    },
    ...(isCancelled
      ? [
          {
            id: 'cancellation',
            title: t('sectionCancellation'),
            content: (
              <DefinitionGrid
                rows={[
                  [t('cancellationReason'), order.cancellation?.reason ? label('reason', order.cancellation.reason) : null],
                  [t('cancellationNote'), order.cancellation?.note],
                  [t('cancellationBy'), order.cancellation?.by?.name],
                  [t('cancellationAt'), order.cancellation?.at ? formatDateTime(order.cancellation.at, locale) : null, true],
                ]}
              />
            ),
          } satisfies DetailSection,
        ]
      : []),
  ];

  return (
    <DetailPage
      backHref={backHref}
      backLabel={t('back')}
      title={order.number}
      badges={
        <>
          <OrderStatusBadge status={lifecycle} locale={locale} />
          <PaymentStatusBadge status={order.payment.status} locale={locale} />
        </>
      }
      meta={
        <span>
          {formatDateTime(order.created_at, locale)} · <bdi>{order.channel.storefront_name ?? order.channel.sales_channel_name ?? '—'}</bdi> · {cancelAction ? t('cancelEnabledNote') : t('readOnlyNote')}
        </span>
      }
      actionsSlot={
        canCancel ? (
          <Button type="button" variant="danger" onClick={() => setCancelOpen(true)}>
            {t('cancelAction')}
          </Button>
        ) : undefined
      }
      alert={
        <div className="space-y-3">
          {justCancelled ? (
            <div role="status">
              <FormAlert tone="info">{t('cancelSuccess')}</FormAlert>
            </div>
          ) : null}
          {isCancelled ? <FormAlert tone="info">{t('cancelledBanner')}</FormAlert> : null}
          {cancelBlocked !== undefined ? (
            <FormAlert tone="warning">
              <p className="font-medium text-text">{t('cancelBlockedTitle')}</p>
              {cancelBlocked ? <p className="mt-1 text-muted">{label('blocked', cancelBlocked)}</p> : null}
            </FormAlert>
          ) : null}
          {!posted && !isCancelled ? (
            <div role="alert" className="flex items-start gap-3 rounded border border-warning/40 bg-warning/10 p-3 text-sm">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <div>
                <p className="font-medium text-text">{t('accountingWarningTitle')}</p>
                <p className="mt-1 text-muted">{t('accountingWarningBody')}</p>
              </div>
            </div>
          ) : null}
        </div>
      }
      summaryTitle={t('summary')}
      summary={
        <DetailSummary
          rows={[
            ...(order.delivery_amount.amount_minor > 0 ? [{ label: t('deliveryCharge'), value: money(order.delivery_amount) }] : []),
            { label: t('orderTotal'), value: money(order.total), strong: true },
          ]}
        />
      }
      sections={sections}
    >
      {/* يُركَّب عند كل فتح ويُفكّ عند الإغلاق: حالة الحوار (القفل، الأخطاء، الحقول) لا تعبر من محاولة قديمة إلى فتح جديد بعد تحديث الأهلية، ويبقى
          مركَّباً طوال فتحه حتى لو اختفى الإجراء بعد تحديث الحالة (سباق 409) فلا تضيع رسالة الرفض. */}
      {cancelOpen ? (
        <CancelOrderDialog
          open={cancelOpen}
          orderId={order.id}
          orderNumber={order.number}
          onClose={() => setCancelOpen(false)}
          onCancelled={(updated) => {
            setOrder(updated);
            setCancelOpen(false);
            setJustCancelled(true);
          }}
          onStale={refresh}
        />
      ) : null}
    </DetailPage>
  );
}

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={withStoreParam(href, null)}>{label}</Link>
    </Button>
  );
}

function DefinitionGrid({ rows }: { rows: ([string, string | null | undefined] | [string, string | null | undefined, boolean])[] }) {
  const visible = rows.filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (visible.length === 0) return <p className="text-sm text-muted">—</p>;

  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {visible.map(([name, value, ltr]) => (
        <div key={name} className="min-w-0">
          <dt className="text-xs text-muted">{name}</dt>
          <dd className={ltr ? 'num break-words text-text' : 'break-words text-text'} dir={ltr ? 'ltr' : undefined}>
            {ltr ? value : <bdi>{value}</bdi>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
