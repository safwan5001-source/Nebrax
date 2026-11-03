'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { acceptanceBadgeOf } from '../orders/contract';
import { AcceptanceBadge, FulfillmentBadge, PaymentStatusBadge, formatOrderMoney } from '../orders/order-display';
import { ordersMessages } from '../orders/messages';
import type { OrderSummary } from '../orders/contract';
import { alertMessages } from '../alerts/messages';
import { elapsedMinutes } from './board-columns';
import { receptionMessages } from './messages';

export function elapsedLabel(minutes: number | null, locale: string): string | null {
  if (minutes === null) return null;
  const { t } = receptionMessages(locale);
  if (minutes < 1) return t('elapsedNow');
  if (minutes < 60) return t('elapsedMinutes', { m: minutes });

  return t('elapsedHours', { h: Math.floor(minutes / 60), m: minutes % 60 });
}

/** نص موعد التسليم المجدول من لقطة الطلب (تاريخ + نافذة). بلا حساب منطقة زمنية: القيم كما التُقطت. */
export function scheduleText(schedule: OrderSummary['schedule'], locale: string): string | null {
  if (!schedule?.date) return null;
  const { slot } = schedule;
  const label = (locale === 'en' ? slot.label_en : null) ?? slot.label ?? [slot.start_time, slot.end_time].filter(Boolean).join('–');

  return label ? `${schedule.date} · ${label}` : schedule.date;
}

/**
 * بطاقة طلب في لوحة الاستقبال. لا منطق حالة: الشارات من حقائق الخادم المخزَّنة، والإقرار يظهر فقط حين يقول مركز التنبيه (الخادم) إن الطلب بانتظار انتباه.
 * أهداف اللمس ≥ 44px. النقر على العنوان يفتح تفاصيل الطلب.
 */
export function OrderCard({
  order,
  locale,
  nowMs,
  alertPending,
  acking,
  ackFailed,
  onAcknowledge,
  onSelect,
}: {
  order: OrderSummary;
  locale: string;
  nowMs: number;
  alertPending: boolean;
  acking: boolean;
  ackFailed: boolean;
  onAcknowledge: (orderId: string) => void;
  onSelect?: (orderId: string) => void;
}) {
  const { t } = receptionMessages(locale);
  const alerts = alertMessages(locale);
  const orders = ordersMessages(locale);
  const elapsed = elapsedLabel(elapsedMinutes(order.created_at, nowMs), locale);
  const when = scheduleText(order.schedule, locale);
  const customer = order.customer.name ?? order.customer.phone ?? '—';

  return (
    <li
      data-testid="board-card"
      data-order-id={order.id}
      data-alert-pending={alertPending ? 'true' : 'false'}
      className={`flex flex-col gap-2 rounded border bg-surface p-3 ${alertPending ? 'border-primary border-s-4' : 'border-border'}`}
    >
      <div className="flex items-start justify-between gap-2">
        {onSelect ? (
          <button type="button" onClick={() => onSelect(order.id)} className="num min-h-11 text-start font-semibold text-text hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" dir="ltr">
            {order.number}
          </button>
        ) : (
          <Link href={`/commerce/orders/${order.id}`} className="num inline-flex min-h-11 items-center font-semibold text-text hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" dir="ltr">
            {order.number}
          </Link>
        )}
        <div className="flex flex-col items-end gap-1 text-xs text-muted">
          {alertPending && <Badge tone="negative" data-testid="board-new-badge">{t('newBadge')}</Badge>}
          {elapsed !== null && <span data-testid="board-elapsed" className="num">{elapsed}</span>}
        </div>
      </div>

      <div className="min-w-0 text-sm">
        <div className="truncate font-medium text-text"><bdi>{customer}</bdi></div>
        <div className="num text-xs text-muted">{formatOrderMoney(order.total)} · {t('items', { count: order.items_count })}</div>
      </div>

      <div className="flex flex-wrap gap-1">
        <Badge tone="neutral">{orders.label('delivery', order.delivery_method)}</Badge>
        <PaymentStatusBadge status={order.payment.status} locale={locale} />
        {acceptanceBadgeOf(order) === 'awaiting' && <AcceptanceBadge order={order} locale={locale} />}
        <FulfillmentBadge fulfillment={order.fulfillment} locale={locale} />
      </div>

      {when !== null && <p data-testid="board-schedule" className="num text-xs text-text"><Badge tone="warning" wrap>{t('scheduledFor', { when })}</Badge></p>}

      {alertPending && (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            disabled={acking}
            onClick={() => onAcknowledge(order.id)}
            className="inline-flex min-h-11 items-center justify-center rounded border border-border px-3 text-sm text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
          >
            {acking ? alerts.t('acking') : alerts.t('ack')}
          </button>
          {ackFailed && <p role="alert" data-testid="board-ack-error" className="text-xs text-negative">{alerts.t('ackFailed')}</p>}
        </div>
      )}

      {onSelect && (
        <Link href={`/commerce/orders/${order.id}`} className="inline-flex min-h-11 items-center justify-center rounded text-xs text-muted underline-offset-2 hover:text-primary hover:underline">
          {t('open')}
        </Link>
      )}
    </li>
  );
}
