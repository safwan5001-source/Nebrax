import type { StaffUpdateBody } from './admin-client';
import type { StaffView, TemplatesPayload } from './schemas';

/**
 * FUEL-B4 — منطق نقي لمحرّر الصلاحيات (لا شبكة، لا حالة): التعديل يُمثَّل **تفاضلياً فوق الأساس المقروء** (ما أُضيف/أُزيل)، لا نسخةً كاملة.
 * فائدتان: (1) الفرق المعروض قبل الحفظ هو الحمولة نفسها بالضبط؛ (2) عند تعارض 409 تُعاد نية المستخدم فوق الحالة الجديدة دون فقدها.
 * لا شيء هنا يمنح صلاحية: الخادم يفرض السقف والمحجوز والنطاق، وهذا المنطق يمنع فقط عرض/إرسال ما سيُرفض حتماً.
 */

export interface EditIntent {
  permAdd: ReadonlySet<string>;
  permRemove: ReadonlySet<string>;
  stationAdd: ReadonlySet<string>;
  stationRemove: ReadonlySet<string>;
}

export const EMPTY_INTENT: EditIntent = { permAdd: new Set(), permRemove: new Set(), stationAdd: new Set(), stationRemove: new Set() };

export interface EditContext {
  /** المفاتيح التي يستطيع الفاعل **منحها** (من الخادم). */
  delegable: ReadonlySet<string>;
  /** المفتاحان المحجوزان (حوكمة الوقود، إدارة الموظفين). */
  reserved: ReadonlySet<string>;
}

export function contextOf(templates: TemplatesPayload): EditContext {
  return { delegable: new Set(templates.delegable), reserved: new Set(templates.reserved) };
}

export function effectivePermissions(base: StaffView, intent: EditIntent): string[] {
  const set = new Set(base.fuel_permissions);
  intent.permRemove.forEach((key) => set.delete(key));
  intent.permAdd.forEach((key) => set.add(key));
  return [...set].sort();
}

export function effectiveStations(base: StaffView, intent: EditIntent): string[] {
  const set = new Set(base.station_ids);
  intent.stationRemove.forEach((id) => set.delete(id));
  intent.stationAdd.forEach((id) => set.add(id));
  return [...set].sort();
}

export function isDirty(intent: EditIntent): boolean {
  return intent.permAdd.size + intent.permRemove.size + intent.stationAdd.size + intent.stationRemove.size > 0;
}

/** تبديل صلاحية واحدة؛ يعيد النية نفسها إن كان التبديل ممنوعاً (إضافة غير قابلة للتفويض). */
export function togglePermission(base: StaffView, intent: EditIntent, key: string, ctx: EditContext): EditIntent {
  const held = effectivePermissions(base, intent).includes(key);
  const baseHas = base.fuel_permissions.includes(key);
  const add = new Set(intent.permAdd);
  const remove = new Set(intent.permRemove);
  if (held) {
    add.delete(key);
    if (baseHas) remove.add(key);
  } else {
    if (!ctx.delegable.has(key)) return intent; // لا يُمنح ما لا يملك الفاعل تفويضه (الخادم يرفضه أيضاً)
    remove.delete(key);
    if (!baseHas) add.add(key);
  }
  return { ...intent, permAdd: add, permRemove: remove };
}

export type ToggleBlock = 'reserved' | 'not_delegable' | null;

/** لماذا لا يمكن **إضافة** هذه الصلاحية؟ (الإزالة دائماً ممكنة لما يملكه الموظف.) */
export function addBlockReason(key: string, ctx: EditContext): ToggleBlock {
  if (ctx.delegable.has(key)) return null;
  return ctx.reserved.has(key) ? 'reserved' : 'not_delegable';
}

/** تطبيق قالب: الصلاحيات الفعلية تصير مفاتيح القالب فقط (كما يفعل الخادم)، بتفاضل فوق الأساس. */
export function applyTemplatePermissions(base: StaffView, intent: EditIntent, templatePermissions: readonly string[]): EditIntent {
  const wanted = new Set(templatePermissions);
  const have = new Set(base.fuel_permissions);
  return {
    ...intent,
    permAdd: new Set([...wanted].filter((key) => !have.has(key))),
    permRemove: new Set([...have].filter((key) => !wanted.has(key))),
  };
}

