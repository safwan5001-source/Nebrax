/**
 * AC-UX-07/11 — تحديث الدور والصلاحيات **ونطاق المستخدم نفسه** المخزَّنة من `/me` (منطق نقيّ).
 *
 * الصلاحيات تُخزَّن عند الدخول، فتبقى قديمةً لو غيّر المالك دور المستخدم أو نطاقه أثناء جلسته. إعادة القراءة
 * تُحدِّث **الدور والصلاحيات وحقلَي النطاق فقط** (`branch_ids` / `warehouse_ids`، الفراغ = غير مقيَّد): لا تفضيلات
 * (لغة/سمة) ولا أي حقل آخر، ولا تُقبل استجابةٌ لمستخدمٍ آخر غير صاحب الجلسة الحالية (تبديل حساب في تبويب آخر).
 * الخادم يبقى السلطة في كل طلب؛ هذا التحديث يُصلح ما تعرضه الواجهة فقط.
 */

import type { AuthUser } from './auth';

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false;
  const left = new Set(a);
  return left.size === new Set(b).size && b.every((item) => left.has(item));
};

const isIdList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/** المستخدم المحدَّث، أو `null` إن لم يتغيّر شيء أو كانت الاستجابة غير صالحة للتبنّي. */
export function mergeRefreshedAccess(current: AuthUser | null, fetched: Partial<AuthUser> | null | undefined): AuthUser | null {
  if (!current || !fetched) return null;
  if (fetched.id !== current.id) return null;
  // قائمةٌ غائبة ليست «لا صلاحيات»: لا نُنزل المستخدم إلى سقوط الدور بسبب استجابة ناقصة.
  if (!Array.isArray(fetched.permissions)) return null;

  const role = typeof fetched.role === 'string' && fetched.role !== '' ? fetched.role : current.role;
  const permissionsChanged = current.permissions === undefined || !sameSet(current.permissions, fetched.permissions);

  // النطاق: يُتبنّى كلٌّ من الحقلين مستقلاً حين يكون قائمةً صالحة فقط (خادمٌ أقدم لا يرسله ⇒ المخزَّن كما هو).
  const branchIds = isIdList(fetched.branch_ids) ? fetched.branch_ids : undefined;
  const warehouseIds = isIdList(fetched.warehouse_ids) ? fetched.warehouse_ids : undefined;
  const branchesChanged = branchIds !== undefined && (current.branch_ids === undefined || !sameSet(current.branch_ids, branchIds));
  const warehousesChanged = warehouseIds !== undefined && (current.warehouse_ids === undefined || !sameSet(current.warehouse_ids, warehouseIds));

  if (!permissionsChanged && !branchesChanged && !warehousesChanged && role === current.role) return null;

  return {
    ...current,
    role,
    // المرجع القديم حين لم تتغيّر الصلاحيات — يُبقي مراجع المستهلكين ثابتة (مصفوفات اعتماد).
    permissions: permissionsChanged ? fetched.permissions : (current.permissions as string[]),
    ...(branchIds !== undefined ? { branch_ids: branchIds } : {}),
    ...(warehouseIds !== undefined ? { warehouse_ids: warehouseIds } : {}),
  };
}
