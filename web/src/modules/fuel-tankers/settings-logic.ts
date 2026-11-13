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

/** TANKER-PR5: مرفقات سند التعبئة. الأنواع: السقف الصلب PDF/JPG/PNG والإعداد يضيّق فقط. */
export const ATTACHMENT_TYPES = ['images_and_pdf', 'images_only'] as const;
export type AttachmentTypes = (typeof ATTACHMENT_TYPES)[number];
/** إلزام صورة السند (قرار المالك D-T2): `never` الافتراضي؛ المرحلتان تُعلنان «ناقص» فقط ولا إنفاذ بعد. */
export const ATTACHMENT_REQUIRED = ['never', 'before_shift_approval', 'before_settlement'] as const;
export type AttachmentRequired = (typeof ATTACHMENT_REQUIRED)[number];
export const ATTACHMENT_AFTER_CLOSE = ['allow', 'deny'] as const;
export type AttachmentAfterClose = (typeof ATTACHMENT_AFTER_CLOSE)[number];
export const ATTACHMENT_REMOVAL = ['open_shift_only', 'always', 'never'] as const;
export type AttachmentRemoval = (typeof ATTACHMENT_REMOVAL)[number];
/** TANKER-PR6A: مراجعة السندات المعلّقة قبل الدمج المخزني (تخزين وعرض فقط — **لا خصم ولا ترحيل**). لا خيار «سماح بالسالب» ولا «تسوية صامتة». */
export const INVENTORY_POLICIES = ['block', 'hold_for_review'] as const;
export type InventoryPolicy = (typeof INVENTORY_POLICIES)[number];
export const INVENTORY_REVIEW_HOURS_MAX = 720;

/** السقوف الصلبة في الخادم (الحجم بالميغابايت، عدد المرفقات للسند). */
export const ATTACHMENT_HARD_MAX_MB = 10;
export const ATTACHMENT_HARD_MAX_COUNT = 20;

export interface TankerPolicy {
  selectionRequired: boolean;
  voucherScope: VoucherScope;
  overrunPolicy: OverrunPolicy;
  attachmentRequired: AttachmentRequired;
  attachmentTypes: AttachmentTypes;
  attachmentMaxMb: number;
  attachmentMaxCount: number;
  attachmentAfterClose: AttachmentAfterClose;
  attachmentRemoval: AttachmentRemoval;
  inventoryPolicy: InventoryPolicy;
  inventoryReviewHours: number;
}

/** الافتراضات المعتمدة (تطابق `Settings::DEFAULTS`)؛ غياب مفتاح أو قيمة تالفة في الاستجابة ⇒ الافتراضي الآمن لا تخمين. */
export const POLICY_DEFAULTS: TankerPolicy = {
  selectionRequired: false, voucherScope: 'station', overrunPolicy: 'allow_with_confirmation',
  attachmentRequired: 'never', attachmentTypes: 'images_and_pdf', attachmentMaxMb: 10, attachmentMaxCount: 10, attachmentAfterClose: 'allow', attachmentRemoval: 'open_shift_only',
  inventoryPolicy: 'block', inventoryReviewHours: 24,
};

export const SERVER_KEYS = {
  selectionRequired: 'tanker_selection_required',
  voucherScope: 'tanker_voucher_unique_scope',
  overrunPolicy: 'tanker_capacity_overrun_policy',
  attachmentRequired: 'tanker_voucher_attachment_required',
  attachmentTypes: 'tanker_fill_attachment_types',
  attachmentMaxMb: 'tanker_fill_attachment_max_size_mb',
  attachmentMaxCount: 'tanker_fill_attachment_max_count',
  attachmentAfterClose: 'tanker_fill_attachment_after_close',
  attachmentRemoval: 'tanker_fill_attachment_removal',
  inventoryPolicy: 'tanker_inventory_insufficient_policy',
  inventoryReviewHours: 'tanker_inventory_review_after_hours',
} as const;
export type PolicyField = keyof typeof SERVER_KEYS;
export const POLICY_FIELDS = Object.keys(SERVER_KEYS) as PolicyField[];

/** حقول الحوكمة (يتطلب تغييرها `fuel.governance.manage` مع `fuel_stations.manage`)؛ الأنواع والحجم والعدد تكفيها `fuel_stations.manage`. يفرضها الخادم — هذا للعرض فقط. */
export const GOVERNANCE_FIELDS: readonly PolicyField[] = ['selectionRequired', 'voucherScope', 'overrunPolicy', 'attachmentRequired', 'attachmentAfterClose', 'attachmentRemoval', 'inventoryPolicy'];
const GOVERNANCE_SERVER_KEYS = new Set<string>(GOVERNANCE_FIELDS.map((field) => SERVER_KEYS[field]));
export const touchesGovernance = (changes: Record<string, unknown>): boolean => Object.keys(changes).some((key) => GOVERNANCE_SERVER_KEYS.has(key));

const boundedInt = (value: unknown, max: number, fallback: number): number => (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max ? value : fallback);

