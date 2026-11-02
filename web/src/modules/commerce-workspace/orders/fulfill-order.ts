import { api } from '@/lib/api';
import { FAILURE_REASONS, FULFILLMENT_FIELD_MAX, FULFILLMENT_NOTE_MAX, FULFILLMENT_URL_MAX, type FulfillmentActionName, type OrderDetail } from './contract';
import { COMMERCE_ORDERS_PATH } from './orders-api';

/**
 * COPS-H2-3 — إجراءات تنفيذ الطلب: `POST commerce/orders/{id}/fulfillment/{action}` و`PATCH commerce/orders/{id}/fulfillment` (H2-1). الكتابتان
 * الوحيدتان الجديدتان في وحدة الطلبات لـH2-3، معزولتان في هذا الملف (يحرس ذلك orders-readonly.test.ts) مع `cancel-order.ts` و`accept-order.ts`.
 *
 * لا منطق أهلية موازٍ: الواجهة تعرض الإجراء من عقد القراءة (`fulfillment_actions`) وتُرسل مع `expected_version` الظاهر، والخادم يحكم دائماً تحت الأقفال
 * (409 ⇒ تحديث وقفل التأكيد القديم). لا إجراء «إلغاء/إغلاق/شطب/استرداد» لفشل التوصيل (AR-1): كل الإجراءات سبعة معتمدة فقط. لا مخزون ولا قيد.
 */

export type FulfillmentDetails = {
  type?: 'local_delivery' | 'carrier';
  carrier_name?: string;
  tracking_number?: string;
  tracking_url?: string;
  courier_name?: string;
  courier_phone?: string;
  note?: string;
};

export type FulfillmentActionInput = Omit<FulfillmentDetails, 'type' | 'note'> & { reason?: string; note?: string };

function path(id: string): string {
  return `${COMMERCE_ORDERS_PATH}/${encodeURIComponent(id)}/fulfillment`;
}

/** يزيل الحقول الفارغة غير المعرَّفة؛ نص فارغ يُرسَل كما هو فقط في PATCH (مسح مقصود) — انظر `clearable`. */
function compact<T extends Record<string, unknown>>(input: T, clearable: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '' && !clearable) continue;
      out[key] = trimmed;
    } else {
      out[key] = value;
    }
  }

  return out;
}

export async function fulfillOrder(id: string, action: FulfillmentActionName, expectedVersion: number, input: FulfillmentActionInput = {}): Promise<OrderDetail> {
  const response = await api<{ data: OrderDetail }>(`${path(id)}/${encodeURIComponent(action)}`, {
    method: 'POST',
    body: { expected_version: expectedVersion, ...compact(input, false) },
  });

  return response.data;
}

export async function updateFulfillmentDetails(id: string, expectedVersion: number, details: FulfillmentDetails): Promise<OrderDetail> {
  const response = await api<{ data: OrderDetail }>(path(id), {
    method: 'PATCH',
    body: { expected_version: expectedVersion, ...compact(details, true) },
  });

  return response.data;
}

export type FulfillmentValidation = 'reason_required' | 'note_too_long' | 'field_too_long' | 'url_invalid' | 'phone_invalid' | 'carrier_required' | null;

/** تحقق محلي مطابق للخادم (الخادم يحكم دائماً). */
export function validateFailure(reason: string, note: string): FulfillmentValidation {
  if (!(FAILURE_REASONS as readonly string[]).includes(reason)) return 'reason_required';
  if (note.length > FULFILLMENT_NOTE_MAX) return 'note_too_long';

  return null;
}

export function validateDetails(d: FulfillmentDetails): FulfillmentValidation {
  for (const key of ['carrier_name', 'tracking_number', 'courier_name'] as const) {
    if ((d[key] ?? '').trim().length > FULFILLMENT_FIELD_MAX) return 'field_too_long';
  }
  const url = (d.tracking_url ?? '').trim();
  if (url !== '' && (url.length > FULFILLMENT_URL_MAX || !/^https:\/\/[^\s/]+\S*$/i.test(url))) return 'url_invalid';
  const phone = toLatinDigits((d.courier_phone ?? '').trim());
  if (phone !== '' && !/^\+?[0-9]{7,15}$/.test(phone)) return 'phone_invalid';
  if ((d.note ?? '').length > FULFILLMENT_NOTE_MAX) return 'note_too_long';

  return null;
}

/** أرقام عربية/فارسية ← لاتينية (الخادم يطبّع الشيء نفسه). */
export function toLatinDigits(value: string): string {
  return value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}
