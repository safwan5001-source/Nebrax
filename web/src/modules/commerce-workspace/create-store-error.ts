import { commerceWorkspaceMessage } from './messages';
import type { CommerceStoreCreateFailure } from './stores';

/**
 * رسالة واضحة لفشل إنشاء المتجر، مستخرجة من رمز/حالة الخادم لا من نصه الخام:
 *  - `tenant_slug_not_hostname_safe` ⇒ شرح معرّف الشركة غير الصالح لعنوان المتجر.
 *  - 403 ⇒ لا صلاحية · 409 ⇒ تعارض · 5xx ⇒ خطأ إعداد خادم · غير ذلك ⇒ الرسالة العامة.
 * رسالة الخادم الخام لا تُعرض أبداً (قد تكون بلغة أخرى أو تفصيلاً داخلياً).
 */
export function describeCreateStoreFailure(failure: CommerceStoreCreateFailure, locale: string | undefined): string {
  const m = (key: Parameters<typeof commerceWorkspaceMessage>[1]) => commerceWorkspaceMessage(locale, key);
  if (failure.reason === 'tenant_slug_not_hostname_safe') return m('createStoreSlugUnsafe');
  if (failure.status === 403) return m('createStoreForbidden');
  if (failure.status === 409) return m('createStoreConflict');
  if (typeof failure.status === 'number' && failure.status >= 500) return m('createStoreServerError');
  return m('createStoreFailed');
}
