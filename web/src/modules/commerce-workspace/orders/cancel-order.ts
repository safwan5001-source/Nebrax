import { api } from '@/lib/api';
import { CANCELLATION_NOTE_MAX, CANCELLATION_REASONS, type CancellationReason, type OrderDetail } from './contract';
import { COMMERCE_ORDERS_PATH } from './orders-api';

/**
 * COMMERCE-ORDERS-O3b — إلغاء طلب متجر: `POST commerce/orders/{id}/cancel` (O3a-2b). الكتابة الوحيدة في وحدة الطلبات، معزولة في هذا الملف
 * (يحرس ذلك orders-readonly.test.ts). لا منطق إلغاء موازٍ: الواجهة تجمع السبب والملاحظة وتُرسل، والخادم يحكم (مصفوفة ADR-28 تحت الأقفال).
 */

export type CancelInput = { reason: CancellationReason | ''; note: string };
export type CancelFieldError = 'reason_required' | 'note_required' | 'note_too_long';

/** تحقق محلي مطابق لقواعد الخادم (سبب من القائمة، `other` يتطلب ملاحظة، ≤ 500). الخادم يعيد التحقق دائماً. */
export function validateCancelInput(input: CancelInput): CancelFieldError | null {
  if (!(CANCELLATION_REASONS as readonly string[]).includes(input.reason)) return 'reason_required';
  const note = input.note.trim();
  if (input.note.length > CANCELLATION_NOTE_MAX) return 'note_too_long';
  if (input.reason === 'other' && note === '') return 'note_required';
  return null;
}

export async function cancelOrder(id: string, input: CancelInput): Promise<OrderDetail> {
  const note = input.note.trim();
  const response = await api<{ data: OrderDetail }>(`${COMMERCE_ORDERS_PATH}/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: { reason: input.reason, ...(note === '' ? {} : { note }) },
  });

  return response.data;
}

export type CancelErrorKind = 'session' | 'forbidden' | 'not_found' | 'conflict' | 'validation' | 'network' | 'unknown';

export type CancelFailure = {
  kind: CancelErrorKind;
  /** رمز المصفوفة من 409 (`payment_collected`…) لعرض سبب مفهوم؛ غيره `null`. */
  reason: string | null;
};

/**
 * 401 جلسة · 403 صلاحية/بوابة/قدرة · 404 موحَّد (غير موجود أو مستأجر آخر) · 409 رفض المصفوفة (الحالة تغيّرت) · 422 مدخل/مسودة · بلا حالة = شبكة
 * (الإلغاء غير مؤكَّد: لا نفترض نجاحاً ولا فشلاً — نطلب التحديث). أي حالة أخرى `unknown`.
 */
export function classifyCancelError(error: unknown): CancelFailure {
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
