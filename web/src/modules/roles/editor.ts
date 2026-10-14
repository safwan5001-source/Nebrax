import { type PermissionGroup, type RoleRecord, grantedKeys } from './catalog';

/**
 * AC-UX-03B — نموذج محرّر الدور (دوال نقية).
 *
 * **المفتاح الكنسي بيانات تخويل غير شفّافة**: ما يُخزَّن في الاختيار وما يُرسَل هو المفتاح الحرفي من
 * `meta.permissions`؛ التجميع والتسميات والحساسية اشتقاقات عرضٍ فقط. الحمولة تُبنى من مفاتيح الكتالوج
 * وحدها (ترتيب الكتالوج)، فلا يخرج منها مفتاحٌ مُعاد بناؤه أو اقتُطع.
 */

/** الاختيار الابتدائي: الوصول الكامل `*` يُعرض بكل الكتالوج مختاراً (الحفظ يقصره على الصريح). */
export function initialSelection(role: Pick<RoleRecord, 'permissions'> | null, catalog: string[]): Set<string> {
  return role ? grantedKeys(role, catalog) : new Set();
}

export function toggleKey(selected: Set<string>, key: string): Set<string> {
  const next = new Set(selected);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export type GroupState = 'none' | 'some' | 'all';

export function groupState(selected: Set<string>, keys: string[]): GroupState {
  if (keys.length === 0) return 'none';
  const count = keys.filter((key) => selected.has(key)).length;
  return count === 0 ? 'none' : count === keys.length ? 'all' : 'some';
}

/** تحديد/إلغاء مفاتيح مجموعة؛ `only` تحصر الأثر في المسموح للفاعل منحه (سقف المنح — عرضٌ لا أمان). */
export function setKeys(selected: Set<string>, keys: string[], on: boolean, only?: (key: string) => boolean): Set<string> {
  const next = new Set(selected);
  for (const key of keys) {
    if (only && !only(key)) continue;
    if (on) next.add(key);
    else next.delete(key);
  }
  return next;
}

/** الصلاحيات المختارة بترتيب الكتالوج (حتمي) ومن الكتالوج وحده. */
export function selectedInCatalogOrder(selected: Set<string>, catalog: string[]): string[] {
  return catalog.filter((key) => selected.has(key));
}

export function rolePayload(name: string, selected: Set<string>, catalog: string[]): { name: string; permissions: string[] } {
  return { name: name.trim(), permissions: selectedInCatalogOrder(selected, catalog) };
}

export function sameSelection(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a) if (!b.has(key)) return false;
  return true;
}

export function isDirty(
  initialName: string,
  initial: Set<string>,
  name: string,
  selected: Set<string>,
): boolean {
  return name.trim() !== initialName.trim() || !sameSelection(initial, selected);
}

export type RoleIssue = 'name_required' | 'permissions_required';

/** قواعد الحفظ: اسمٌ غير فارغ وصلاحيةٌ واحدة على الأقل (دورٌ بلا صلاحيات لا قيمة له ويُربك المُسنِد). */
export function roleIssue(name: string, selected: Set<string>): RoleIssue | null {
  if (name.trim() === '') return 'name_required';
  if (selected.size === 0) return 'permissions_required';
  return null;
}

export interface SelectionDiff {
  added: string[];
  removed: string[];
}

export function diffSelection(initial: Set<string>, selected: Set<string>, catalog: string[]): SelectionDiff {
  return {
    added: catalog.filter((key) => selected.has(key) && !initial.has(key)),
    removed: catalog.filter((key) => !selected.has(key) && initial.has(key)),
  };
}

/** هل يملك الفاعل هذه الصلاحية ليمنحها؟ (مرآة عرضٍ لسقف المنح؛ الخادم هو الحاسم.) */
export function canGrantKey(actorPermissions: string[], key: string): boolean {
  return actorPermissions.includes('*') || actorPermissions.includes(key);
}

export function visibleKeys(groups: PermissionGroup[]): string[] {
  return groups.flatMap((group) => group.entries.map((entry) => entry.key));
}
