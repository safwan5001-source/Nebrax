/**
 * AC-UX-08 — ملخّص وصول المستخدم من **الإسنادات المصدرية فقط** (دوال نقية).
 *
 * لا يُحسب هنا «وصول فعلي»: لا تقاطع صلاحيات مع وحدات، ولا قواعد خزائن، ولا قيود مستندات. يُعرض ما
 * أُسنِد فعلاً (حالة الدخول، الدور، الفروع، المستودعات، الموظف المرتبط) وما يمكن قراءته من الدور
 * (عدد صلاحياته) حين يملك المشاهد `roles.view`. الفراغ المخزَّن في النطاق يعني **«الكل»** لا «لا شيء».
 * الخادم هو السلطة في كل طلب؛ هذا عرضٌ للقراءة.
 */

import { sensitiveKeys } from '@/modules/roles/risk';
import { resolveRoleLabel, type RoleLabel, type RoleSummary, type ScopeOption, type UserRecord } from './model';

export type ScopeDetail =
  | { kind: 'all' }
  /** أسماء ما أمكن حلّه؛ `hidden` معرّفات غير ظاهرة للمشاهد (خارج ما تعيده القائمة له). */
  | { kind: 'names'; names: string[]; hidden: number }
  /** القائمة غير متاحة للمشاهد: العدد فقط، بلا اختلاق أسماء. */
  | { kind: 'count'; count: number };

export function scopeDetail(ids: string[] | undefined, options: ScopeOption[] | null, locale?: string): ScopeDetail {
  const stored = ids ?? [];
  if (stored.length === 0) return { kind: 'all' };
  if (!options) return { kind: 'count', count: stored.length };
  const byId = new Map(options.map((option) => [option.id, option.name]));
  const names = stored.map((id) => byId.get(id)).filter((name): name is string => typeof name === 'string');
  names.sort((a, b) => a.localeCompare(b, locale));
  return { kind: 'names', names, hidden: stored.length - names.length };
}

export type RoleKind = 'owner' | 'system' | 'custom';

export type RoleAccess =
  | { kind: 'full' }
  | { kind: 'count'; count: number; sensitive: number };

export interface RoleDetail {
  label: RoleLabel;
  /** `null` = غير معروف (قائمة الأدوار غير متاحة للمشاهد وليس الدور نظامياً معروفاً). */
  kind: RoleKind | null;
  /** `null` = لا قائمة أدوار (لا `roles.view`) فلا نعرف الصلاحيات. */
  access: RoleAccess | null;
}

export function roleDetail(slug: string, roles: RoleSummary[] | null, systemNames: Record<string, string>): RoleDetail {
  const label = resolveRoleLabel(slug, roles, systemNames);
  const fetched = roles?.find((role) => role.slug === slug);
  if (!fetched) {
    return { label, kind: Object.prototype.hasOwnProperty.call(systemNames, slug) ? 'system' : null, access: null };
  }
  const kind: RoleKind = fetched.is_owner ? 'owner' : fetched.is_system ? 'system' : 'custom';
  const permissions = fetched.permissions;
  if (!permissions) return { label, kind, access: null };
  if (permissions.includes('*')) return { label, kind, access: { kind: 'full' } };
  return { label, kind, access: { kind: 'count', count: permissions.length, sensitive: sensitiveKeys(permissions).length } };
}

export interface UserAccessSummary {
  signIn: 'allowed' | 'blocked';
  role: RoleDetail;
  branches: ScopeDetail;
  warehouses: ScopeDetail;
  employee: { id: string; label: string } | null;
}

export interface SummaryLookups {
  roles: RoleSummary[] | null;
  branches: ScopeOption[] | null;
  warehouses: ScopeOption[] | null;
  systemNames: Record<string, string>;
  locale?: string;
}

export function buildAccessSummary(user: UserRecord, lookups: SummaryLookups): UserAccessSummary {
  const employee = user.employee
    ? { id: user.employee.id, label: `${user.employee.employee_no ? `${user.employee.employee_no} — ` : ''}${user.employee.name}` }
    : null;
  return {
    signIn: user.is_active ? 'allowed' : 'blocked',
    role: roleDetail(user.role, lookups.roles, lookups.systemNames),
    branches: scopeDetail(user.branch_ids, lookups.branches, lookups.locale),
    warehouses: scopeDetail(user.warehouse_ids, lookups.warehouses, lookups.locale),
    employee,
  };
}
