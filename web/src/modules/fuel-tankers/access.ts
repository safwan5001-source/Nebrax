import { ApiError } from '@/lib/api';

export const TANKER_VIEW = 'fuel.tanker.view';
export const TANKER_MANAGE = 'fuel.tanker.manage';

/** `null` = الصلاحيات لم تُحمَّل بعد (لا يُحكم بالمنع ولا بالسماح). المالك/المدير يحملان `*`. */
export function hasPermission(permissions: string[] | null, key: string): boolean {
  return permissions !== null && (permissions.includes('*') || permissions.includes(key));
}

/**
 * ما تعنيه استجابة الخادم لشاشة الميزة. **الخادم هو المصدر الوحيد للحقيقة**: الواجهة لا تقرأ بوابة النشر من أي مكان آخر.
 *  - 404 على القائمة ⇒ بوابة الميزة مغلقة (يردّ الخادم 404 موحَّداً قبل الصلاحية).
 *  - 404 على سجل بمعرّف ⇒ غير موجود أو خارج نطاق المستأجر أو الميزة مغلقة — لا يُميَّز (لا تسريب).
 *  - 403 ⇒ لا صلاحية. 422 ⇒ تحقق (حقول). غير ذلك ⇒ خطأ عام قابل لإعادة المحاولة.
 */
export type AccessProblem = 'gate_closed' | 'not_found' | 'forbidden' | 'validation' | 'other';

export function classifyError(error: unknown, scope: 'list' | 'record' | 'write'): AccessProblem {
  const status = error instanceof ApiError ? error.status : typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status: unknown }).status) : 0;
  if (status === 403) return 'forbidden';
  if (status === 404) return scope === 'list' ? 'gate_closed' : 'not_found';
  if (status === 422) return 'validation';
  return 'other';
}

/** رسائل التحقق من الخادم (422) حقلاً حقلاً — أول رسالة لكل حقل. */
export function fieldErrors(error: unknown): Record<string, string> {
  const errors = error instanceof ApiError && error.body && typeof error.body === 'object' ? (error.body as { errors?: unknown }).errors : undefined;
  if (!errors || typeof errors !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [field, messages] of Object.entries(errors as Record<string, unknown>)) {
    const first = Array.isArray(messages) ? messages.find((m) => typeof m === 'string') : typeof messages === 'string' ? messages : undefined;
    if (typeof first === 'string') out[field] = first;
  }
  return out;
}

/** رسالة الخادم الآمنة لخطأ لا ينتمي لحقل بعينه، وإلا `null` فتعرض الشاشة نصها المترجم. */
export function serverMessage(error: unknown): string | null {
  return error instanceof ApiError && error.message ? error.message : null;
}
