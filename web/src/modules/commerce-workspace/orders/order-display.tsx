'use client';

import { Badge } from '@/components/ui/badge';
import { formatMinorRiyal, minorToRiyal } from '@/lib/money';
import type { Money } from './contract';
import { ordersMessages } from './messages';

type Tone = 'neutral' | 'muted' | 'positive' | 'warning' | 'negative';

const ORDER_TONE: Record<string, Tone> = { confirmed: 'positive', draft: 'muted' };
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
