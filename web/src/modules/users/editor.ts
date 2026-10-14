/**
 * AC-UX-02 — نموذج محرّر المستخدم (دوال نقية).
 *
 * العقد الحاكم: **الفراغ المخزَّن = غير مقيَّد (الكل)**. لذلك يُمثَّل النطاق في الواجهة
 * بوضعين صريحين — «الكل» / «محدَّد» — ولا تُرسَل أبداً قائمةٌ فارغة تحت وضع «محدَّد»:
 * لا وجود لحالة «لا شيء» في الخادم، والواجهة لا تدّعي وجودها (أيّ طلب لها = توقف
 * وقرار مالك، لا تخمين).
 */

export type ScopeMode = 'all' | 'selected';

export interface ScopeDraft {
  mode: ScopeMode;
  /** المعرّفات المحدَّدة. تبقى محفوظةً عند التبديل إلى «الكل» كي لا يضيع الاختيار بنقرة. */
  ids: string[];
}

/** من القيمة المخزَّنة: فراغ ⇒ «الكل»؛ وإلا «محدَّد» بنفس المعرّفات (بما فيها غير الظاهرة للمشاهد). */
export function scopeDraftFromStored(ids: string[] | undefined): ScopeDraft {
  const stored = ids ?? [];
  return stored.length === 0 ? { mode: 'all', ids: [] } : { mode: 'selected', ids: [...stored] };
}

/** الحمولة الفعلية لبُعدٍ واحد. «الكل» ⇒ `[]` (إلغاء التقييد)؛ «محدَّد» ⇒ المعرّفات كما هي. */
export function scopeToPayload(draft: ScopeDraft): string[] {
  return draft.mode === 'all' ? [] : [...draft.ids];
}

export type ScopeIssue = 'selected_empty' | 'all_not_allowed';

/**
 * أخطاء الحفظ لبُعدٍ واحد:
 * - «محدَّد» بلا اختيار ⇒ ممنوع (كان سيُسلَّم `[]` أي «الكل» فيُفهم خطأً أنه «لا شيء»).
 * - فاعلٌ مقيَّد بهذا البُعد لا يختار «الكل» (الخادم يرفضه — سقف المنح AC-UX-00A).
 */
export function scopeIssue(draft: ScopeDraft, actorRestricted: boolean): ScopeIssue | null {
  if (draft.mode === 'all') return actorRestricted ? 'all_not_allowed' : null;
  return draft.ids.length === 0 ? 'selected_empty' : null;
}

export function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

export function scopeChanged(initial: ScopeDraft, current: ScopeDraft): boolean {
  return scopeToPayload(initial).length !== scopeToPayload(current).length
    || !sameIds(scopeToPayload(initial), scopeToPayload(current));
}

/** معرّفات مخزَّنة لا يراها المشاهد (قائمته مقصورة على نطاقه): تبقى كما هي ويُنبَّه إليها. */
export function hiddenIds(ids: string[], visible: { id: string }[] | null): number {
  if (!visible) return 0;
  const seen = new Set(visible.map((option) => option.id));
  return ids.filter((id) => !seen.has(id)).length;
}

/** تبديل معرّف مع إبقاء غير الظاهرة (لا تُمحى بنقرة على ما يراه المشاهد). */
export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

export interface EditorForm {
  name: string;
  email: string;
  password: string;
  sendInvitation: boolean;
  role: string;
  employeeId: string;
  isActive: boolean;
  branches: ScopeDraft;
  warehouses: ScopeDraft;
}

export interface EditorCapabilities {
  /** `roles.view` — بدونه الدور للقراءة فقط ولا يُرسَل. */
  role: boolean;
  /** `hr.view` — بدونه ربط الموظف مخفي ولا يُرسَل. */
  employee: boolean;
  /** `branches.view` / `products.view` — بدونها البُعد للقراءة فقط ولا يُرسَل. */
  branches: boolean;
  warehouses: boolean;
}

/**
 * حمولة التعديل: **الحقول المتغيّرة وحدها**. غياب المفتاح = «بلا تغيير» في الخادم، فلا
 * يُعاد إرسال نطاقٍ أو دورٍ لم يلمسه المستخدم (فلا مجال لـ`[]` عرَضيّة ولا لرفضٍ لا صلة له).
 */
export function diffPayload(
  initial: EditorForm,
  current: EditorForm,
  caps: EditorCapabilities,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (current.name !== initial.name) body.name = current.name;
  if (current.isActive !== initial.isActive) body.is_active = current.isActive;
  if (current.password) body.password = current.password;
  if (caps.role && current.role !== initial.role) body.role = current.role;
  if (caps.employee && current.employeeId !== initial.employeeId) body.employee_id = current.employeeId || null;
  if (caps.branches && scopeChanged(initial.branches, current.branches)) body.branch_ids = scopeToPayload(current.branches);
  if (caps.warehouses && scopeChanged(initial.warehouses, current.warehouses)) body.warehouse_ids = scopeToPayload(current.warehouses);
  return body;
}

/** حمولة الإنشاء. النطاق «الكل» يُحذف مفتاحه (= غير مقيَّد)، و«محدَّد» يُرسَل غير فارغ دائماً. */
export function createPayload(current: EditorForm, caps: EditorCapabilities): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: current.name,
    email: current.email,
    role: current.role,
    is_active: true,
    send_invitation: current.sendInvitation,
  };
  if (!current.sendInvitation) body.password = current.password;
  if (caps.employee && current.employeeId) body.employee_id = current.employeeId;
  if (caps.branches && current.branches.mode === 'selected') body.branch_ids = scopeToPayload(current.branches);
  if (caps.warehouses && current.warehouses.mode === 'selected') body.warehouse_ids = scopeToPayload(current.warehouses);
  return body;
}

export function isDirty(initial: EditorForm, current: EditorForm): boolean {
  return (
    current.name !== initial.name
    || current.email !== initial.email
    || current.password !== ''
    || current.sendInvitation !== initial.sendInvitation
    || current.role !== initial.role
    || current.employeeId !== initial.employeeId
    || current.isActive !== initial.isActive
    || scopeChanged(initial.branches, current.branches)
    || scopeChanged(initial.warehouses, current.warehouses)
  );
}

export type ScopeSummaryText =
  | { kind: 'all' }
  | { kind: 'selected'; count: number };

/** ملخّص الوصول قبل الحفظ — من الإسنادات المصدرية وحدها، بلا حساب صلاحيات في الواجهة. */
export function accessSummary(form: EditorForm): { branches: ScopeSummaryText; warehouses: ScopeSummaryText } {
  const of = (draft: ScopeDraft): ScopeSummaryText =>
    draft.mode === 'all' ? { kind: 'all' } : { kind: 'selected', count: draft.ids.length };
  return { branches: of(form.branches), warehouses: of(form.warehouses) };
}
