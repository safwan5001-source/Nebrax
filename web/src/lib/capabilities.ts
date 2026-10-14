/**
 * AC-UX-07 — نموذج القدرات الموحَّد (دوال نقية).
 *
 * طبقةٌ رقيقة فوق `hasPermission` (مرآة `Rbac::allows`): الدلالة نفسها حرفياً —
 * القائمة المحسوبة من الخادم هي الحقيقة، والدور يُستشار فقط حين تغيب القائمة تماماً،
 * و`*` تعني كل شيء. المفتاح الكنسي بيانات غير شفّافة: يُمرَّر كما هو ولا يُحلَّل ولا يُركَّب.
 *
 * غياب المستخدم (لم يُرطَّب بعد / لا جلسة) = لا قدرة. الإخفاء في الواجهة ليس حدّاً أمنياً؛
 * الخادم يبقى السلطة، وهذا النموذج يمنع فقط عرض ما يُعرف سلفاً أنه سيُرفض.
 */

import { hasPermission } from './permissions';

export interface CapabilityViewer {
  permissions?: string[];
  role?: string | null;
}

export interface Capabilities<V extends CapabilityViewer = CapabilityViewer> {
  /** المستخدم الذي بُنيت عليه القدرات (`null` = غير معروف). */
  viewer: V | null;
  /** صلاحية واحدة. */
  can: (permission: string) => boolean;
  /** أيٌّ منها (قائمة فارغة = لا). */
  canAny: (permissions: readonly string[]) => boolean;
  /** كلّها (قائمة فارغة = نعم، شرطٌ فارغ). */
  canAll: (permissions: readonly string[]) => boolean;
}

export function createCapabilities<V extends CapabilityViewer>(viewer: V | null | undefined): Capabilities<V> {
  const known = viewer ?? null;
  const can = (permission: string): boolean =>
    known !== null && hasPermission(known.permissions, known.role ?? undefined, permission);

  return {
    viewer: known,
    can,
    canAny: (permissions) => permissions.some(can),
    canAll: (permissions) => permissions.every(can),
  };
}