const oneOf = <T extends string>(list: readonly T[], value: unknown, fallback: T): T => (typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : fallback);

export function readPolicy(raw: unknown): TankerPolicy {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    selectionRequired: source[SERVER_KEYS.selectionRequired] === true,
    voucherScope: oneOf(VOUCHER_SCOPES, source[SERVER_KEYS.voucherScope], POLICY_DEFAULTS.voucherScope),
    overrunPolicy: oneOf(OVERRUN_POLICIES, source[SERVER_KEYS.overrunPolicy], POLICY_DEFAULTS.overrunPolicy),
    attachmentRequired: oneOf(ATTACHMENT_REQUIRED, source[SERVER_KEYS.attachmentRequired], POLICY_DEFAULTS.attachmentRequired),
    attachmentTypes: oneOf(ATTACHMENT_TYPES, source[SERVER_KEYS.attachmentTypes], POLICY_DEFAULTS.attachmentTypes),
    attachmentMaxMb: boundedInt(source[SERVER_KEYS.attachmentMaxMb], ATTACHMENT_HARD_MAX_MB, POLICY_DEFAULTS.attachmentMaxMb),
    attachmentMaxCount: boundedInt(source[SERVER_KEYS.attachmentMaxCount], ATTACHMENT_HARD_MAX_COUNT, POLICY_DEFAULTS.attachmentMaxCount),
    attachmentAfterClose: oneOf(ATTACHMENT_AFTER_CLOSE, source[SERVER_KEYS.attachmentAfterClose], POLICY_DEFAULTS.attachmentAfterClose),
    attachmentRemoval: oneOf(ATTACHMENT_REMOVAL, source[SERVER_KEYS.attachmentRemoval], POLICY_DEFAULTS.attachmentRemoval),
    inventoryPolicy: oneOf(INVENTORY_POLICIES, source[SERVER_KEYS.inventoryPolicy], POLICY_DEFAULTS.inventoryPolicy),
    inventoryReviewHours: boundedInt(source[SERVER_KEYS.inventoryReviewHours], INVENTORY_REVIEW_HOURS_MAX, POLICY_DEFAULTS.inventoryReviewHours),
  };
}

/** اختيار الواجهة لكل سياسة: القيمة نفسها كنص، أو `inherit` (نطاق المحطة فقط: لا تجاوز، أو مسح التجاوز والعودة لافتراضي المؤسسة). */
export const INHERIT = 'inherit';
export type PolicyDraft = Record<PolicyField, string>;

const BOOLEAN_FIELDS: readonly PolicyField[] = ['selectionRequired'];
const NUMBER_FIELDS: readonly PolicyField[] = ['attachmentMaxMb', 'attachmentMaxCount', 'inventoryReviewHours'];
const draftValue = (policy: TankerPolicy, field: PolicyField): string => String(policy[field]);

/**
 * المسودة الابتدائية. نطاق المؤسسة (`overrides = null`): القيم الفعلية. نطاق المحطة: `inherit` لما **لا تجاوز له**، والقيمة لما له تجاوز صريح —
 * فتبقى حالة الوراثة مرئية حتى لو تساوت القيمة الفعّالة مع قيمة المؤسسة (تثبيت قيمة مساوية = تجاوز، لا لا-تغيير).
 */
export function toDraft(policy: TankerPolicy, overrides: ReadonlySet<PolicyField> | null = null): PolicyDraft {
  const draft = {} as PolicyDraft;
  for (const field of POLICY_FIELDS) draft[field] = overrides !== null && !overrides.has(field) ? INHERIT : draftValue(policy, field);
  return draft;
}

function typed(field: PolicyField, value: string): boolean | number | string {
  if (BOOLEAN_FIELDS.includes(field)) return value === 'true';
  if (NUMBER_FIELDS.includes(field)) return Number(value);
  return value;
}

/**
 * المتغيّر عن المسودة الابتدائية فقط (لا طلب عند عدم التغيير). `inherit` ⇒ `null` (مسح تجاوز المحطة)؛ وقيمة صريحة بعد `inherit` تُرسَل حتى لو ساوت
 * القيمة الفعّالة (تثبيت تجاوز). لا يصل `inherit` إلى نطاق المؤسسة أصلاً (لا خيار له هناك).
 */
export function policyChanges(initial: PolicyDraft, draft: PolicyDraft): Record<string, boolean | number | string | null> {
  const payload: Record<string, boolean | number | string | null> = {};
  for (const field of POLICY_FIELDS) {
    if (draft[field] === initial[field]) continue;
    payload[SERVER_KEYS[field]] = draft[field] === INHERIT ? null : typed(field, draft[field]);
  }
  return payload;
}

/** مفاتيح الخادم ⇒ حقول الواجهة (للتجاوزات المعادة في `meta.overrides`). */
export function overrideFields(serverKeys: unknown): Set<PolicyField> {
  const fields = new Set<PolicyField>();
  if (!Array.isArray(serverKeys)) return fields;
  for (const field of POLICY_FIELDS) if (serverKeys.includes(SERVER_KEYS[field])) fields.add(field);
  return fields;
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
