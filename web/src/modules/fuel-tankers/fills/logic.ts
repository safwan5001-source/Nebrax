import { z } from 'zod';

/**
 * TANKER-PR6B-5 — منطق نقي لمساحة عمل الدمج المخزني لسندات التعبئة: عقود القراءة (تُرفض الاستجابة المخالفة كاملةً)، رموز الموانع والرفض المعروفة، قواعد تأكيد الترحيل التاريخي والعكس،
 * وحجب الحساس. **لا حساب مالي هنا**: الكميات mL صحيحة والمبالغ هللات صحيحة كما أرسلها الخادم، وتحويل العرض في طبقة العرض وحدها. الخادم هو السلطة في الإجراءات والتصنيف.
 */

// ───────────────────────── التبويبات ─────────────────────────

export const TABS = ['pending', 'posted', 'reversed', 'attention'] as const;
export type Tab = (typeof TABS)[number];
export const isTab = (value: unknown): value is Tab => typeof value === 'string' && (TABS as readonly string[]).includes(value);

export const INVENTORY_STATUSES = ['pending_integration', 'posted', 'reversed'] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

export const OPERATIONS = ['post', 'reverse'] as const;
export type Operation = (typeof OPERATIONS)[number];
export const OUTCOMES = ['succeeded', 'rejected', 'failed'] as const;
export type AttemptOutcome = (typeof OUTCOMES)[number];

export interface WorkspaceQuery {
  tab?: Tab;
  stationId?: string;
  q?: string;
  page?: number;
  perPage?: number;
}

/** معاملات الاستعلام الصالحة فقط (لا قيمة فارغة ولا الصفحة الأولى ولا التبويب الافتراضي)؛ ترتيب ثابت يسهّل الاختبار. */
export function queryEntries(query: WorkspaceQuery): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  if (query.tab && query.tab !== 'pending') entries.push(['tab', query.tab]);
  if (query.stationId) entries.push(['station_id', query.stationId]);
  const q = query.q?.trim();
  if (q) entries.push(['q', q.slice(0, 64)]);
  if (query.page && query.page > 1) entries.push(['page', String(Math.trunc(query.page))]);
  if (query.perPage && query.perPage > 0) entries.push(['per_page', String(Math.trunc(query.perPage))]);
  return entries;
}

// ───────────────────────── عقود القراءة ─────────────────────────

const nullable = <T extends z.ZodTypeAny>(schema: T) => schema.nullish().transform((value): z.output<T> | null => value ?? null);
const text = nullable(z.string());
const wholeNumber = z.number().int();

const attemptSummary = z.object({
  operation: z.enum(OPERATIONS),
  outcome: z.enum(OUTCOMES),
  reason_code: text,
  attempted_at: text,
});
export type AttemptSummary = z.output<typeof attemptSummary>;

const inventorySummary = z.object({
  posting_status: z.enum(['posted', 'reversed']).nullish().transform((value) => value ?? null),
  posted_at: text,
  reversed_at: text,
  posted_cost_minor: nullable(wholeNumber),
  last_attempt: attemptSummary.nullish().transform((value) => value ?? null),
  attempts_count: z.number().int().nullish().transform((value) => value ?? 0),
});
export type InventorySummary = z.output<typeof inventorySummary>;

export const READINESS = ['ready', 'needs_review', 'blocked', 'not_applicable'] as const;
export type Readiness = (typeof READINESS)[number];
const readiness = z.object({
  readiness: z.enum(READINESS).catch('needs_review'),
  blockers: z.array(z.string()).nullish().transform((value) => value ?? []),
  historical: z.boolean().nullish().transform((value) => value === true),
  overdue: z.boolean().nullish().transform((value) => value === true),
});
export type ReadinessView = z.output<typeof readiness>;

const owner = z.object({ id: z.string(), name: z.string(), code: text });
const tanker = z.object({ id: z.string(), plate_number: z.string(), capacity_milliliters: nullable(wholeNumber) });

const fillBase = z.object({
  id: z.string().min(1),
  number: z.string().min(1),
  voucher_number: text,
  status: z.string(),
  inventory_status: z.enum(INVENTORY_STATUSES),
  fuel_station_id: text,
  quantity_milliliters: wholeNumber.nonnegative(),
  quantity_liters: text,
  recorded_at: text,
  voided_at: text,
  void_reason: text,
  notes: text,
  owner: owner.nullish().transform((value) => value ?? null),
  tanker: tanker.nullish().transform((value) => value ?? null),
  attachments_count: nullable(wholeNumber),
});

const row = fillBase.extend({
  inventory: inventorySummary.nullish().transform((value) => value ?? null),
  readiness: readiness.nullish().transform((value) => value ?? null),
});
export type FillRow = z.output<typeof row>;