/** «كل صلاحيات الوقود القابلة للتفويض»: المفاتيح المسموح بمنحها **عدا المحجوزة** (تُمنح بقرار صريح منفصل). */
export function selectAllDelegable(base: StaffView, intent: EditIntent, ctx: EditContext): EditIntent {
  const add = new Set(intent.permAdd);
  const remove = new Set(intent.permRemove);
  for (const key of ctx.delegable) {
    if (ctx.reserved.has(key)) continue;
    remove.delete(key);
    if (!base.fuel_permissions.includes(key)) add.add(key);
  }
  return { ...intent, permAdd: add, permRemove: remove };
}

export function toggleStation(base: StaffView, intent: EditIntent, id: string): EditIntent {
  const held = effectiveStations(base, intent).includes(id);
  const baseHas = base.station_ids.includes(id);
  const add = new Set(intent.stationAdd);
  const remove = new Set(intent.stationRemove);
  if (held) {
    add.delete(id);
    if (baseHas) remove.add(id);
  } else {
    remove.delete(id);
    if (!baseHas) add.add(id);
  }
  return { ...intent, stationAdd: add, stationRemove: remove };
}

/** حمولة الحفظ = الفرق نفسه الذي يراه المستخدم. محطات: القائمة الجديدة كاملةً (واجهة الخادم استبدالية). */
export function buildUpdateBody(base: StaffView, intent: EditIntent, reason: string): StaffUpdateBody {
  const body: StaffUpdateBody = { expected_revision: base.revision };
  if (intent.permAdd.size > 0) body.add_permissions = [...intent.permAdd].sort();
  if (intent.permRemove.size > 0) body.remove_permissions = [...intent.permRemove].sort();
  if (intent.stationAdd.size + intent.stationRemove.size > 0) body.station_ids = effectiveStations(base, intent);
  const trimmed = reason.trim();
  if (trimmed !== '') body.reason = trimmed.slice(0, 500);
  return body;
}

/** إعادة تطبيق نية المستخدم فوق أساس أحدث (بعد 409): ما صار محققاً بالفعل في الأساس الجديد يسقط، والباقي يبقى. */
export function rebaseIntent(newBase: StaffView, intent: EditIntent): EditIntent {
  const perms = new Set(newBase.fuel_permissions);
  const stations = new Set(newBase.station_ids);
  return {
    permAdd: new Set([...intent.permAdd].filter((key) => !perms.has(key))),
    permRemove: new Set([...intent.permRemove].filter((key) => perms.has(key))),
    stationAdd: new Set([...intent.stationAdd].filter((id) => !stations.has(id))),
    stationRemove: new Set([...intent.stationRemove].filter((id) => stations.has(id))),
  };
}

/** القالب الذي يطابق الصلاحيات الفعلية الآن (للعرض: «قالب مخصّص» إن لم يطابق أحدها). */
export function matchTemplate(templates: TemplatesPayload, permissions: readonly string[]): string {
  const sorted = [...permissions].sort().join('|');
  const hit = templates.templates.find((template) => [...template.permissions].sort().join('|') === sorted);
  if (hit) return hit.key;
  return permissions.length === 0 ? 'none' : 'custom';
}

// ───────────────────────── تجميع الصلاحيات حسب الوظيفة ─────────────────────────

export type PermissionGroupId = 'shifts' | 'sales' | 'receiving' | 'stations' | 'monitoring' | 'customers' | 'governance' | 'other';

export const GROUP_ORDER: readonly PermissionGroupId[] = ['shifts', 'sales', 'receiving', 'stations', 'monitoring', 'customers', 'governance', 'other'];

export function groupOf(key: string): PermissionGroupId {
  if (key.startsWith('fuel.shift.')) return 'shifts';
  if (key.startsWith('fuel.sale.')) return 'sales';
  if (/^fuel\.(delivery|reading|reconciliation|supplier_invoice)\./.test(key)) return 'receiving';
  if (key.startsWith('fuel_stations.')) return 'stations';
  if (/^fuel\.(alerts|reports|maintenance|safety|device|integration)\./.test(key)) return 'monitoring';
  if (/^fuel\.(contract|fleet|card|avi|credit)\./.test(key)) return 'customers';
  if (/^fuel\.(governance|staff)\./.test(key)) return 'governance';
  return 'other';
}

export interface PermissionGroup {
  id: PermissionGroupId;
  keys: string[];
}

export function groupPermissions(keys: readonly string[]): PermissionGroup[] {
  const buckets = new Map<PermissionGroupId, string[]>();
  for (const key of keys) {
    const id = groupOf(key);
    buckets.set(id, [...(buckets.get(id) ?? []), key]);
  }
  return GROUP_ORDER.filter((id) => buckets.has(id)).map((id) => ({ id, keys: (buckets.get(id) as string[]).sort() }));
}
