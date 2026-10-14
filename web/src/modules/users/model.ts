/**
 * AC-UX-01 — نموذج عرض المستخدمين (دوال نقية).
 *
 * لا يُحسب هنا أي قرار أمني: الخادم هو السلطة (`UserController` + `EnsurePermission`
 * + حدود المنح AC-UX-00A). هذه الدوال تقرّر فقط **ما نعرضه ونعرضه معطَّلاً بسبب** لئلا
 * تُعرض أزرارٌ يردّها الخادم بـ403 — والرفض الفعلي يصل دائماً كرسالة الخادم.
 */

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  /** slug الدور — لا اسمه. الاسم يأتي من `GET /roles` لمن يملك `roles.view` فقط. */
  role: string;
  is_active: boolean;
  employee_id?: string | null;
  /** **الفراغ يعني «الكل»** (غير مقيَّد) لا «لا شيء». */
  branch_ids?: string[];
  warehouse_ids?: string[];
  employee?: { id: string; name: string; employee_no?: string } | null;
}

export interface RoleSummary {
  id: string;
  slug: string;
  name: string;
  is_owner: boolean;
  is_system: boolean;
  /** `["*"]` = وصول كامل. يُستعمل لعرض ما يقبله الخادم فقط (سقف المنح) — لا لإصدار قرار. */
  permissions?: string[];
}

/**
 * مرآة `Rbac::covers` (سقف المنح AC-UX-00A): صلاحيات `holder` تغطّي كل `wanted`؟
 * حاملُ `*` يغطّي كل شيء؛ وغيره لا يغطّي `*` ولا مفتاحاً خارج ما يملكه. **عرضٌ لا أمان** —
 * الخادم هو الذي يرفض (403)؛ هذه الدالة تمنع فقط عرض خياراتٍ يُعرف سلفاً أنها سترفض.
 */
export function coversPermissions(holder: string[], wanted: string[]): boolean {
  if (holder.includes('*')) return true;
  return !wanted.includes('*') && wanted.every((permission) => holder.includes(permission));
}

/** صلاحيات المشاهد الفعلية؛ غياب القائمة (تخزين قديم) يسقط إلى owner/admin = `*` كما في `hasPermission`. */
export function effectivePermissions(permissions: string[] | undefined, role: string | null | undefined): string[] {
  if (permissions !== undefined) return permissions;
  return role === 'owner' || role === 'admin' ? ['*'] : [];
}

export interface ScopeOption {
  id: string;
  name: string;
  code?: string;
}

export type ScopeSummary =
  | { kind: 'all' }
  | { kind: 'names'; first: string; more: number }
  | { kind: 'count'; count: number };

/**
 * ملخّص نطاق مخزَّن. الفراغ = «الكل» (دلالة الخادم القديمة المحفوظة).
 * حين لا تتوفر الأسماء (لا صلاحية عرض القائمة، أو المعرّف خارج ما يراه المشاهد) يسقط
 * إلى العدد بدل اختلاق اسم.
 */
export function summarizeScope(ids: string[] | undefined, options: ScopeOption[] | null): ScopeSummary {
  const stored = ids ?? [];
  if (stored.length === 0) return { kind: 'all' };
  if (options) {
    const byId = new Map(options.map((option) => [option.id, option.name]));
    const names = stored.map((id) => byId.get(id));
    if (names.every((name): name is string => typeof name === 'string')) {
      return { kind: 'names', first: names[0], more: names.length - 1 };
    }
  }
  return { kind: 'count', count: stored.length };
}

export type RoleLabel = { kind: 'name'; name: string } | { kind: 'custom' };

/**
 * اسم الدور (D-H): 1) الاسم المجلوب من `/roles` حين يملك المشاهد `roles.view` (مرجعٌ
 * حاسم — الأدوار النظامية قابلة لإعادة التسمية)؛ 2) ترجمة slug الأدوار النظامية؛
 * 3) «دور مخصَّص». لا يُعرض slug خام (`role-ab12cd34`) اسماً أبداً.
 */
export function resolveRoleLabel(
  slug: string,
  roles: RoleSummary[] | null,
  systemNames: Record<string, string>,
): RoleLabel {
  const fetched = roles?.find((role) => role.slug === slug);
  if (fetched) return { kind: 'name', name: fetched.name };
  if (Object.prototype.hasOwnProperty.call(systemNames, slug)) return { kind: 'name', name: systemNames[slug] };
  return { kind: 'custom' };
}

export type UserStatusFilter = 'active' | 'inactive' | '';
export type UserScopeFilter = 'all' | 'restricted' | '';

export interface UserListQuery {
  search: string;
  status: UserStatusFilter;
  role: string;
  scope: UserScopeFilter;
}

function isRestricted(user: UserRecord): boolean {
  return (user.branch_ids?.length ?? 0) > 0 || (user.warehouse_ids?.length ?? 0) > 0;
}

