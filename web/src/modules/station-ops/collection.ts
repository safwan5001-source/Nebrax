import { z } from 'zod';
import { minorToRiyal } from '@/lib/money';
import { parseMoney } from './cash';

/**
 * إقرار تحصيل الوردية — العقد والمنطق النقي (بلا I/O).
 *
 * الخادم **مصدر الحقيقة الوحيد** لكل ما يلي (`GET|POST /fuel-stations/shifts/{id}/collection`، مغلق خلف بوابة نشر ⇒ 404):
 *  - طرق الدفع المسموحة للمحطة الآن (`methods`) بمعرّفاتها — الواجهة لا تحتفظ بقائمة ولا تنشئ طريقة.
 *  - مبيعات العدادات (لترات × السعر الفعّال) واكتمالها وثغراتها؛ **لا مبلغ غير موثوق** (`amount_minor = null`).
 *  - الفرق (`reconciliation`) ويصل فقط لمن يملك `fuel.sale.view` (`visible:false` وإلا).
 * هنا فقط: تحليل مدخلات المبالغ إلى هللات، ومعاينة محلية لما سيحسبه الخادم عند الحفظ/الإغلاق (للعرض قبل الحفظ، لا للقرار).
 * مطابقة الوردية **تشغيلية** وليست إثباتاً لتحصيل مالي مسجَّل: لا سند ولا فاتورة ولا قيد.
 */
const int = z.number().int();
const nullableInt = int.nullable();
const label = z.union([z.string(), z.number()]).transform((value) => String(value));

export const collectionProductSchema = z.object({
  fuel_product_id: z.string(),
  name: z.string().nullable(),
  nozzle_count: int,
  milliliters: int,
  price_per_liter_minor: nullableInt.optional(),
  price_source: z.string().nullable().optional(),
  amount_minor: nullableInt.optional(),
  gaps: z.array(z.string()),
});

export const collectionNozzleSchema = z.object({
  nozzle_id: z.string(),
  nozzle_number: label,
  fuel_product_id: z.string(),
  opening_milliliters: nullableInt,
  closing_milliliters: nullableInt,
  milliliters: nullableInt,
  status: z.string(),
});

export const collectionViewSchema = z.object({
  enabled: z.boolean(),
  state: z.enum(['none', 'declared', 'frozen']),
  revision: int.nonnegative(),
  methods: z.array(z.object({
    id: z.string().min(1),
    name: z.string(),
    name_en: z.string().nullable().optional(),
    settlement_type: z.string(),
    saved_amount_minor: nullableInt,
  })),
  methods_changed: z.boolean(),
  declaration: z.object({
    id: z.string(),
    revision: int,
    status: z.string(),
    lines: z.array(z.object({
      payment_method_id: z.string(),
      name: z.string(),
      settlement_type: z.string(),
      amount_minor: int,
      still_allowed: z.boolean().nullable().optional(),
    })),
    collected_total_minor: int,
    cash_declared_minor: int,
    network_declared_minor: int,
    declared_by: z.string().nullable().optional(),
    declared_at: z.string().nullable().optional(),
    frozen_at: z.string().nullable().optional(),
  }).nullable(),
  sales: z.object({
    visible: z.boolean(),
    complete: z.boolean(),
    milliliters: int,
    milliliters_complete: z.boolean(),
    amount_minor: nullableInt,
    tax_mode: z.string().nullable().optional(),
    evaluated_at: z.string().nullable().optional(),
    products: z.array(collectionProductSchema),
    nozzles: z.array(collectionNozzleSchema),
    gaps: z.array(z.string()),
  }),
  reconciliation: z.union([
    z.object({ visible: z.literal(false) }),
    z.object({
      visible: z.literal(true),
      final: z.boolean(),
      reason: z.string().nullable(),
      collected_total_minor: nullableInt,
      sales_minor: nullableInt.optional(),
      difference_minor: nullableInt,
      direction: z.enum(['none', 'overage', 'shortage']).nullable(),
    }),
  ]),
  drawer: z.object({
    frozen: z.boolean(),
    opening_float_minor: int,
    counted_cash_minor: nullableInt,
    treasury_handover_minor: int,
    cash_in_minor: int,
    cash_out_minor: int,
    expenses_minor: int,
    implied_sales_cash: z.object({
      visible: z.boolean(),
      amount_minor: nullableInt.optional(),
      declared_difference_minor: nullableInt.optional(),
    }),
  }),
  disclaimers: z.array(z.string()),
});

