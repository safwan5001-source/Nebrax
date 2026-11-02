import { api } from '@/lib/api';
import { REJECTION_NOTE_MAX, type OrderDetail } from './contract';
import { COMMERCE_ORDERS_PATH } from './orders-api';

/**
 * COPS-H1-5 — قبول التاجر ورفضه: `POST commerce/orders/{id}/accept` و`POST commerce/orders/{id}/reject` (H1-4). الكتابتان الوحيدتان الجديدتان
 * في وحدة الطلبات، معزولتان في هذا الملف (يحرس ذلك orders-readonly.test.ts) مع `cancel-order.ts`. لا منطق أهلية موازٍ: الواجهة تعرض الإجراء من
 * عقد القراءة (`accept_action`/`reject_action`) وتُرسل، والخادم يحكم دائماً تحت الأقفال. الرفض إلغاءٌ بسبب `merchant_rejected` يتولاه الخادم.
 */

export type AcceptFailureKind = 'session' | 'forbidden' | 'not_found' | 'conflict' | 'validation' | 'network' | 'unknown';

export type AcceptFailure = {
  kind: AcceptFailureKind;
  /** رمز 409 الثابت (`payment_pending`، `already_cancelled`، `payment_collected`…) لعرض سبب مفهوم؛ غيره `null`. */
  reason: string | null;
};

/** تحقق محلي مطابق للخادم: ملاحظة الرفض اختيارية ≤ 500. */
export function validateRejectNote(note: string): 'note_too_long' | null {
  return note.length > REJECTION_NOTE_MAX ? 'note_too_long' : null;
}

export async function acceptOrder(id: string): Promise<OrderDetail> {
  const response = await api<{ data: OrderDetail }>(`${COMMERCE_ORDERS_PATH}/${encodeURIComponent(id)}/accept`, { method: 'POST' });

  return response.data;
}

export async function rejectOrder(id: string, note: string): Promise<OrderDetail> {
  const trimmed = note.trim();
  const response = await api<{ data: OrderDetail }>(`${COMMERCE_ORDERS_PATH}/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body: trimmed === '' ? {} : { note: trimmed },
  });

  return response.data;
}

/**
 * 401 جلسة · 403 صلاحية/قدرة (البوابة المغلقة 404 لا 403) · 404 موحَّد (غير موجود/مستأجر آخر/بوابة مغلقة) · 409 الحالة تغيّرت أو مرفوضة ·
 * 422 مدخل · بلا حالة = شبكة (النتيجة غير مؤكَّدة: لا نفترض نجاحاً ولا فشلاً — نحدّث من الخادم).
 */
export function classifyAcceptError(error: unknown): AcceptFailure {
  const status = typeof error === 'object' && error !== null && 'status' in error ? (error as { status?: unknown }).status : undefined;
  const body = typeof error === 'object' && error !== null && 'body' in error ? (error as { body?: unknown }).body : undefined;
  const reason = typeof body === 'object' && body !== null && typeof (body as { reason?: unknown }).reason === 'string' ? (body as { reason: string }).reason : null;

  if (status === 401) return { kind: 'session', reason: null };
  if (status === 403) return { kind: 'forbidden', reason: null };
  if (status === 404) return { kind: 'not_found', reason: null };
  if (status === 409) return { kind: 'conflict', reason };
  if (status === 422) return { kind: 'validation', reason };
  if (typeof status === 'number') return { kind: 'unknown', reason: null };
  return { kind: 'network', reason: null };
}

/** هل الفشل يعني أن الحالة المعروضة قديمة أو غير مؤكَّدة ⇒ يجب التحديث من الخادم وعدم إعادة المحاولة على بيانات قديمة؟ */
export function failureMeansStale(failure: AcceptFailure): boolean {
  return failure.kind === 'conflict' || failure.kind === 'not_found' || failure.kind === 'network';
}
