/**
 * AC-UX-03A — كتالوج الصلاحيات للعرض (دوال نقية).
 *
 * **المفتاح الكنسي بيانات تخويل غير شفّافة**: يُحلَّل هنا للعرض والتجميع فقط، ولا يُعاد بناؤه
 * من مقاطعه أبداً. القيمة الأصلية من `meta.permissions` هي وحدها ما يُقارَن به أو يُعرض
 * (الفعل الحقيقي دائماً آخر مقطع؛ والمقاطع الوسيطة «مجال» تُفرّق صلاحيات تشترك الفعل).
 */

export interface RoleRecord {
  id: string;
  slug: string;
  name: string;
  /** `["*"]` = وصول كامل. */
  permissions: string[];
  is_system: boolean;
  is_owner: boolean;
  users_count: number;
}

export interface PermissionEntry {
  /** المفتاح الكنسي كما جاء من الكتالوج — لا يُعدَّل. */
  key: string;
  module: string;
  /** المقاطع الوسيطة (قد تكون فارغة). */
  areas: string[];
  action: string;
}

export interface PermissionGroup {
  module: string;
  entries: PermissionEntry[];
}

export function parsePermission(key: string): PermissionEntry {
  const parts = key.split('.');
  return { key, module: parts[0], areas: parts.slice(1, -1), action: parts[parts.length - 1] };
}

const ACTION_PRIORITY: Record<string, number> = { view: 0, manage: 1 };

/** تجميع الكتالوج حسب الوحدة بترتيب ظهورها الأول؛ داخل الوحدة: العرض ثم الإدارة ثم الباقي أبجدياً. */
export function groupCatalog(catalog: string[]): PermissionGroup[] {
  const map = new Map<string, PermissionEntry[]>();
  for (const key of catalog) {
    const entry = parsePermission(key);
    const list = map.get(entry.module);
    if (list) list.push(entry);
    else map.set(entry.module, [entry]);
  }
  return [...map.entries()].map(([module, entries]) => ({
    module,
    entries: entries.sort((a, b) => {
      const weight = (ACTION_PRIORITY[a.action] ?? 2) - (ACTION_PRIORITY[b.action] ?? 2);
      return weight !== 0 ? weight : a.key.localeCompare(b.key);
    }),
  }));
}

/** الصلاحيات الممنوحة فعلاً ضمن الكتالوج؛ `*` تعني كل شيء. مفاتيح خارج الكتالوج لا تُحسب. */
export function grantedKeys(role: Pick<RoleRecord, 'permissions'>, catalog: string[]): Set<string> {
  if (role.permissions.includes('*')) return new Set(catalog);
  const inCatalog = new Set(catalog);
  return new Set(role.permissions.filter((key) => inCatalog.has(key)));
}

export interface RoleCounts {
  granted: number;
  total: number;
  full: boolean;
}

export function roleCounts(role: Pick<RoleRecord, 'permissions'>, catalog: string[]): RoleCounts {
  return {
    granted: grantedKeys(role, catalog).size,
    total: catalog.length,
    full: role.permissions.includes('*'),
  };
}

export interface CatalogLabels {
  modules: Record<string, string>;
  actions: Record<string, string>;
  areas: Record<string, string>;
}

/** تنسيق آمن لمقطعٍ غير مترجَم: snake_case → عرض مقروء. عرضٌ فقط. */
export function humanizeSegment(segment: string): string {
  return segment
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function moduleLabel(module: string, labels: CatalogLabels): string {
  return labels.modules[module] ?? humanizeSegment(module);
}

/** تسمية الصلاحية: «المجال — الفعل»، والفعل وحده حين لا مجال وسيط. */
export function permissionLabel(entry: PermissionEntry, labels: CatalogLabels): string {
  const action = labels.actions[entry.action] ?? humanizeSegment(entry.action);
  if (entry.areas.length === 0) return action;
  const areas = entry.areas.map((area) => labels.areas[area] ?? humanizeSegment(area)).join(' · ');
  return `${areas} — ${action}`;
}

export interface CatalogFilter {
  query: string;
  /** عرض الممنوح فقط. */
  grantedOnly: boolean;
}

/**
 * تصفية المجموعات: البحث في اسم الوحدة والتسمية والمفتاح الكنسي (للمستخدم الذي يعرف المفتاح)،
 * و«الممنوح فقط». الوحدة المطابقة باسمها تُعرض كاملةً (فلا يضيع سياقها).
 */
export function filterCatalog(
  groups: PermissionGroup[],
  filter: CatalogFilter,
  granted: Set<string>,
  labels: CatalogLabels,
): PermissionGroup[] {
  const needle = filter.query.trim().toLocaleLowerCase();
  return groups
    .map((group) => {
      const moduleMatches = needle !== '' && moduleLabel(group.module, labels).toLocaleLowerCase().includes(needle);
      const entries = group.entries.filter((entry) => {
        if (filter.grantedOnly && !granted.has(entry.key)) return false;
        if (needle === '' || moduleMatches) return true;
        return (
          permissionLabel(entry, labels).toLocaleLowerCase().includes(needle)
          || entry.key.toLocaleLowerCase().includes(needle)
        );
      });
      return { ...group, entries };
    })
    .filter((group) => group.entries.length > 0);
}

/** تصفية الأدوار في الشريط الجانبي بالاسم. */
export function filterRoles<T extends Pick<RoleRecord, 'name'>>(roles: T[], query: string): T[] {
  const needle = query.trim().toLocaleLowerCase();
  return needle === '' ? roles : roles.filter((role) => role.name.toLocaleLowerCase().includes(needle));
}
