import type { OrderDetail, OrderSummary } from './contract';

const sar = (minor: number) => ({ amount_minor: minor, currency: 'SAR' });

export function summaryFixture(over: Partial<OrderSummary> = {}): OrderSummary {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    number: 'CORD-100',
    status: 'confirmed',
    created_at: '2026-10-20T10:00:00+03:00',
    confirmed_at: '2026-10-20T10:00:00+03:00',
    total: sar(11500),
    items_count: 2,
    delivery_method: 'standard',
    customer: { name: 'سارة', phone: '0500000001' },
    channel: {
      sales_channel_id: 'c1',
      sales_channel_name: 'متجر الويب',
      sales_channel_type: 'web',
      storefront_id: 's1',
      storefront_name: 'زهور طيبة',
    },
    payment: {
      intent_id: 'i1',
      method: 'cod',
      status: 'awaiting_collection',
      payment_method_name: null,
      amount_minor: 11500,
      collected_at: null,
      paid_at: null,
      cancelled_at: null,
    },
    ...over,
  };
}

export function detailFixture(over: Partial<OrderDetail> = {}): OrderDetail {
  return {
    ...summaryFixture(),
    partner_id: null,
    delivery_amount: sar(1500),
    contact: { name: 'سارة', company: null, email: 'buyer@example.test', phone: '0500000001', vat_number: null, cr_number: null },
    shipping_address: {
      recipient_name: 'منى', phone: '0500000002', country: 'SA', region: null, city: 'الدمام', district: 'الشاطئ',
      street: 'شارع الخليج', building_no: null, additional_number: null, postal_code: null, notes: null,
    },
    billing_address: null,
    gift: null,
    schedule: null,
    items: [
      {
        id: 'l1', parent_line_id: null, product_id: 'p1', product_variant_id: null, product_name: 'وردة جورية', variant: null,
        unit_name: null, quantity: 2, unit_price: sar(5000), line_total: sar(10000),
        personalization: [{ key: 'card', label: 'نص البطاقة', label_en: 'Card text', value: 'مبروك', value_label: null }],
      },
    ],
    payment: {
      ...summaryFixture().payment,
      collection_note: null,
      attempts: [],
    },
    accounting: { posted: false },
    ...over,
  } as OrderDetail;
}

/** COPS-H1-5: طلب COD بانتظار القبول اليدوي مع عقدَي القبول والرفض (مالك: الاثنان متاحان). */
export function awaitingFixture(over: Partial<OrderDetail> = {}): OrderDetail {
  return detailFixture({
    operational_status: 'awaiting_acceptance',
    acceptance: { mode: 'manual', effective_mode: 'manual', accepted_at: null },
    accept_action: { available: true, blocked_reason: null },
    reject_action: { available: true, blocked_reason: null },
    cancel_action: { available: true, blocked_reason: null },
    ...over,
  });
}

export function acceptedFixture(over: Partial<OrderDetail> = {}): OrderDetail {
  return detailFixture({
    operational_status: 'accepted',
    acceptance: { mode: 'manual', effective_mode: 'manual', accepted_at: '2026-11-02T10:30:00+03:00', by: { id: 'u1', name: 'المشرف' } },
    accept_action: { available: false, blocked_reason: 'already_accepted' },
    reject_action: { available: false, blocked_reason: 'already_accepted' },
    cancel_action: { available: true, blocked_reason: null },
    ...over,
  });
}

export function rejectedFixture(over: Partial<OrderDetail> = {}): OrderDetail {
  return detailFixture({
    lifecycle_status: 'cancelled',
    operational_status: 'cancelled',
    acceptance: { mode: 'manual', effective_mode: 'manual', accepted_at: null },
    cancellation: { cancelled: true, at: '2026-11-02T10:40:00+03:00', reason: 'merchant_rejected', note: 'خارج نطاق التوصيل', by: { id: 'u1', name: 'المشرف' } },
    payment: { ...detailFixture().payment, status: 'cancelled', cancelled_at: '2026-11-02T10:40:00+03:00' },
    accept_action: { available: false, blocked_reason: 'already_cancelled' },
    reject_action: { available: false, blocked_reason: 'already_cancelled' },
    cancel_action: { available: false, blocked_reason: 'already_cancelled' },
    ...over,
  });
}