const counts = z.object({
  pending: wholeNumber.nonnegative().catch(0),
  posted: wholeNumber.nonnegative().catch(0),
  reversed: wholeNumber.nonnegative().catch(0),
  attention: wholeNumber.nonnegative().catch(0),
});
export type TabCounts = z.output<typeof counts>;

const workspace = z.object({
  data: z.array(row),
  meta: z.object({
    tab: z.string().optional(),
    page: wholeNumber.min(1).catch(1),
    per_page: wholeNumber.min(1).catch(20),
    total: wholeNumber.nonnegative().catch(0),
    last_page: wholeNumber.min(1).catch(1),
    counts,
  }),
});
export interface WorkspacePage {
  rows: FillRow[];
  page: number;
  perPage: number;
  total: number;
  lastPage: number;
  counts: TabCounts;
}

const userRef = z.object({ id: nullable(z.string()), name: text });
const entryRef = z.object({ id: z.string(), number: text });
const id = nullable(z.string());

const posting = z.object({
  id: z.string(),
  status: z.enum(['posted', 'reversed']),
  quantity_milliliters: wholeNumber.nonnegative(),
  posted_by: userRef.nullish().transform((value) => value ?? null),
  posted_at: text,
  reversed_by: userRef.nullish().transform((value) => value ?? null),
  reversed_at: text,
  reversal_reason: text,
  // حقول التكلفة تغيب كلياً (undefined) لمن لا يملك `products.view_cost` — الغياب ≠ null.
  posted_cost_minor: wholeNumber.nullable().optional(),
  journal_entry: entryRef.nullish().transform((value) => value ?? null),
  reversal_journal_entry: entryRef.nullish().transform((value) => value ?? null),
  stock_movement_id: id,
  cost_movement_id: id,
  reversal_stock_movement_id: id,
  reversal_cost_movement_id: id,
});
export type PostingFacts = z.output<typeof posting>;

const accountRef = z.object({ id: nullable(z.string()), code: text, name: text });
const accounts = z.object({ clearing: accountRef, inventory: accountRef });

const attemptRow = attemptSummary.extend({
  id: z.string(),
  actor: userRef.nullish().transform((value) => value ?? null),
});
export type AttemptRow = z.output<typeof attemptRow>;

const actions = z.object({
  preview_post: z.boolean().nullish().transform((value) => value === true),
  post: z.boolean().nullish().transform((value) => value === true),
  post_historical: z.boolean().nullish().transform((value) => value === true),
  preview_reversal: z.boolean().nullish().transform((value) => value === true),
  reverse: z.boolean().nullish().transform((value) => value === true),
});
export type FillActions = z.output<typeof actions>;

const detail = z.object({
  data: fillBase.extend({
    inventory: z.object({
      status: z.enum(INVENTORY_STATUSES),
      posting: posting.nullish().transform((value) => value ?? null),
      accounts: accounts.nullish().transform((value) => value ?? null),
      attempts: z.array(attemptRow).nullish().transform((value) => value ?? []),
    }),
    readiness: readiness.nullish().transform((value) => value ?? null),
    actions,
  }),
});
export type FillDetail = z.output<typeof detail>['data'];

const line = z.object({
  side: z.enum(['debit', 'credit']),
  account_id: text,
  role: text,
});
const entry = z.object({
  lines: z.array(line),
  entry_date: text,
  amount_minor: nullable(wholeNumber),
});

const postingPreview = z.object({
  data: z.object({
    fill_id: z.string(),
    status: z.enum(['postable', 'blocked', 'not_applicable']),
    blockers: z.array(z.string()).nullish().transform((value) => value ?? []),
    historical: z.boolean().nullish().transform((value) => value === true),
    cost_recognition: text,
    variance_policy: text,
    entry: entry.nullish().transform((value) => value ?? null),
  }),
});
const reversalPreview = z.object({
  data: z.object({
    fill_id: z.string(),
    status: z.enum(['reversible', 'blocked', 'not_applicable']),
    blockers: z.array(z.string()).nullish().transform((value) => value ?? []),
    quantity_milliliters: nullable(wholeNumber),
    reversal_date: text,
    valuation: text,
    entry: entry.nullish().transform((value) => value ?? null),
  }),
});

/** معاينة موحَّدة للعمليتين (ترحيل/عكس): `ready` = قابلة للتنفيذ، `blocked` = محجوبة بموانع، `not_applicable` = لا تنطبق على حالة السند الآن. */
export interface OperationPreview {
  operation: Operation;
  status: 'ready' | 'blocked' | 'not_applicable';
  blockers: string[];
  historical: boolean;
  entryDate: string | null;
  amountMinor: number | null;
  hasEntry: boolean;
  lines: Array<{ side: 'debit' | 'credit'; accountId: string | null; role: string | null }>;
  costRecognition: string | null;
  variancePolicy: string | null;
  valuation: string | null;
  quantityMilliliters: number | null;
}

