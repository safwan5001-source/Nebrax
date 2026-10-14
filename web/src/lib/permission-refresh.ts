/**
 * AC-UX-07 — تحديث الصلاحيات المخزَّنة من `/me` (منطق نقيّ).
 *
 * الصلاحيات تُخزَّن عند الدخول، فتبقى قديمةً لو غيّر المالك دور المستخدم أثناء جلسته. إعادة القراءة
 * تُحدِّث **الدور والصلاحيات فقط**: لا تفضيلات (لغة/سمة) ولا أي حقل آخر، ولا تُقبل استجابةٌ لمستخدمٍ
 * آخر غير صاحب الجلسة الحالية (تبديل حساب في تبويب آخر). الخادم يبقى السلطة في كل طلب؛ هذا
 * التحديث يُصلح ما تعرضه الواجهة فقط.
 */

import type { AuthUser } from './auth';

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false;
  const left = new Set(a);
  return left.size === new Set(b).size && b.every((item) => left.has(item));
};

/** المستخدم المحدَّث، أو `null` إن لم يتغيّر شيء أو كانت الاستجابة غير صالحة للتبنّي. */
export function mergeRefreshedAccess(current: AuthUser | null, fetched: Partial<AuthUser> | null | undefined): AuthUser | null {
  if (!current || !fetched) return null;
  if (fetched.id !== current.id) return null;
  // قائمةٌ غائبة ليست «لا صلاحيات»: لا نُنزل المستخدم إلى سقوط الدور بسبب استجابة ناقصة.
  if (!Array.isArray(fetched.permissions)) return null;

  const role = typeof fetched.role === 'string' && fetched.role !== '' ? fetched.role : current.role;
  const permissionsChanged = !sameSet(current.permissions ?? [], fetched.permissions) || current.permissions === undefined;
  if (!permissionsChanged && role === current.role) return null;

  return { ...current, role, permissions: fetched.permissions };
}
