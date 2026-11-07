/**
 * UI-0 — تنقل «تشغيل المحطات» (سياسة عرض فقط، لا تمنح صلاحية).
 *
 * الصلاحيات والأدوار من أَوْج حصراً: العناصر تظهر حين تمنحها صلاحيات المستخدم الفعلية، والخادم يبقى السلطة في
 * كل طلب. «الوضع» (بائع/مشرف/اطلاع) تسمية عرض مشتقة من الصلاحيات — لا دور مخزَّن ولا تصعيد من الواجهة.
 */

export const OPS_BASE = '/fuel-stations/ops';

export type OpsMode = 'supervisor' | 'operator' | 'viewer';
export type OpsNavId = 'home' | 'products' | 'shifts' | 'receiving' | 'tanks' | 'manage' | 'profile';

export interface OpsNavItem {
  id: OpsNavId;
  href: string;
  labelKey: string;
  /** كل الصلاحيات مطلوبة معاً (القائمة الفارغة = متاح لكل مستخدم موثّق). */
  requires: readonly string[];
  /** FUEL-B4: يكفي واحدة منها (بعد `requires`) — للمساحة الإدارية التي تظهر لمن يملك أي وظيفة إدارية. */
  requiresAny?: readonly string[];
}

/** FUEL-B5: أي قدرة استلام (عرض/إنشاء/اعتماد) — المفتاح الدقيق من B2 أو `fuel_stations.manage` القديم؛ `fuel_stations.view` وحدها (مفتاح كل مستخدم محطة) لا تكفي. */
export const RECEIVING_PERMISSIONS = ['fuel.delivery.view', 'fuel.delivery.create', 'fuel.delivery.approve', 'fuel.delivery.cost.record', 'fuel_stations.manage'] as const;

/** FUEL-B4 (+B6: سياسة القراءات المتأخرة تتبع `fuel.governance.manage`): صلاحيات الوظائف الإدارية داخل التطبيق (القائمة الكنسية؛ منها يُشتق ظهور «الإدارة» وأقسامها، والخادم يفرضها في كل طلب). */
export const MANAGE_PERMISSIONS = ['fuel.staff.manage', 'fuel.sale.price.manage', 'fuel.governance.manage', 'fuel_stations.manage'] as const; // + B6: الحوكمة · + PR-2: إعداد المحطة (معالج الرصيد الافتتاحي)

/**
 * FUEL-B4: **الاستثناء الوحيد** لقاعدة «لا روابط خارج التطبيق»: إدارة أسعار الوقود الموجودة (شاشة المسؤول القائمة) — بطلب صريح من المالك،
 * وتظهر لمن يملك `fuel.sale.price.manage` فقط. لا رابط خارجي آخر مسموح (يحرسه `app-only.test.ts`).
 */
export const PRICES_HREF = '/fuel-stations/prices';

export const OPS_NAV: readonly OpsNavItem[] = [
  { id: 'home', href: OPS_BASE, labelKey: 'navHome', requires: ['fuel_stations.view'] },
  { id: 'products', href: `${OPS_BASE}/products`, labelKey: 'navProducts', requires: ['fuel_stations.view'] },
  { id: 'shifts', href: `${OPS_BASE}/shifts`, labelKey: 'navShifts', requires: ['fuel_stations.view', 'fuel.shift.view'] },
  { id: 'receiving', href: `${OPS_BASE}/receiving`, labelKey: 'navReceiving', requires: ['fuel_stations.view'], requiresAny: RECEIVING_PERMISSIONS },
  // FUEL-B6: مستويات الخزانات (مراقبة + قراءات مستقلة). القراءة بمفتاح كل مستخدم محطة؛ التسجيل يتحكم به الخادم ومفتاح `fuel.reading.record`.
  { id: 'tanks', href: `${OPS_BASE}/tanks`, labelKey: 'navTanks', requires: ['fuel_stations.view'] },
  { id: 'manage', href: `${OPS_BASE}/manage`, labelKey: 'navManage', requires: [], requiresAny: MANAGE_PERMISSIONS },
  { id: 'profile', href: `${OPS_BASE}/profile`, labelKey: 'navProfile', requires: [] },
];

export function visibleOpsNav(canAll: (permissions: readonly string[]) => boolean): OpsNavItem[] {
  return OPS_NAV.filter((item) => canAll(item.requires) && (item.requiresAny === undefined || item.requiresAny.some((permission) => canAll([permission]))));
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