export function filterUsers(users: UserRecord[], query: UserListQuery): UserRecord[] {
  const needle = query.search.trim().toLocaleLowerCase();
  return users.filter((user) => {
    if (needle) {
      const haystack = [user.name, user.email, user.employee?.name, user.employee?.employee_no]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    if (query.status === 'active' && !user.is_active) return false;
    if (query.status === 'inactive' && user.is_active) return false;
    if (query.role && user.role !== query.role) return false;
    if (query.scope === 'all' && isRestricted(user)) return false;
    if (query.scope === 'restricted' && !isRestricted(user)) return false;
    return true;
  });
}

/** `newest` يُبقي ترتيب الخادم (الأحدث أولاً)؛ `name`/`-name` ترتيب أبجدي. */
export function sortUsers(users: UserRecord[], sort: string, locale: string): UserRecord[] {
  if (sort !== 'name' && sort !== '-name') return users;
  const direction = sort === '-name' ? -1 : 1;
  return [...users].sort((a, b) => direction * a.name.localeCompare(b.name, locale, { sensitivity: 'base' }));
}

export type DisabledReason = 'owner_protected' | 'role_above_you' | 'scope_wider' | 'self_delete' | 'self_deactivate' | 'no_email';

export interface Capability {
  allowed: boolean;
  reason?: DisabledReason;
}

export interface RowCapabilities {
  edit: Capability;
  scope: Capability;
  invite: Capability;
  toggle: Capability;
  remove: Capability;
}

export interface RowActor {
  id: string | null;
  role: string | null;
  canManage: boolean;
  /** صلاحيات المشاهد الفعلية (`["*"]` للمالك/المدير). غيابها = لا تقييم بالدور. */
  permissions?: string[];
  /** نطاق المشاهد المخزَّن (من صفّه في القائمة): فراغ = غير مقيَّد. غيابه = لا تقييم بالنطاق. */
  scope?: { branches: string[]; warehouses: string[] };
}

/**
 * قدرات الصف بحسب المشاهد. `canManage=false` ⇒ لا أيٌّ منها (الشاشة تُخفي الضوابط).
 * الأسباب تعكس حراسات الخادم القائمة — `guardOwnerRole`، سقف المنح على الهدف
 * (`guardGrantBoundary`: دوره فوق سقف المشاهد، أو نطاقه أوسع من نطاق مشاهدٍ مقيَّد)،
 * منع حذف النفس — وسياسة تجنّب القفل الذاتي. **عرضٌ لا أمان**: حين تنقص المعطيات
 * (لا `roles.view` مثلاً) لا نعطّل بالتخمين؛ الخادم يرفض برسالةٍ مقروءة.
 */
export function rowCapabilities(
  actor: RowActor,
  target: UserRecord,
  roles: RoleSummary[] | null = null,
): RowCapabilities {
  const none: Capability = { allowed: false };
  if (!actor.canManage) return { edit: none, scope: none, invite: none, toggle: none, remove: none };

  const isSelf = actor.id !== null && actor.id === target.id;

  if (target.role === 'owner' && actor.role !== 'owner') {
    const blocked: Capability = { allowed: false, reason: 'owner_protected' };
    return { edit: blocked, scope: blocked, invite: blocked, toggle: blocked, remove: blocked };
  }

  const hasEmail = target.email.trim() !== '';
  const invite: Capability = hasEmail ? { allowed: true } : { allowed: false, reason: 'no_email' };

  // سقف الهدف (غير الذات): الخادم يرفض تعديل/حذف من دوره فوق سقف الفاعل أو نطاقه أوسع.
  let ceiling: DisabledReason | undefined;
  if (!isSelf) {
    const targetRole = roles?.find((role) => role.slug === target.role);
    if (actor.permissions && targetRole?.permissions && !coversPermissions(actor.permissions, targetRole.permissions)) {
      ceiling = 'role_above_you';
    } else if (actor.scope) {
      const dims: [string[], string[] | undefined][] = [
        [actor.scope.branches, target.branch_ids],
        [actor.scope.warehouses, target.warehouse_ids],
      ];
      for (const [mine, theirs] of dims) {
        const restricted = mine.length > 0;
        const targetIds = theirs ?? [];
        if (restricted && (targetIds.length === 0 || targetIds.some((id) => !mine.includes(id)))) {
          ceiling = 'scope_wider';
          break;
        }
      }
    }
  }
  if (ceiling) {
    const blocked: Capability = { allowed: false, reason: ceiling };
    return { edit: blocked, scope: blocked, invite, toggle: blocked, remove: blocked };
  }

  return {
    edit: { allowed: true },
    scope: { allowed: true },
    invite,
    toggle: isSelf ? { allowed: false, reason: 'self_deactivate' } : { allowed: true },
    remove: isSelf ? { allowed: false, reason: 'self_delete' } : { allowed: true },
  };
}