export const collectionResponse = z.object({
  data: collectionViewSchema,
  meta: z.object({ replayed: z.boolean(), unchanged: z.boolean() }).optional(),
});

export type CollectionView = z.infer<typeof collectionViewSchema>;
export type CollectionMethod = CollectionView['methods'][number];
export type CollectionLine = { payment_method_id: string; amount_minor: number };

/* ───────────── المدخلات ───────────── */

export type FieldIssue = 'empty' | 'invalid';

export interface ParsedInputs {
  /** `null` ⇒ لا يمكن الحفظ بعد (حقل فارغ/مشوّه). كل طريقة مفعّلة تحتاج مبلغاً صريحاً ولو صفراً. */
  lines: CollectionLine[] | null;
  issues: Record<string, FieldIssue>;
  /** مجموع ما أُدخل صحيحاً حتى الآن (للمعاينة)؛ `null` إن لم تُملأ كل الحقول. */
  total: number | null;
  cashTotal: number | null;
}

/** يحلّل مدخلات الريال الخام لكل طريقة **حالية**. الفراغ ليس صفراً. المعرّف هو مفتاح المدخل (لا الاسم). */
export function parseInputs(methods: readonly CollectionMethod[], raw: Readonly<Record<string, string>>): ParsedInputs {
  const issues: Record<string, FieldIssue> = {};
  const lines: CollectionLine[] = [];
  for (const method of methods) {
    const parsed = parseMoney(raw[method.id] ?? '', { min: 0 });
    if (parsed.ok) lines.push({ payment_method_id: method.id, amount_minor: parsed.minor });
    else issues[method.id] = parsed.reason;
  }
  const complete = Object.keys(issues).length === 0 && lines.length === methods.length && methods.length > 0;
  if (!complete) return { lines: null, issues, total: null, cashTotal: null };
  const total = lines.reduce((sum, line) => sum + line.amount_minor, 0);
  const cashIds = new Set(methods.filter((m) => m.settlement_type === 'cash').map((m) => m.id));
  const cashTotal = lines.filter((line) => cashIds.has(line.payment_method_id)).reduce((sum, line) => sum + line.amount_minor, 0);
  return { lines, issues, total, cashTotal };
}

/** قيم الحقول الأولية من آخر إقرار محفوظ (للطرق التي لها مبلغ محفوظ فقط؛ الجديدة تبدأ فارغة). */
export function seedInputs(methods: readonly CollectionMethod[]): Record<string, string> {
  const seeded: Record<string, string> = {};
  for (const method of methods) if (method.saved_amount_minor !== null) seeded[method.id] = minorToRiyal(method.saved_amount_minor);
  return seeded;
}

/** هل المدخلات الحالية تختلف عن المحفوظ؟ (لتنبيه «لم يُحفظ» قبل التسليم). */
export function isDirty(view: CollectionView, parsed: ParsedInputs): boolean {
  if (view.declaration === null) return true;
  if (parsed.lines === null) return true;
  const saved = new Map(view.declaration.lines.map((line) => [line.payment_method_id, line.amount_minor]));
  if (saved.size !== parsed.lines.length) return true;
  return parsed.lines.some((line) => saved.get(line.payment_method_id) !== line.amount_minor);
}

/** هل مجموعة الطرق المحفوظة تختلف عن المسموحة الآن؟ (تفعيل/تعطيل من إعدادات المحطة بعد الحفظ). */
export function methodSetChanged(view: CollectionView): boolean {
  return view.methods_changed;
}

