import { resolveRoleLabel, type RoleSummary } from '@/modules/users/model';

/**
 * AC-UX-06 — مقروئية صلاحيات الإيداع/السحب على الخزينة والحساب البنكي (دوال نقية).
 *
 * العقد (الخادم هو الحاسم — `CashBankAccount::allows`): لكل اتجاه نطاقٌ `all | role | user | branch`
 * ومرجعٌ واحد (slug الدور / معرّف المستخدم / معرّف الفرع). تُفحص القاعدة **فوق** صلاحيات الدور، و**بلا استثناءٍ
 * للمالك أو المدير**. نطاق `branch` يُقارَن بفرع العملية النشط وقت التنفيذ، لا بفرع المستخدم.
 * هنا نُظهر المرجع بالاسم (لا بمعرّفٍ خام) ونمنع حفظ نطاقٍ بلا مرجع؛ ولا يُستنتج شيءٌ من التخويل.
 */

export type PermissionScope = 'all' | 'role' | 'user' | 'branch';
export type SubjectScope = Exclude<PermissionScope, 'all'>;
export type TreasuryAction = 'deposit' | 'withdraw';

export interface AccessLookups {
  /** `null` = لا يملك المشاهد صلاحية عرض القائمة (أو لم تُحمَّل بعد). */
  roles: RoleSummary[] | null;
  users: { id: string; name: string; email?: string }[] | null;
  branches: { id: string; name: string }[] | null;
}

export interface SubjectOption {
  value: string;
  label: string;
}

const LOOKUP_KEY: Record<SubjectScope, keyof AccessLookups> = { role: 'roles', user: 'users', branch: 'branches' };

/** هل تتوفر قائمة اختيار المرجع لهذا النطاق؟ */
export function lookupAvailable(scope: PermissionScope, lookups: AccessLookups): boolean {
  return scope === 'all' ? true : lookups[LOOKUP_KEY[scope]] !== null;
}

export function subjectOptions(
  scope: PermissionScope,
  lookups: AccessLookups,
  systemRoleNames: Record<string, string>,
): SubjectOption[] {
  if (scope === 'role') {
    return (lookups.roles ?? []).map((role) => {
      const label = resolveRoleLabel(role.slug, lookups.roles, systemRoleNames);
      return { value: role.slug, label: label.kind === 'name' ? label.name : role.name };
    });
  }
  if (scope === 'user') {
    return (lookups.users ?? []).map((user) => ({ value: user.id, label: user.email ? `${user.name} — ${user.email}` : user.name }));
  }
  if (scope === 'branch') return (lookups.branches ?? []).map((branch) => ({ value: branch.id, label: branch.name }));
  return [];
}

export type AccessDescription =
  | { kind: 'all' }
  /** `label === null` = المرجع محفوظ لكن لا يمكن حلّ اسمه (لا صلاحية عرض القائمة أو لم يعد موجوداً) — لا يُعرض معرّفٌ خام. */
  | { kind: SubjectScope; label: string | null };

export function describeAccess(
  scope: PermissionScope,
  subject: string | null | undefined,
  lookups: AccessLookups,
  systemRoleNames: Record<string, string>,
): AccessDescription {
  if (scope === 'all') return { kind: 'all' };
  const value = subject ?? '';
  if (value === '') return { kind: scope, label: null };
  if (scope === 'role') {
    // الأدوار النظامية لها اسمٌ معروف حتى بلا صلاحية عرض القائمة؛ المخصَّصة تحتاج القائمة.
    const known = Object.prototype.hasOwnProperty.call(systemRoleNames, value) || lookups.roles?.some((role) => role.slug === value);
    if (!known) return { kind: 'role', label: null };
    const label = resolveRoleLabel(value, lookups.roles, systemRoleNames);
    return { kind: 'role', label: label.kind === 'name' ? label.name : null };
  }
  if (scope === 'user') {
    const user = lookups.users?.find((candidate) => candidate.id === value);
    // الجملة تعزل البريد (FSI…PDI): بريدٌ لاتيني في آخر جملةٍ عربية يُفلت نقطتها إلى أول السطر بلا عزل.
    return { kind: 'user', label: user ? (user.email ? `${user.name} \u2068(${user.email})\u2069` : user.name) : null };
  }
  const option = subjectOptions(scope, lookups, systemRoleNames).find((candidate) => candidate.value === value);
  return { kind: scope, label: option ? option.label : null };
}

/** تغيير النطاق يُفرغ المرجع: مرجع دورٍ تحت نطاق «مستخدم» كان سيُرسَل قيمةً لا معنى لها فيرفضها الخادم. */
export function changeScope(next: PermissionScope): { scope: PermissionScope; subject: string } {
  return { scope: next, subject: '' };
}

/** نطاقٌ غير «الكل» بلا مرجع ممنوع الحفظ. */
export function subjectMissing(scope: PermissionScope, subject: string): boolean {
  return scope !== 'all' && subject.trim() === '';
}

/** المرجع كما يُرسَل: «الكل» ⇒ `null`. */
export function payloadSubject(scope: PermissionScope, subject: string): string | null {
  return scope === 'all' ? null : subject.trim() === '' ? null : subject;
}

export interface Actor {
  id: string | null;
  role: string | null;
}

/**
 * هل تستثني القاعدة المشاهد نفسه؟ — تحذيرٌ من القفل الذاتي (لا استثناء للمالك/المدير في الخادم).
 * `null` = لا يُعرف (نطاق الفرع يُقارَن بفرع العملية النشط وقت التنفيذ، وهو غير معروف هنا).
 */
export function excludesActor(scope: PermissionScope, subject: string, actor: Actor): boolean | null {
  if (scope === 'all' || subject === '') return false;
  if (scope === 'role') return actor.role !== null ? actor.role !== subject : null;
  if (scope === 'user') return actor.id !== null ? actor.id !== subject : null;
  return null;
}
