import { z } from 'zod';

/**
 * FUEL-B6 — مخططات استجابات مراقبة الخزانات وسجل القراءات (مصدر الشكل: `FuelTankLevelMonitor` و`FuelTankReadingResource`).
 * أي استجابة تخالف الحقول المطلوبة تُرفض كاملةً (`invalid_shape`) بدل عرض أرقام مشتقة من بيانات غير مفهومة.
 * الكميات mL صحيحة (لا float)؛ النسبة بالنقاط الأساسية (10000 = 100%) من الخادم — الواجهة لا تعيد اشتقاقها.
 */

const text = z.string();
const nullableText = z.string().nullable().optional();
const ml = z.number().int().nonnegative();

export const READING_TYPES = ['physical', 'atg'] as const;
export type ReadingKind = (typeof READING_TYPES)[number];

export const FLAGS = ['above_capacity', 'above_safe_capacity', 'below_minimum_level', 'below_dead_stock'] as const;
export type LevelFlag = (typeof FLAGS)[number];

export const FRESHNESS = ['none', 'fresh', 'stale', 'unrated'] as const;
export type Freshness = (typeof FRESHNESS)[number];

const recorder = z.object({ id: text, name: nullableText }).nullable().optional();
const evidence = z.object({ method: nullableText, note: nullableText }).passthrough().nullable().optional();

const latestReading = z.object({
  id: text.min(1),
  reading_type: text,
  quantity_milliliters: ml,
  quantity_liters: text,
  measured_at: text,
  recorded_by: nullableText,
  recorder,
  evidence,
});

export const tankLevelSchema = z.object({
  tank: z.object({
    id: text.min(1),
    code: text,
    name: text,
    status: text,
    capacity_milliliters: ml,
    capacity_liters: text,
    safe_capacity_milliliters: ml,
    minimum_level_milliliters: ml,
    dead_stock_milliliters: ml,
  }),
  station: z.object({ id: text, code: nullableText, name: nullableText }),
  fuel_product: z.object({ id: nullableText, code: nullableText, name: nullableText }),
  latest: latestReading.nullable(),
  latest_by_type: z.object({ physical: latestReading.nullable(), atg: latestReading.nullable() }),
  level: z.object({
    fill_basis_points: z.number().int().nullable(),
    available_milliliters: ml.nullable(),
    available_liters: nullableText,
    safe_available_milliliters: ml.nullable(),
    age_seconds: z.number().int().nonnegative().nullable(),
    freshness: z.enum(FRESHNESS),
    stale_after_minutes: z.number().int().positive().nullable(),
    flags: z.array(z.enum(FLAGS)),
    needs_review: z.boolean(),
  }),
});
export const tankLevelsResponse = z.object({ data: z.array(tankLevelSchema), meta: z.object({ generated_at: nullableText }).optional() });

export const historyRowSchema = z.object({
  id: text.min(1),
  fuel_tank_id: text.min(1),
  reading_type: text,
  quantity_milliliters: ml,
  quantity_liters: text,
  evidence_key: nullableText,
  evidence,
  recorded_by: nullableText,
  recorder,
  flags: z.array(z.enum(FLAGS)).optional(),
  measured_at: nullableText,
  created_at: nullableText,
});
export const historyResponse = z.object({
  data: z.array(historyRowSchema),
  meta: z.object({ current_page: z.number().int().positive(), last_page: z.number().int().positive(), total: z.number().int().nonnegative() }).optional(),
});

export type TankLevel = z.infer<typeof tankLevelSchema>;
export type LatestReading = z.infer<typeof latestReading>;
export type HistoryRow = z.infer<typeof historyRowSchema>;
export type HistoryPage = { rows: HistoryRow[]; page: number; lastPage: number; total: number };
