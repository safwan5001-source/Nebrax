import { z } from 'zod';

/**
 * معاينة تسوية الوردية (P1-3a) — العقد والمنطق النقي (بلا I/O).
 *
 * الخادم **مصدر الحقيقة الوحيد**: `GET /fuel-stations/shifts/{id}/settlement-preview` (قراءة فقط، مغلق خلف بوابة نشر ⇒ 404 ⇒ لا قسم).
 * الطبقات تصل مفاتيحها أو لا تصل بحسب صلاحيات المستخدم (`fuel.sale.view` للمبالغ): غياب المفتاح يعني «غير مسموح بالعرض» لا «صفر».
 * هنا فقط تحليل الاستجابة وتصنيف الرموز؛ لا حساب مالي ولا قرار. **المعاينة لا تُسجّل شيئاً** وقد تتغيّر قبل الإغلاق.
 */
const int = z.number().int();
const nullableInt = int.nullable();
const label = z.union([z.string(), z.number()]).transform((value) => String(value));

export const settlementLineSchema = z.object({
  nozzle_id: z.string(),
  nozzle_number: label,
  fuel_product_id: z.string(),
  metered_milliliters: nullableInt,
  withheld: z.boolean(),
  // الطبقة المالية فقط:
  erp_milliliters: int.optional(),
  residual_milliliters: nullableInt.optional(),
  price_per_liter_minor: nullableInt.optional(),
  expected_gross_minor: nullableInt.optional(),
  state: z.string().optional(),
  withheld_reason: z.string().nullable().optional(),
});

const allocationRow = z.object({
  payment_method_id: z.string(),
  method: z.string().nullable(),
  settlement_type: z.string().nullable(),
  target_kind: z.string(),
  target_ref: z.string(),
  amount_minor: int,
});

const variantAmount = z.object({ payment_method_id: z.string(), method: z.string().nullable(), amount_minor: int });

export const settlementPreviewSchema = z.object({
  enabled: z.boolean(),
  writes_nothing: z.literal(true),
  shift: z.object({ id: z.string(), number: label, status: z.string() }),
  policy: z.object({ mode: z.string(), sales_basis: z.string() }),
  ready: z.boolean(),
  blockers: z.array(z.string()),
  preview_hash: z.string(),
  evaluated_at: z.string(),
  lines: z.array(settlementLineSchema),
  disclaimers: z.array(z.string()),
  reference: z.object({ total_minor: int }).passthrough().optional(),
  declaration: z.object({
    present: z.boolean(),
    declared_total_minor: int,
    difference_vs_reference_minor: nullableInt,
  }).passthrough().optional(),
  allocation: z.object({ rows: z.array(allocationRow), allocated_total_minor: int }).optional(),
  variances: z.object({
    shortage_minor: int,
    surplus: z.array(variantAmount),
    held_for_withheld: z.array(variantAmount),
  }).optional(),
});

export const settlementPreviewResponse = z.object({ data: settlementPreviewSchema });
export type SettlementPreview = z.infer<typeof settlementPreviewSchema>;
export type SettlementLine = z.infer<typeof settlementLineSchema>;

const KNOWN_BLOCKERS = [
  'METER_INCOMPLETE', 'DECLARATION_MISSING', 'SUPERVISOR_ATTENTION', 'ERP_EXCEEDS_METER', 'DECLARATION_BELOW_RECEIPTS', 'PRICE_CHANGED',
  'PRICE_UNAVAILABLE', 'INSUFFICIENT_STOCK', 'PERIOD_LOCKED', 'RECEIPTS_UNATTRIBUTED', 'WALK_IN_REQUIRED', 'WALK_IN_INACTIVE', 'POLICY_NONE',
  'DEPLOYMENT_GATE_CLOSED', 'TAX_OPINION_MISSING', 'DECLARATION_GATE_CLOSED', 'RECEIPT_STAMPING_GATE_CLOSED', 'CASH_BASIS_NOT_DECLARED',
  'NO_PAYMENT_METHODS', 'PAYMENT_METHOD_TREASURY', 'TAX_MODE_UNSET', 'OPEN_SHIFT_INDEX_MISSING', 'COST_STATE',
] as const;
export type KnownBlocker = (typeof KNOWN_BLOCKERS)[number];

/** يحوّل رمز الخادم (`FUEL_SETTLEMENT_NOT_READY_COST_STATE:<id>`…) إلى مفتاح رسالة معروف، أو `unknown` (لا يُعرض نص خام ولا معرّف داخلي). */
export function blockerKey(code: string): KnownBlocker | 'unknown' {
  const bare = code.replace(/^FUEL_SETTLEMENT_/, '').replace(/^NOT_READY_/, '').replace(/:.*$/, '');
  return (KNOWN_BLOCKERS as readonly string[]).includes(bare) ? (bare as KnownBlocker) : 'unknown';
}

const KNOWN_STATES = ['posted', 'no_residual', 'withheld_cost_pool_changed', 'withheld_pool_history_open', 'withheld_period_boundary', 'blocked_erp_exceeds_meter', 'unavailable'] as const;
export function stateKey(state: string | undefined): (typeof KNOWN_STATES)[number] | 'unknown' {
  return (KNOWN_STATES as readonly string[]).includes(state ?? '') ? (state as (typeof KNOWN_STATES)[number]) : 'unknown';
}

export type Direction = 'short' | 'over' | 'match';
/** اتجاه الفرق (المُقَرّ − المطلوب): سالب = ناقص، موجب = زائد. */
export function differenceDirection(difference: number | null | undefined): Direction | null {
  if (difference === null || difference === undefined) return null;
  return difference === 0 ? 'match' : difference < 0 ? 'short' : 'over';
}

/** هل في المعاينة ما يخص مالياً (مفاتيح الطبقة المالية موجودة)؟ غيابها = المستخدم لا يملك رؤية المبيعات. */
export function hasFinanceLayer(preview: SettlementPreview): boolean {
  return preview.reference !== undefined && preview.allocation !== undefined && preview.variances !== undefined;
}
