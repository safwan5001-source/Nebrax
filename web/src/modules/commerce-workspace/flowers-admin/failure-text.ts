import type { AdminFailure } from './admin-http';
import type { FlowersAdminT } from './messages';

/**
 * نصّ الفشل للتاجر: نصّ الخادم لرفضٍ تحققي/تعارض فقط (صاغه الخادم له)، وإلا عبارة عامة مفهومة.
 * `saveFallback` يحدّد عبارة «تعذّر الحفظ» أو «تعذّر التحميل» حسب السياق.
 */
export function failureText(failure: AdminFailure, t: FlowersAdminT, context: 'save' | 'load' = 'save'): string {
  if (failure.kind === 'forbidden') return t('forbidden');
  if (failure.kind === 'not_found') return t('notFound');
  if ((failure.kind === 'invalid' || failure.kind === 'conflict') && failure.message) return failure.message;

  return context === 'save' ? t('saveFailed') : t('loadFailed');
}
