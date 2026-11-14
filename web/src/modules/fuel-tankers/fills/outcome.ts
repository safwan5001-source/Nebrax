import { ApiError } from '@/lib/api';
import type { FillDetail, InventoryStatus, Operation } from './logic';

/**
 * TANKER-PR6B-5 — **نتيجة صادقة** لكتابة مالية (ترحيل/عكس). لا يوجد «نجاح مفترض» ولا إعادة إرسال تلقائية:
 *  - `ok`: أكّد الخادم التنفيذ (201) أو أن التنفيذ سبق (200 + `meta.replayed`) — `replayed` يعني «لم يتكرر شيء».
 *  - `rejected`: ردّ الخادم 4xx برمز `reason` ⇒ **لا أثر** (المعاملة تتراجع كاملة)؛ تُعرض الموانع إن وُجدت.
 *  - `unknown`: انقطاع/مهلة/5xx/استجابة نجاح غير مفهومة **بعد الإرسال** ⇒ قد تكون العملية تمّت. يُحسم بإعادة **قراءة** السند فقط.
 *  - `not_sent`: لم يُرسَل شيء (فشل تحقق محلي أو انقطاع معروف قبل الإرسال).
 */
export type WriteOutcome =
  | { kind: 'ok'; replayed: boolean; inventoryStatus: InventoryStatus }
  | { kind: 'rejected'; status: number; reason: string | null; blockers: string[]; message: string | null }
  | { kind: 'unknown'; cause: 'timeout' | 'network' | 'server' | 'unverified' }
  | { kind: 'not_sent'; cause: 'validation' | 'offline' | 'invalid_id' };

const asObject = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});

/** HTTP status ⇒ رمز احتياطي حين لا يحمل الجسم `reason` (401/403/404/409/422/429). */
function fallbackReason(status: number): string {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  return 'validation';
}

/**
 * يصنّف استثناءً صدر من `api()` بعد **إرسال** الطلب. `ApiError` 5xx/408 ⇒ `unknown` (قد يكون الالتزام تمّ)؛ 4xx ⇒ `rejected`؛
 * غير `ApiError` (انقطاع شبكة، مهلة الإلغاء) ⇒ `unknown`.
 */
export function classifyWriteError(error: unknown): Extract<WriteOutcome, { kind: 'rejected' | 'unknown' }> {
  if (error instanceof ApiError) {
    if (error.status >= 500 || error.status === 408) return { kind: 'unknown', cause: 'server' };
    const body = asObject(error.body);
    const details = asObject(body.details);
    const reason = typeof body.reason === 'string' && body.reason !== '' ? body.reason : fallbackReason(error.status);
    const blockers = Array.isArray(details.blockers) ? details.blockers.filter((value): value is string => typeof value === 'string') : [];
    const message = typeof body.message === 'string' && body.message !== '' && body.message !== 'حدث خطأ' ? body.message : null;
    return { kind: 'rejected', status: error.status, reason, blockers, message };
  }
  const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
  return { kind: 'unknown', cause: name === 'AbortError' ? 'timeout' : 'network' };
}

/** نتيجة إعادة قراءة السند بعد نتيجة غير مؤكدة. */
export type Verification = 'done' | 'unchanged';

/**
 * هل تمّت العملية؟ تُحسم **من حالة السند الحالية** وحدها: بعد ترحيل غير مؤكد ⇒ أي حالة غير «بانتظار الدمج» تعني أن الترحيل تمّ؛ وبعد عكس غير مؤكد ⇒ «معكوس» تعني أنه تمّ.
 * `unchanged` تعني أن الحالة كما قبل العملية (لم تتم) — وعندها فقط يُعرض خيار إعادة المحاولة الصريح.
 */
export function verifyAfterUnknown(operation: Operation, detail: Pick<FillDetail, 'inventory_status'>): Verification {
  if (operation === 'post') return detail.inventory_status === 'pending_integration' ? 'unchanged' : 'done';
  return detail.inventory_status === 'reversed' ? 'done' : 'unchanged';
}

/** نتيجة «لم يُرسَل شيء» (فشل تحقق محلي، انقطاع معروف، معرّف غير صالح). */
export const notSent = (cause: 'validation' | 'offline' | 'invalid_id' = 'validation'): WriteOutcome => ({ kind: 'not_sent', cause });
