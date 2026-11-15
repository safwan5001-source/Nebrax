import { z } from 'zod';

/**
 * TANKER-PR8 — مطابقة قراءات الفوهات عند إغلاق الوردية (قراءة من الخادم فقط).
 *
 *   فرق العدّاد  =  مبيعات مباشرة  +  تعبئة صهاريج  +  غير مفسَّر
 *
 * كل رقم من الخادم (الحكم على الحالة والتفاوت والمراجعة له): الواجهة لا تحسب ولا تستنتج حالة. تعبئة الصهريج ليست بيعاً: لا نقداً ولا شبكة.
 * القسم تشغيلي: لا يغيّر مخزوناً ولا مبالغ. البوابة مغلقة ⇒ 404 ⇒ القسم لا يظهر والشاشة كما كانت حرفياً.
 */

export const METER_STATUSES = ['balanced', 'within_tolerance', 'variance', 'incomplete'] as const;
export type MeterStatus = (typeof METER_STATUSES)[number];

/** التصنيفات الوصفية المعروفة (قائمة ثابتة من الخادم؛ تصنيف مجهول يُعرض باسمه الخام بلا ترجمة مخترعة). */
export const KNOWN_CLASSIFICATIONS = [
  'unrecorded_direct_sale', 'unrecorded_tanker_fill', 'over_recorded_entry', 'reading_error', 'calibration_test', 'internal_use', 'loss_or_leak', 'other',
] as const;

const int = z.number().int();

const reviewSchema = z.object({
  classification: z.string(),
  note: z.string().nullable().optional(),
  reviewed_by: z.string().nullable().optional(),
  reviewed_at: z.string().nullable().optional(),
});

export const meterNozzleSchema = z.object({
  id: z.string().nullable(),
  nozzle_id: z.string(),
  nozzle_number: z.union([z.string(), z.number()]).nullable(),
  fuel_product_id: z.string().nullable().optional(),
  metered_milliliters: int.nullable(),
  direct_sale_milliliters: int,
  tanker_fill_milliliters: int,
  tanker_fill_count: int,
  draft_sale_milliliters: int,
  unexplained_milliliters: int.nullable(),
  tolerance_milliliters: int,
  status: z.enum(METER_STATUSES),
  incompleteness: z.string().nullable(),
  requires_review: z.boolean(),
  review: reviewSchema.nullable(),
  frozen: z.boolean(),
});

export const meterReconciliationSchema = z.object({
  shift_id: z.string(),
  frozen: z.boolean(),
  nozzles: z.array(meterNozzleSchema),
  totals: z.object({
    metered_milliliters: int.nullable(),
    direct_sale_milliliters: int,
    tanker_fill_milliliters: int,
    unexplained_milliliters: int.nullable(),
  }),
  summary: z.object({
    variance_nozzles: int,
    incomplete_nozzles: int,
    pending_review: int,
    review_complete: z.boolean(),
  }),
  tolerance_milliliters: int,
  can_review: z.boolean(),
  review_classifications: z.object({
    surplus: z.array(z.string()),
    over_recorded: z.array(z.string()),
    incomplete: z.array(z.string()),
  }),
});

export const meterReconciliationResponse = z.object({ data: meterReconciliationSchema });

export type MeterReconciliation = z.infer<typeof meterReconciliationSchema>;
export type MeterNozzle = z.infer<typeof meterNozzleSchema>;

/** جسم مراجعة فرق فوهة: الفوهة والتصنيف والملاحظة فقط — لا كمية ولا حالة من العميل. */
export type MeterReviewBody = { nozzle_id: string; classification: string; note?: string };

/** نوع الفرق الذي يحدد قائمة التصنيفات المسموحة (الخادم يعيد القوائم؛ نختار منها فقط). */
export function varianceKind(row: Pick<MeterNozzle, 'status' | 'unexplained_milliliters'>): 'incomplete' | 'over_recorded' | 'surplus' {
  if (row.status === 'incomplete') return 'incomplete';
  return (row.unexplained_milliliters ?? 0) < 0 ? 'over_recorded' : 'surplus';
}

export function classificationOptions(row: MeterNozzle, lists: MeterReconciliation['review_classifications']): string[] {
  return lists[varianceKind(row)];
}

/** هل تحتاج الفوهة قراراً من المشرف الآن؟ (فرق/ناقصة ولم تُراجَع، ولقطة مجمَّدة). */
export function needsReview(row: MeterNozzle): boolean {
  return row.frozen && row.requires_review && row.review === null;
}

export function isKnownClassification(value: string): boolean {
  return (KNOWN_CLASSIFICATIONS as readonly string[]).includes(value);
}
