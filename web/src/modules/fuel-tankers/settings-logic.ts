/**
 * TANKER-PR3 — منطق نقي لسياسات تعبئة صهاريج المتعاملين وقيود عمليات الفوهات (قرارات المالك المعتمدة في PR3_DECISIONS.md).
 * لا شبكة ولا حالة. الخادم هو السلطة (التحقق والحوكمة والتدقيق)؛ هذا الملف يبني الحمولات ويعرض الحالة فقط.
 */
export const TANKER_OPERATIONS = ['direct_sale', 'tanker_fill', 'internal_issue'] as const;
export type TankerOperation = (typeof TANKER_OPERATIONS)[number];

export const VOUCHER_SCOPES = ['station', 'tenant', 'owner', 'none'] as const;
export type VoucherScope = (typeof VOUCHER_SCOPES)[number];

/** `supervisor_approval` غير مبني بعد ويرفضه الخادم، فلا يُعرض. */
export const OVERRUN_POLICIES = ['allow_with_confirmation', 'block', 'allow'] as const;
export type OverrunPolicy = (typeof OVERRUN_POLICIES)[number];

export interface TankerPolicy {
  selectionRequired: boolean;
  voucherScope: VoucherScope;
  overrunPolicy: OverrunPolicy;
}

/** الافتراضات المعتمدة (تطابق `Settings::DEFAULTS`)؛ غياب مفتاح أو قيمة تالفة في الاستجابة ⇒ الافتراضي الآمن لا تخمين. */
export const POLICY_DEFAULTS: TankerPolicy = { selectionRequired: false, voucherScope: 'station', overrunPolicy: 'allow_with_confirmation' };

export const SERVER_KEYS = {
  selectionRequired: 'tanker_selection_required',
  voucherScope: 'tanker_voucher_unique_scope',
  overrunPolicy: 'tanker_capacity_overrun_policy',
} as const;
export type PolicyField = keyof typeof SERVER_KEYS;
export const POLICY_FIELDS = Object.keys(SERVER_KEYS) as PolicyField[];

const oneOf = <T extends string>(list: readonly T[], value: unknown, fallback: T): T => (typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : fallback);

export function readPolicy(raw: unknown): TankerPolicy {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    selectionRequired: source[SERVER_KEYS.selectionRequired] === true,
    voucherScope: oneOf(VOUCHER_SCOPES, source[SERVER_KEYS.voucherScope], POLICY_DEFAULTS.voucherScope),
    overrunPolicy: oneOf(OVERRUN_POLICIES, source[SERVER_KEYS.overrunPolicy], POLICY_DEFAULTS.overrunPolicy),
  };
}

/** اختيار الواجهة لكل سياسة: القيمة نفسها كنص، أو `inherit` (نطاق المحطة فقط: مسح التجاوز والعودة لافتراضي المؤسسة). */
export const INHERIT = 'inherit';
export type PolicyDraft = Record<PolicyField, string>;

export function toDraft(policy: TankerPolicy): PolicyDraft {
  return { selectionRequired: String(policy.selectionRequired), voucherScope: policy.voucherScope, overrunPolicy: policy.overrunPolicy };
}

function typed(field: PolicyField, value: string): boolean | string {
  return field === 'selectionRequired' ? value === 'true' : value;
}

/** المتغيّر فقط (لا طلب عند عدم التغيير). `inherit` ⇒ `null` (مسح تجاوز المحطة) ولا يُرسَل أبداً على مستوى المؤسسة. */
export function policyChanges(current: TankerPolicy, draft: PolicyDraft, stationScope: boolean): Record<string, boolean | string | null> {
  const payload: Record<string, boolean | string | null> = {};
  const now = toDraft(current);
  for (const field of POLICY_FIELDS) {
    const next = draft[field];
    if (next === INHERIT) {
      if (stationScope) payload[SERVER_KEYS[field]] = null;
      continue;
    }
    if (next !== now[field]) payload[SERVER_KEYS[field]] = typed(field, next);
  }
  return payload;
}

/** قيد الفوهة المخزَّن (`null` = كل العمليات) ⇒ العمليات المسموحة فعلاً بالترتيب الكنسي. */
export function effectiveOperations(stored: readonly string[] | null | undefined): TankerOperation[] {
  if (!Array.isArray(stored) || stored.length === 0) return [...TANKER_OPERATIONS];
  return TANKER_OPERATIONS.filter((operation) => stored.includes(operation));
}

/** مدخل الاختيار ⇒ القيمة المُرسلة: المجموعة الكاملة ⇒ `null`؛ فارغ ⇒ `undefined` (غير صالح: لإيقاف فوهة تُعطَّل حالتها). */
export function toStoredOperations(selection: readonly TankerOperation[]): TankerOperation[] | null | undefined {
  const canonical = TANKER_OPERATIONS.filter((operation) => selection.includes(operation));
  if (canonical.length === 0) return undefined;
  return canonical.length === TANKER_OPERATIONS.length ? null : canonical;
}

export const sameOperations = (a: readonly TankerOperation[], b: readonly TankerOperation[]) => a.length === b.length && a.every((operation) => b.includes(operation));

/** هل يزيل التعديل نوعاً كان مسموحاً؟ (التضييق قد يتطلب صلاحية الحوكمة في الخادم إن كانت لمحطتها وردية مفتوحة.) */
export const isNarrowing = (before: readonly TankerOperation[], after: readonly TankerOperation[]) => before.some((operation) => !after.includes(operation));