function shapeLines(value: z.output<typeof entry> | null) {
  return (value?.lines ?? []).map((item) => ({ side: item.side, accountId: item.account_id, role: item.role }));
}

export function readPostingPreview(payload: unknown): OperationPreview {
  const { data } = postingPreview.parse(payload);
  return {
    operation: 'post',
    status: data.status === 'postable' ? 'ready' : data.status,
    blockers: data.blockers,
    historical: data.historical,
    entryDate: data.entry?.entry_date ?? null,
    amountMinor: data.entry?.amount_minor ?? null,
    hasEntry: data.entry !== null,
    lines: shapeLines(data.entry),
    costRecognition: data.cost_recognition,
    variancePolicy: data.variance_policy,
    valuation: null,
    quantityMilliliters: null,
  };
}

export function readReversalPreview(payload: unknown): OperationPreview {
  const { data } = reversalPreview.parse(payload);
  return {
    operation: 'reverse',
    status: data.status === 'reversible' ? 'ready' : data.status,
    blockers: data.blockers,
    historical: false,
    entryDate: data.entry?.entry_date ?? data.reversal_date,
    amountMinor: data.entry?.amount_minor ?? null,
    hasEntry: data.entry !== null,
    lines: shapeLines(data.entry),
    costRecognition: null,
    variancePolicy: null,
    valuation: data.valuation,
    quantityMilliliters: data.quantity_milliliters,
  };
}

export function readWorkspace(payload: unknown): WorkspacePage {
  const parsed = workspace.parse(payload);
  return { rows: parsed.data, page: parsed.meta.page, perPage: parsed.meta.per_page, total: parsed.meta.total, lastPage: parsed.meta.last_page, counts: parsed.meta.counts };
}

export function readDetail(payload: unknown): FillDetail {
  return detail.parse(payload).data;
}

/** نتيجة نجاح الترحيل/العكس (201 أو 200 `replayed`): المهم للواجهة هل نُفّذ الآن أم سبق تنفيذه، وحالة السند بعده. */
const writeSuccess = z.object({
  data: z.object({ id: z.string(), inventory_status: z.enum(INVENTORY_STATUSES) }),
  meta: z.object({ replayed: z.boolean().nullish().transform((value) => value === true) }).nullish().transform((value) => value ?? { replayed: false }),
});
export function readWriteSuccess(payload: unknown): { fillId: string; inventoryStatus: InventoryStatus; replayed: boolean } {
  const parsed = writeSuccess.parse(payload);
  return { fillId: parsed.data.id, inventoryStatus: parsed.data.inventory_status, replayed: parsed.meta.replayed };
}

// ───────────────────────── رموز الخادم المعروفة ─────────────────────────

/** موانع الجاهزية والترحيل والعكس المعروفة؛ غير المعروف يُعرض برمزه الخام (لا يُخفى ولا يُخمَّن). */
export const KNOWN_BLOCKERS = [
  'station_not_active', 'station_warehouse_required', 'warehouse_unavailable', 'warehouse_branch_mismatch', 'fuel_product_unavailable', 'stock_record_missing',
  'cost_baseline_required', 'cost_history_open', 'cost_pool_quantity_mismatch', 'insufficient_balance', 'period_locked', 'settlement_mode_conflict',
  'clearing_account_missing', 'clearing_account_invalid', 'inventory_account_invalid', 'quantity_exceeds_stock_limit', 'insufficient_stock',
  'quantity_not_positive', 'cost_state_missing', 'exceeds_cost_pool', 'not_posted', 'already_reversed', 'original_entry_invalid',
  'downstream_invoiced', 'downstream_settled', 'downstream_supply',
] as const;
const BLOCKER_SET = new Set<string>(KNOWN_BLOCKERS);

const DOWNSTREAM: Record<string, (typeof KNOWN_BLOCKERS)[number]> = {
  invoiced_invoice_id: 'downstream_invoiced', invoiced_at: 'downstream_invoiced',
  settlement_id: 'downstream_settled', settled_at: 'downstream_settled',
  supply_id: 'downstream_supply',
};

/** مفتاح الترجمة للمانع، أو `null` إن لم يكن معروفاً. `downstream_link:<col>` (روابط لاحقة تمنع العكس) تُجمَّع في ثلاثة مفاتيح. */
export function blockerKey(code: string): string | null {
  if (code.startsWith('downstream_link:')) return DOWNSTREAM[code.slice('downstream_link:'.length)] ?? null;
  return BLOCKER_SET.has(code) ? code : null;
}

