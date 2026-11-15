import { z } from 'zod';
import { REPORT_KEYS, type ReportKey } from './routes';

/**
 * TANKER-PR6B-6 (واجهات) — منطق نقي لتقارير سندات التعبئة الأربعة: عقود القراءة (الاستجابة المخالفة تُرفض كاملةً)، ترتيب معاملات الاستعلام، رموز النتائج المعروفة، وتفسير رفض الخادم.
 * **لا حساب مالي هنا**: الكميات mL صحيحة والمبالغ هللات صحيحة كما أرسلها الخادم، وتحويل العرض في طبقة العرض وحدها. غياب حقل مالي (`null`/غير موجود) يعني «مخفي»، لا صفراً.
 * الخادم هو السلطة في الصلاحيات والنطاق؛ الواجهة تعرض ما أعلنه (`scope`، `masking`، `clearing.available`، `balance_filters_not_applicable`) ولا تستنتج.
 */

// ───────────────────────── المرشّحات ─────────────────────────

export interface ReportFilters {
  stationId?: string;
  ownerId?: string;
  status?: string;
  inventoryStatus?: string;
  from?: string;
  to?: string;
  page?: number;
  perPage?: number;
}

export const FILL_STATUSES = ['recorded', 'voided'] as const;
export const INVENTORY_STATUS_FILTERS = ['pending_integration', 'posted', 'reversed'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** معاملات الاستعلام الصالحة فقط (لا قيمة فارغة ولا الصفحة الأولى)؛ ترتيب ثابت يسهّل الاختبار. تاريخ مشوَّه يُسقَط. */
export function reportQueryEntries(filters: ReportFilters): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  if (filters.stationId) entries.push(['station_id', filters.stationId]);
  if (filters.ownerId) entries.push(['owner_id', filters.ownerId]);
  if (filters.status && (FILL_STATUSES as readonly string[]).includes(filters.status)) entries.push(['status', filters.status]);
  if (filters.inventoryStatus && (INVENTORY_STATUS_FILTERS as readonly string[]).includes(filters.inventoryStatus)) entries.push(['inventory_status', filters.inventoryStatus]);
  if (filters.from && DATE.test(filters.from)) entries.push(['from', filters.from]);
  if (filters.to && DATE.test(filters.to)) entries.push(['to', filters.to]);
  if (filters.page && filters.page > 1) entries.push(['page', String(Math.trunc(filters.page))]);
  if (filters.perPage && filters.perPage > 0) entries.push(['per_page', String(Math.trunc(filters.perPage))]);
  return entries;
}

/** المرشّحات التي يدعمها كل تقرير في الواجهة (تقرير الحساب الوسيط لا يعرض مرشّحات صفوف لأنها لا تؤثر في أرصدة الأستاذ). */
export const FILTERS_BY_REPORT: Record<ReportKey, ReadonlyArray<'station' | 'owner' | 'status' | 'inventoryStatus' | 'period'>> = {
  fills: ['station', 'owner', 'status', 'inventoryStatus', 'period'],
  'inventory-reconciliation': ['station', 'owner', 'status', 'inventoryStatus', 'period'],
  'accounting-control': ['station', 'owner', 'status', 'inventoryStatus', 'period'],
  'clearing-account': ['period'],
};

/** الفترة المعكوسة (من > إلى) تُمنع في الواجهة قبل الطلب (الخادم يرفضها 422). */
export const isPeriodReversed = (from?: string, to?: string): boolean => Boolean(from && to && DATE.test(from) && DATE.test(to) && to < from);

// ───────────────────────── عقود القراءة ─────────────────────────

const nullable = <T extends z.ZodTypeAny>(schema: T) => schema.nullish().transform((value): z.output<T> | null => value ?? null);
const text = nullable(z.string());
const whole = z.number().int();
const wholeOrNull = nullable(whole);

