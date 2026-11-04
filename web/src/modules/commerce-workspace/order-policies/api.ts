import { api } from '@/lib/api';

/**
 * COPS-H4-5 — قراءة `GET /sales-settings` (`invoices.view`) وكتابة `PUT /sales-settings` (`company.manage`) **لمفتاح واحد**: `commerce_payment_hold_minutes`.
 * المفاتيح المحاسبية/الضريبية (`commerce_invoice_trigger`، `commerce_price_tax_mode`، `commerce_partner_policy`) للقراءة فقط هنا (D-H4-07): لا يوجد أي مسار كتابة لها في هذه الوحدة
 * (يحرسه `order-policies-readonly.test.ts`).
 */
export type OrderPolicies = {
  holdMinutes: number;
  invoiceTrigger: string;
  priceTaxMode: string | null;
  partnerPolicy: string;
};

export function mapOrderPolicies(payload: unknown): OrderPolicies | null {
  const data = (payload as { data?: Record<string, unknown> } | null)?.data;
  if (!data || typeof data.commerce_payment_hold_minutes !== 'number' || !Number.isInteger(data.commerce_payment_hold_minutes)) return null;

  return {
    holdMinutes: data.commerce_payment_hold_minutes,
    invoiceTrigger: typeof data.commerce_invoice_trigger === 'string' ? data.commerce_invoice_trigger : 'none',
    priceTaxMode: typeof data.commerce_price_tax_mode === 'string' ? data.commerce_price_tax_mode : null,
    partnerPolicy: typeof data.commerce_partner_policy === 'string' ? data.commerce_partner_policy : 'link_verified_else_create',
  };
}

export async function fetchOrderPolicies(): Promise<OrderPolicies> {
  const policies = mapOrderPolicies(await api<unknown>('/sales-settings'));
  if (!policies) throw new Error('sales settings response not recognised');

  return policies;
}

/** يكتب مدة الحجز وحدها (الخادم يدمج المفاتيح المرسلة فقط ويُبقي بقية الإعدادات كما هي). */
export async function saveHoldMinutes(minutes: number): Promise<OrderPolicies> {
  const policies = mapOrderPolicies(await api<unknown>('/sales-settings', { method: 'PUT', body: { commerce_payment_hold_minutes: minutes } }));
  if (!policies) throw new Error('sales settings response not recognised');

  return policies;
}
