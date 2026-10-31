'use client';

import Link from 'next/link';
import { useLocale } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { ErrorState, LoadingState } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { formatDateTime } from '@/lib/formatting';
import { withStoreParam } from '@/modules/commerce-workspace/active-store';
import { lifecycleOf, type OrderDetail } from '@/modules/commerce-workspace/orders/contract';
import { ordersMessages } from '@/modules/commerce-workspace/orders/messages';
import { OrderStatusBadge, PaymentStatusBadge, formatOrderMoney } from '@/modules/commerce-workspace/orders/order-display';
import { fetchOrder } from '@/modules/commerce-workspace/orders/orders-api';
import { commonMessages } from '../../messages/common';
import { useResource } from '../../use-resource';
import { wholesaleOrdersMessages } from './messages';

/**
 * Read-only order drawer. The one authorised action (cancel) is NOT re-implemented here: this shows the server's
 * `cancel_action` verdict and sends the user to the full order page, where the existing dialog and API own it.
 */
export function OrderSheet({ orderId, storeId, onClose }: { orderId: string | null; storeId: string | null; onClose: () => void }) {
  const locale = useLocale();
  const orders = ordersMessages(locale);
  const { t } = wholesaleOrdersMessages.forLocale(locale);
  const common = commonMessages.forLocale(locale).t;
  const { state, reload } = useResource(() => fetchOrder(orderId!), [orderId], { enabled: orderId !== null });

  return (
    <Sheet open={orderId !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent closeLabel={common('close')} className="sm:max-w-xl">
        {orderId === null ? null : state.status === 'loading' ? (
          <div className="p-4">
            <SheetTitle className="sr-only">{common('loading')}</SheetTitle>
            <LoadingState variant="cards" rows={3} label={common('loading')} surface="bare" />
          </div>
        ) : state.status === 'error' ? (
          <div className="p-4">
            <SheetTitle className="sr-only">{common('loadError')}</SheetTitle>
            <ErrorState message={state.kind === 'not_found' ? orders.t('detailNotFound') : t('detailLoadError')} onRetry={reload} retryLabel={common('retry')} surface="bare" />
          </div>
        ) : (
          <OrderSheetBody order={state.data} locale={locale} storeId={storeId} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function OrderSheetBody({ order, locale, storeId }: { order: OrderDetail; locale: string; storeId: string | null }) {
  const orders = ordersMessages(locale);
  const { t } = wholesaleOrdersMessages.forLocale(locale);
  const cancel = order.cancel_action;
  const payment = order.payment;

  return (
    <>
      <div className="border-b border-border p-4 pe-14">
        <SheetTitle className="num text-base font-semibold text-text">{order.number}</SheetTitle>
        <SheetDescription className="mt-1 text-xs text-muted">{t('detailHint')}</SheetDescription>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <OrderStatusBadge status={lifecycleOf(order)} locale={locale} />
          <PaymentStatusBadge status={payment.status} locale={locale} />
          <span className="num text-xs text-muted">{formatDateTime(order.created_at, locale)}</span>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4 text-sm">
        <Block title={t('contactSection')}>
          <Row label={orders.t('name')}><bdi>{order.contact.name ?? order.customer.name ?? '—'}</bdi></Row>
          <Row label={orders.t('company')}><bdi>{order.contact.company ?? '—'}</bdi></Row>
          <Row label={orders.t('vatNumber')}><span className="num" dir="ltr">{order.contact.vat_number ?? '—'}</span></Row>
          <Row label={orders.t('crNumber')}><span className="num" dir="ltr">{order.contact.cr_number ?? '—'}</span></Row>
          <Row label={orders.t('email')}><span className="break-all" dir="ltr">{order.contact.email ?? '—'}</span></Row>
          <Row label={orders.t('phone')}><span className="num" dir="ltr">{order.contact.phone ?? '—'}</span></Row>
        </Block>

        <Block title={t('itemsSection')}>
          {order.items.length === 0 ? (
            <p className="text-muted">{t('noItems')}</p>
          ) : (
            <ul className="divide-y divide-border rounded border border-border">
              {order.items.map((line) => (
                <li key={line.id} className="flex items-start justify-between gap-3 p-2.5">
                  <div className="min-w-0">
                    <bdi className="block font-medium text-text">{line.product_name}</bdi>
                    {line.variant ? <bdi className="block text-xs text-muted">{line.variant}</bdi> : null}
                    <span className="num block text-xs text-muted">
                      {line.quantity}{line.unit_name ? ` ${line.unit_name}` : ''} × {formatOrderMoney(line.unit_price)}
                    </span>
                  </div>
                  <span className="num shrink-0 text-end font-medium">{formatOrderMoney(line.line_total)}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block title={t('totalsSection')}>
          <Row label={orders.t('deliveryCharge')}><span className="num">{formatOrderMoney(order.delivery_amount)}</span></Row>
          <Row label={orders.t('orderTotal')}><span className="num font-semibold">{formatOrderMoney(order.total)}</span></Row>
        </Block>

        <Block title={t('paymentSection')}>
          <Row label={orders.t('paymentMethod')}>{payment.payment_method_name ?? orders.label('method', payment.method)}</Row>
          <Row label={orders.t('paymentStatus')}><PaymentStatusBadge status={payment.status} locale={locale} /></Row>
          <Row label={orders.t('collectedAt')}><span className="num">{payment.collected_at ? formatDateTime(payment.collected_at, locale) : '—'}</span></Row>
          <Row label={orders.t('paidAt')}><span className="num">{payment.paid_at ? formatDateTime(payment.paid_at, locale) : '—'}</span></Row>
        </Block>

        <Block title={t('accountingSection')}>
          <p className={order.accounting.posted ? 'text-text' : 'text-muted'}>{order.accounting.posted ? t('accountingPostedLine') : t('accountingNotPostedLine')}</p>
        </Block>

        <Block title={t('sectionActions')}>
          {cancel === undefined ? (
            <p className="text-muted">{t('actionNone')}</p>
          ) : cancel.available ? (
            <p className="text-text">{t('actionCancelAvailable')}</p>
          ) : (
            <p className="text-muted">{t('actionCancelBlocked', { reason: orders.label('blocked', cancel.blocked_reason) })}</p>
          )}
        </Block>
      </div>

      <div className="border-t border-border p-4">
        <Button asChild variant="outline" className="min-h-11 w-full sm:w-auto">
          <Link href={withStoreParam(`/commerce/orders/${order.id}`, storeId)}>
            <ExternalLink aria-hidden className="h-4 w-4 rtl:-scale-x-100" strokeWidth={1.7} />
            {t('openFull')}
          </Link>
        </Button>
      </div>
    </>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-xs text-muted">{label}</span>
      <span className="min-w-0 text-end text-text">{children}</span>
    </div>
  );
}