export const SEVERITIES = ['error', 'warning', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const RESULTS = ['matched', 'mismatch', 'warning', 'incomplete'] as const;
export type Result = (typeof RESULTS)[number];

const finding = z.object({
  code: z.string().min(1),
  severity: z.enum(SEVERITIES).catch('warning'),
  difference_minor: wholeOrNull.optional().transform((v) => v ?? null),
  net_minor: wholeOrNull.optional().transform((v) => v ?? null),
});
export type Finding = z.output<typeof finding>;
const findings = z.array(finding).nullish().transform((v) => v ?? []);
const result = z.enum(RESULTS).catch('incomplete');

const masking = z.object({ costs: z.boolean().nullish().transform((v) => v === true), accounts: z.boolean().nullish().transform((v) => v === true) }).nullish().transform((v) => v ?? { costs: false, accounts: false });

const meta = z.object({
  report: z.string(),
  generated_at: text,
  filters: z.record(z.string(), z.unknown()).nullish().transform((v) => v ?? {}),
  scan_limit: wholeOrNull.optional().transform((v) => v ?? null),
  row_scope: z.object({ station_restricted: z.boolean().catch(false), branch_restricted: z.boolean().catch(false) }).nullish().transform((v) => v ?? { station_restricted: false, branch_restricted: false }),
  balance_filters_not_applicable: z.array(z.string()).nullish().transform((v) => v ?? []),
});
export type ReportMeta = z.output<typeof meta>;

const idName = z.object({ id: nullable(z.string()), name: text });
const entryRef = nullable(z.object({ id: z.string(), number: text, status: text.optional().transform((v) => v ?? null) }));

// ① سندات التعبئة
const fillRow = z.object({
  id: z.string().min(1), number: z.string().min(1), voucher_number: text, recorded_at: text, status: z.string(), inventory_status: z.string(),
  station: idName.nullish().transform((v) => v ?? null), owner: idName.nullish().transform((v) => v ?? null),
  tanker: z.object({ id: z.string(), plate_number: z.string() }).nullish().transform((v) => v ?? null),
  fuel_product: idName.nullish().transform((v) => v ?? null),
  quantity_milliliters: whole.nonnegative(), posting_status: text, posted_at: text, reversed_at: text,
  posted_cost_minor: wholeOrNull.optional().transform((v) => v ?? null),
  journal_entry: entryRef.optional().transform((v) => v ?? null), reversal_journal_entry: entryRef.optional().transform((v) => v ?? null),
  stock_movement_id: text.optional().transform((v) => v ?? null), cost_movement_id: text.optional().transform((v) => v ?? null),
});
export type FillsRow = z.output<typeof fillRow>;

const fillsData = z.object({
  rows: z.array(fillRow),
  summary: z.object({
    total_count: whole.nonnegative().catch(0), total_quantity_milliliters: whole.catch(0),
    by_state: z.array(z.object({ status: z.string(), inventory_status: z.string(), count: whole.catch(0), quantity_milliliters: whole.catch(0) })).nullish().transform((v) => v ?? []),
  }),
  pagination: z.object({ page: whole.min(1).catch(1), per_page: whole.min(1).catch(25), total: whole.nonnegative().catch(0), last_page: whole.min(1).catch(1) }),
  masking,
});
export type FillsReport = z.output<typeof fillsData>;

// السلسلة المشتركة بين ② و④
const quantities = z.record(z.string(), z.number().int().nullable()).nullish().transform((v) => v ?? {});
const values = z.record(z.string(), z.number().int().nullable()).nullish().transform((v) => v ?? null);
const summaryBase = z.object({
  total: whole.nonnegative().catch(0), matched: whole.nonnegative().catch(0), confirmed_differences: whole.nonnegative().catch(0),
  warnings: whole.nonnegative().catch(0), incomplete: whole.nonnegative().catch(0),
});
export type ResultSummary = z.output<typeof summaryBase>;

const reconRow = z.object({
  fill_id: z.string().min(1), number: z.string(), voucher_number: text, station_id: text, inventory_status: z.string(), posting_status: text,
  quantities, values, findings, result,
});
export type ReconRow = z.output<typeof reconRow>;

const reconData = z.object({
  rows: z.array(reconRow),
  summary: summaryBase.extend({
    quantity_totals: z.record(z.string(), z.number().int()).nullish().transform((v) => v ?? {}),
  }),
  pool: z.unknown(),
  truncated: z.boolean().catch(false),
  masking,
});
export type ReconciliationReport = Omit<z.output<typeof reconData>, 'pool'> & { pool: unknown };

// ③ الحساب الوسيط
const account = z.object({ id: z.string(), code: text, name: text, is_current: z.boolean().nullish().transform((v) => v === true) });
const otherEntry = z.object({
  entry_id: z.string(), number: text, entry_date: text, description: text, source: text,
  debit_minor: whole.catch(0), credit_minor: whole.catch(0),
});
const side = z.object({ debits_minor: whole.catch(0), credits_minor: whole.catch(0), net_all_time_minor: whole.catch(0) });
const clearingAccount = z.object({
  account, opening_balance_minor: whole, period_debits_minor: whole, period_credits_minor: whole, closing_balance_minor: whole,
  tanker: side, other: side, supported_balance_minor: whole, unexplained_difference_minor: whole,
  other_entries: z.array(otherEntry).nullish().transform((v) => v ?? []), findings,
});
export type ClearingAccountRow = z.output<typeof clearingAccount>;

export const SCOPE_LEVELS = ['organization', 'branches'] as const;
const scope = z.object({
  level: z.string(), branch_ids: z.array(z.string()).nullish().transform((v) => v ?? null), station_restricted: z.boolean().catch(false),
  basis: text, filters_applied: z.array(z.string()).nullish().transform((v) => v ?? []), filters_not_applicable: z.array(z.string()).nullish().transform((v) => v ?? []),
});
export type LedgerScope = z.output<typeof scope>;
const period = z.object({ from: text, to: text });

const clearingData = z.object({ period, accounts: z.array(clearingAccount), scope });
export type ClearingReport = z.output<typeof clearingData>;

// ④ الرقابة المحاسبية
const controlRow = z.object({
  fill_id: z.string().min(1), number: z.string(), voucher_number: text, recorded_at: text, station_id: text, owner_name: text, quantity_milliliters: whole.nonnegative(),
  status: z.string(), inventory_status: z.string(), posting_status: text, quantities, values,
  chain: z.object({
    stock_movement_id: text, cost_movement_id: text, journal_entry: entryRef, reversal_stock_movement_id: text, reversal_cost_movement_id: text, reversal_journal_entry: entryRef,
  }).nullish().transform((v) => v ?? null),
  accounts: z.object({ clearing_account_id: text, inventory_account_id: text }).nullish().transform((v) => v ?? null),
  findings, result,
});
export type ControlRow = z.output<typeof controlRow>;

const controlClearing = z.object({
  available: z.boolean(), reason: text, period: period.nullish().transform((v) => v ?? null), scope: scope.nullish().transform((v) => v ?? null),
  accounts: z.array(z.object({
    account, closing_balance_minor: whole, supported_balance_minor: whole, unexplained_difference_minor: whole, findings,
  })).nullish().transform((v) => v ?? []),
});
export type ControlClearing = z.output<typeof controlClearing>;

const controlData = z.object({
  rows: z.array(controlRow),
  summary: summaryBase.extend({
    findings_by_code: z.array(z.object({ code: z.string(), severity: z.enum(SEVERITIES).catch('warning'), count: whole.catch(0) })).nullish().transform((v) => v ?? []),
  }),
  clearing: controlClearing,
  truncated: z.boolean().catch(false),
  masking,
});
export type ControlReport = z.output<typeof controlData>;

export type ReportPayload =
  | { key: 'fills'; meta: ReportMeta; data: FillsReport }
  | { key: 'inventory-reconciliation'; meta: ReportMeta; data: ReconciliationReport }
  | { key: 'clearing-account'; meta: ReportMeta; data: ClearingReport }
  | { key: 'accounting-control'; meta: ReportMeta; data: ControlReport };

const envelope = z.object({ data: z.unknown(), meta });

/** يقرأ استجابة تقرير بعقد صارم؛ أي مخالفة ⇒ استثناء (تُعرض الشاشة «تعذّر التحميل» لا بيانات مشوَّهة). التقرير المعلن في `meta.report` يجب أن يطابق المطلوب. */
export function readReport(key: ReportKey, payload: unknown): ReportPayload {
  const { data, meta: m } = envelope.parse(payload);
  if (m.report !== key) throw new Error(`report_mismatch:${m.report}`);
  switch (key) {
    case 'fills': return { key, meta: m, data: fillsData.parse(data) };
    case 'inventory-reconciliation': return { key, meta: m, data: reconData.parse(data) as ReconciliationReport };
    case 'clearing-account': return { key, meta: m, data: clearingData.parse(data) };
    case 'accounting-control': return { key, meta: m, data: controlData.parse(data) };
  }
}

// ───────────────────────── رموز النتائج ─────────────────────────

export const FINDING_CODES = [
  'status_without_posting', 'entry_without_posting', 'last_attempt_failed', 'not_posted_yet', 'posting_quantity_differs_from_fill',
  'stock_movement_missing', 'stock_quantity_mismatch', 'stock_value_mismatch', 'cost_movement_missing', 'cost_quantity_mismatch', 'cost_value_mismatch',
  'posted_without_entry', 'entry_amount_mismatch', 'clearing_account_invalid', 'clearing_account_differs_from_current', 'entry_branch_mismatch', 'original_entry_not_reversed',
  'ledger_missing', 'ledger_quantity_mismatch', 'ledger_value_mismatch',
  'reversal_incomplete', 'reversal_quantity_mismatch', 'reversal_entry_not_linked', 'reversal_duplicate', 'reversal_value_mismatch',
  'clearing_balance_differs_from_postings', 'other_entries_on_clearing_account',
] as const;
const FINDING_SET = new Set<string>(FINDING_CODES);
export const isKnownFinding = (code: string) => FINDING_SET.has(code);

/** المرشّحات التي لا تؤثر في أرصدة الأستاذ ويعلنها الخادم؛ رمزها المعروف يُترجم وغيره يُعرض كما هو. */
export const FILTER_KEYS = ['station_id', 'owner_id', 'fuel_product_id', 'status', 'inventory_status'] as const;
export const isKnownFilterKey = (code: string) => (FILTER_KEYS as readonly string[]).includes(code);

export const SCOPE_BASES = ['ledger_lines_by_branch'] as const;
export const isKnownScopeBasis = (code: string | null) => code !== null && (SCOPE_BASES as readonly string[]).includes(code);

// ───────────────────────── رفض الخادم ─────────────────────────

export const FORBIDDEN_REASONS = ['station_scope_restricted', 'financial_permissions_required'] as const;
export type ForbiddenReason = (typeof FORBIDDEN_REASONS)[number];

/** رمز سبب 403 المعلن في `details.reason`؛ غير المعروف/الغائب ⇒ `null` (رسالة منع عامة بلا معلومات مالية). */
export function forbiddenReasonOf(body: unknown): ForbiddenReason | null {
  const details = typeof body === 'object' && body !== null ? (body as { details?: unknown }).details : undefined;
  const reason = typeof details === 'object' && details !== null ? (details as { reason?: unknown }).reason : undefined;
  return typeof reason === 'string' && (FORBIDDEN_REASONS as readonly string[]).includes(reason) ? (reason as ForbiddenReason) : null;
}

export { REPORT_KEYS };
