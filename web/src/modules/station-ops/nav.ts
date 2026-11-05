/**
 * UI-0 — تنقل «تشغيل المحطات» (سياسة عرض فقط، لا تمنح صلاحية).
 *
 * الصلاحيات والأدوار من أَوْج حصراً: العناصر تظهر حين تمنحها صلاحيات المستخدم الفعلية، والخادم يبقى السلطة في
 * كل طلب. «الوضع» (بائع/مشرف/اطلاع) تسمية عرض مشتقة من الصلاحيات — لا دور مخزَّن ولا تصعيد من الواجهة.
 */

export const OPS_BASE = '/fuel-stations/ops';

export type OpsMode = 'supervisor' | 'operator' | 'viewer';
export type OpsNavId = 'home' | 'products' | 'shifts' | 'profile';

export interface OpsNavItem {
  id: OpsNavId;
  href: string;
  labelKey: string;
  /** كل الصلاحيات مطلوبة معاً (القائمة الفارغة = متاح لكل مستخدم موثّق). */
  requires: readonly string[];
}

export const OPS_NAV: readonly OpsNavItem[] = [
  { id: 'home', href: OPS_BASE, labelKey: 'navHome', requires: ['fuel_stations.view'] },
  { id: 'products', href: `${OPS_BASE}/products`, labelKey: 'navProducts', requires: ['fuel_stations.view'] },
  { id: 'shifts', href: `${OPS_BASE}/shifts`, labelKey: 'navShifts', requires: ['fuel_stations.view', 'fuel.shift.view'] },
  { id: 'profile', href: `${OPS_BASE}/profile`, labelKey: 'navProfile', requires: [] },
];

export function visibleOpsNav(canAll: (permissions: readonly string[]) => boolean): OpsNavItem[] {
  return OPS_NAV.filter((item) => canAll(item.requires));
}

export function deriveOpsMode(can: (permission: string) => boolean): OpsMode {
  if (can('fuel.shift.approve')) return 'supervisor';
  if (can('fuel.shift.open')) return 'operator';
  return 'viewer';
}

export function isNavActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === OPS_BASE) return pathname === OPS_BASE;
  return pathname === href || pathname.startsWith(`${href}/`);
}