/** أسباب الرفض والفشل المعروفة (رموز `reason` من الخادم + رموز HTTP العامة)؛ تُستعمل لرفض الكتابة ولسجل المحاولات. */
export const KNOWN_REASONS = [
  'posting_disabled', 'posting_blocked', 'fill_voided', 'fill_not_pending', 'historical_permission_required', 'historical_review_required',
  'quantity_exceeds_stock_limit', 'insufficient_stock', 'posted_cost_zero', 'ledger_variance_blocked', 'distinct_approver_required', 'period_locked',
  'posting_failed', 'reversal_reason_required', 'fill_not_posted', 'reversal_blocked', 'original_entry_invalid', 'forbidden', 'not_found', 'invalid_input',
  'unauthorized', 'rate_limited', 'conflict', 'validation',
] as const;
const REASON_SET = new Set<string>(KNOWN_REASONS);
export const isKnownReason = (code: string | null | undefined): code is (typeof KNOWN_REASONS)[number] => typeof code === 'string' && REASON_SET.has(code);

// ───────────────────────── قواعد التأكيد ─────────────────────────

export const REASON_MAX = 500;
export const REVERSAL_REASON_MIN = 3;

export type ConfirmProblem =
  | 'preview_missing' | 'not_ready' | 'historical_permission_missing' | 'historical_review_required' | 'reason_required' | 'reason_too_short' | 'reason_too_long' | 'action_not_allowed';

export interface PostingInput { reason: string; reviewedHistorical: boolean }

/**
 * هل يجوز إرسال الترحيل الآن؟ لا مشكلة ⇒ `null`. **الصلاحيات من `actions` الخادم وحدها**؛ التاريخي يتطلب صلاحية الترحيل التاريخي وتأكيد المراجعة وسبباً (1..500)، وغير التاريخي سببه اختياري (≤ 500).
 */
export function postingProblem(preview: OperationPreview | null, actions: Pick<FillActions, 'post' | 'post_historical'>, input: PostingInput): ConfirmProblem | null {
  if (preview === null) return 'preview_missing';
  if (!actions.post) return 'action_not_allowed';
  if (preview.status !== 'ready') return 'not_ready';
  const reason = input.reason.trim();
  if (reason.length > REASON_MAX) return 'reason_too_long';
  if (preview.historical) {
    if (!actions.post_historical) return 'historical_permission_missing';
    if (!input.reviewedHistorical) return 'historical_review_required';
    if (reason.length === 0) return 'reason_required';
  }
  return null;
}

/** حمولة الترحيل: `reason` و`confirm_historical` فقط (لا كمية ولا تكلفة ولا حساب ولا تاريخ). `confirm_historical` لا يُرسَل إلا للتاريخي. */
export function postingPayload(preview: Pick<OperationPreview, 'historical'>, input: PostingInput): { reason?: string; confirm_historical?: true } {
  const reason = input.reason.trim();
  const payload: { reason?: string; confirm_historical?: true } = {};
  if (reason !== '') payload.reason = reason;
  if (preview.historical) payload.confirm_historical = true;
  return payload;
}

/** سبب العكس إلزامي (3..500 بعد التقليم). */
export function reversalProblem(preview: OperationPreview | null, actions: Pick<FillActions, 'reverse'>, reasonInput: string): ConfirmProblem | null {
  if (preview === null) return 'preview_missing';
  if (!actions.reverse) return 'action_not_allowed';
  if (preview.status !== 'ready') return 'not_ready';
  const reason = reasonInput.trim();
  if (reason.length === 0) return 'reason_required';
  if (reason.length < REVERSAL_REASON_MIN) return 'reason_too_short';
  if (reason.length > REASON_MAX) return 'reason_too_long';
  return null;
}

export const reversalPayload = (reasonInput: string): { reason: string } => ({ reason: reasonInput.trim() });

// ───────────────────────── حجب الحساس وعرض الكميات ─────────────────────────

/** مللتر صحيح ⇒ لترات بثلاث منازل كنص بلا float (كالخادم). */
export function litersOf(milliliters: number | null | undefined): string {
  if (milliliters === null || milliliters === undefined) return '—';
  const sign = milliliters < 0 ? '-' : '';
  const abs = Math.abs(milliliters);
  return `${sign}${Math.trunc(abs / 1000)}.${String(abs % 1000).padStart(3, '0')}`;
}

/** حالة القيمة الحسّاسة: غياب المفتاح أو `null` ⇒ محجوبة عن المستخدم (لا تُعرض صفراً). */
export const isHidden = (value: unknown): boolean => value === null || value === undefined;

/** لقطة من معرّف حساب (للعرض التقني فقط؛ الاسم غير متاح في المعاينة). */
export const shortId = (value: string): string => (value.length > 8 ? `${value.slice(0, 8)}…` : value);

/** تصنيف عرض آخر محاولة: فاشلة (تحتاج انتباهاً) أم لا. */
export const attemptNeedsAttention = (attempt: AttemptSummary | null): boolean => attempt !== null && attempt.outcome !== 'succeeded';