/* ───────────── المعاينة المحلية (الخادم يعيد الحساب عند الحفظ والإغلاق) ───────────── */

export type Direction = 'none' | 'overage' | 'shortage';
export const directionOf = (difference: number): Direction => (difference === 0 ? 'none' : difference > 0 ? 'overage' : 'shortage');

export interface DifferencePreview {
  /** غير نهائي حين المبيعات غير مكتملة أو غير مرئية. */
  final: boolean;
  differenceMinor: number | null;
  direction: Direction | null;
}

/** الفرق = المُحصَّل المُدخل − مبيعات العدادات. زيادة = موجب، عجز = سالب. بلا مبيعات موثوقة ⇒ لا فرق. */
export function previewDifference(view: CollectionView, collectedMinor: number | null): DifferencePreview {
  const sales = view.sales;
  if (collectedMinor === null || !sales.visible || !sales.complete || sales.amount_minor === null) return { final: false, differenceMinor: null, direction: null };
  const difference = collectedMinor - sales.amount_minor;
  return { final: true, differenceMinor: difference, direction: directionOf(difference) };
}

export interface DrawerPreview {
  /** النقد الذي يدلّ عليه الدرج للمبيعات = المعدود − العهدة − وارد غير مبيعات + الصادر (يشمل التسليم للخزنة) + المصروف. */
  impliedSalesCashMinor: number;
  /** نقد مُقَرّ به (طرق نقد) − المستنتج من الدرج. */
  crossDifferenceMinor: number | null;
}

export function previewDrawer(view: CollectionView, countedMinor: number | null, declaredCashMinor: number | null): DrawerPreview | null {
  if (countedMinor === null || !view.drawer.implied_sales_cash.visible || view.drawer.frozen) return null;
  const d = view.drawer;
  const implied = countedMinor - d.opening_float_minor - d.cash_in_minor + d.cash_out_minor + d.expenses_minor;
  return { impliedSalesCashMinor: implied, crossDifferenceMinor: declaredCashMinor === null ? null : declaredCashMinor - implied };
}

/* ───────────── ثغرات المبيعات ───────────── */

export const SALES_GAP_CODES = ['missing_reading', 'closing_below_opening', 'price_unavailable', 'price_changed_during_shift', 'tax_mode_unset', 'product_unavailable', 'no_nozzles'] as const;
export type SalesGap = (typeof SALES_GAP_CODES)[number];
export const isKnownGap = (code: string): code is SalesGap => (SALES_GAP_CODES as readonly string[]).includes(code);

export const NOZZLE_STATUSES = ['ok', 'no_movement', 'missing_opening', 'missing_closing', 'missing_both', 'closing_below_opening'] as const;
export const isKnownNozzleStatus = (status: string): status is (typeof NOZZLE_STATUSES)[number] => (NOZZLE_STATUSES as readonly string[]).includes(status);

/* ───────────── مفتاح نية الحفظ وحمولته ───────────── */

export interface CollectionBody { idempotency_key: string; base_revision: number; lines: CollectionLine[] }

/** بصمة النية: الوردية + النسخة الأساس + السطور المرتّبة بالمعرّف. تغيّر أي مبلغ = نية جديدة = مفتاح جديد. */
export function intentPayload(shiftId: string, baseRevision: number, lines: readonly CollectionLine[]) {
  return { shift: shiftId, base: baseRevision, lines: [...lines].sort((a, b) => a.payment_method_id.localeCompare(b.payment_method_id)).map((l) => [l.payment_method_id, l.amount_minor]) };
}

/** النجاح يُعلن فقط حين يطابق ما أعاده الخادم ما أُرسل بالضبط (معرّف → مبلغ). */
export function savedMatches(view: CollectionView, sent: readonly CollectionLine[]): boolean {
  const saved = view.declaration?.lines;
  if (!saved || saved.length !== sent.length) return false;
  const byId = new Map(saved.map((line) => [line.payment_method_id, line.amount_minor]));
  return sent.every((line) => byId.get(line.payment_method_id) === line.amount_minor);
}
