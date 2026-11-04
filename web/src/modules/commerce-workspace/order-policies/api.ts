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

/**
 * الخادم يقبل مدة الحجز كعدد صحيح أو **نصّ رقمي** (`UpdateSalesSettingsRequest` بقاعدة `integer`، و`Settings::put` يحفظ النوع كما أُرسل، و`CommercePaymentHold::minutes()`
 * يدعم النص الرقمي صراحةً) — فمستأجر حُفظت مدته نصاً (`"90"`) يجب أن يرى الشاشة ويحرّرها لا أن يرى خطأ تحميل دائماً.
 */
export function normalizeHoldMinutes(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const minutes = Number(value.trim());

    return Number.isSafeInteger(minutes) ? minutes : null;
  }

  return null;
}

export function mapOrderPolicies(payload: unknown): OrderPolicies | null {
  const data = (payload as { data?: Record<string, unknown> } | null)?.data;
  const holdMinutes = data ? normalizeHoldMinutes(data.commerce_payment_hold_minutes) : null;
  if (!data || holdMinutes === null) return null;

  return {
    holdMinutes,
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
