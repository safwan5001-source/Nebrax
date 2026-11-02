'use client';

import { Badge } from '@/components/ui/badge';
import { formatMinorRiyal, minorToRiyal } from '@/lib/money';
import { acceptanceBadgeOf, type AcceptanceBadgeKind, type Money, type OrderSummary } from './contract';
import { ordersMessages } from './messages';

type Tone = 'neutral' | 'muted' | 'positive' | 'warning' | 'negative';

const ORDER_TONE: Record<string, Tone> = { confirmed: 'positive', draft: 'muted', cancelled: 'negative' };
const PAYMENT_TONE: Record<string, Tone> = {
  paid: 'positive',
  collected: 'positive',
  pending: 'warning',
  awaiting_collection: 'warning',
  cancelled: 'negative',
};

/** مبلغ بالهللات من عقد API. عملة غير الريال تُعرض برمزها دون أي تحويل مفترض. */
export function formatOrderMoney(money: Money | null | undefined): string {
  if (!money || !Number.isFinite(money.amount_minor)) return '—';
  if (money.currency === 'SAR') return formatMinorRiyal(money.amount_minor);
  const major = minorToRiyal(money.amount_minor);

  return major === '' ? '—' : `${major} ${money.currency}`;
}

export function OrderStatusBadge({ status, locale }: { status: string; locale: string }) {
  const { label } = ordersMessages(locale);

  return <Badge tone={ORDER_TONE[status] ?? 'muted'}>{label('status', status)}</Badge>;
}

export function PaymentStatusBadge({ status, locale }: { status: string | null; locale: string }) {
  const { label, t } = ordersMessages(locale);
  if (!status) return <Badge tone="muted">{t('payment.none')}</Badge>;

  return <Badge tone={PAYMENT_TONE[status] ?? 'muted'}>{label('payment', status)}</Badge>;
}

const ACCEPTANCE_TONE: Record<AcceptanceBadgeKind, Tone> = { rejected: 'negative', accepted: 'positive', awaiting: 'warning', auto: 'muted' };

/** شارة القبول (H1-5): بُعد مستقل عن شارتي الطلب والدفع. تغيب (null) حين لا بيانات قبول أو حالة لا تخصّه. */
export function AcceptanceBadge({ order, locale }: { order: Pick<OrderSummary, 'acceptance' | 'operational_status' | 'cancellation'>; locale: string }) {
  const kind = acceptanceBadgeOf(order);
  if (kind === null) return null;
  const { label } = ordersMessages(locale);

  return <Badge tone={ACCEPTANCE_TONE[kind]}>{label('acceptanceBadge', kind)}</Badge>;
}

const FULFILLMENT_TONE: Record<string, Tone> = {
  preparing: 'warning',
  ready: 'neutral',
  out_for_delivery: 'neutral',
  delivery_failed: 'negative',
  returned_to_store: 'warning',
  delivered: 'positive',
  picked_up: 'positive',
};

/** شارة التنفيذ (H2-3): من حقائق التنفيذ المخزَّنة فقط، وتغيب (null) حين لا صف. `ready` لاستلام العميل تُسمّى «جاهز للاستلام». */
export function FulfillmentBadge({ fulfillment, locale }: { fulfillment: { status: string; type: string } | undefined; locale: string }) {
  if (!fulfillment) return null;
  const { label, t } = ordersMessages(locale);
  const text = fulfillment.status === 'ready' && fulfillment.type === 'pickup' ? t('fulfillment.ready_pickup') : label('fulfillment', fulfillment.status);

  return <Badge tone={FULFILLMENT_TONE[fulfillment.status] ?? 'muted'}>{text}</Badge>;
}

/**
 * خلية موعد التسليم في الطابور (COPS-H2-6). التوقيتات تأتي من الخادم UTC، وتُعرض **بمنطقة لقطة الطلب** (`queue.timezone`) لا بمنطقة المتصفح:
 * موظف مسافر يرى الموعد نفسه الذي التقطه الطلب. لا حساب استحقاق في المتصفح.
 */
export function DueCell({ queue, locale }: { queue: { window_start: string; window_end: string; prepare_from: string; timezone: string; buckets: string[] }; locale: string }) {
  const { t } = ordersMessages(locale);
  const fmt = (iso: string, withDate: boolean): string => {
    try {
      return new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'ar', {
        timeZone: queue.timezone,
        ...(withDate ? { month: 'short', day: 'numeric' } : {}),
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-0.5 text-xs">
      <div className="num">
        {fmt(queue.window_start, true)} – {fmt(queue.window_end, false)}
      </div>
      <div className="text-muted">
        {t('duePrepareFrom')} <span className="num">{fmt(queue.prepare_from, true)}</span>
      </div>
    </div>
  );
}
