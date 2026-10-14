import { ApiError } from '@/lib/api';

/**
 * وصفُ فشل تحميل صفحة بحسب نوعه (ERP-UX-009):
 * - 403 (صلاحية أو استحقاق تجاري): رسالة من كتالوج الواجهة بلغتها — لا جملة الخادم
 *   العربية — و`forbidden: true` فلا تُعرض «إعادة المحاولة» ولا دعوة «إنشاء» لموردٍ ممنوع.
 * - غير ذلك: رسالة الخادم كما كانت (أو البديل)، وتبقى إعادة المحاولة متاحة.
 */
export interface LoadFailure {
  message: string;
  forbidden: boolean;
}

export function describeLoadFailure(error: unknown, messages: { forbidden: string; fallback: string }): LoadFailure {
  if (error instanceof ApiError) {
    if (error.status === 403) return { message: messages.forbidden, forbidden: true };
    return { message: error.message || messages.fallback, forbidden: false };
  }
  return { message: messages.fallback, forbidden: false };
}
