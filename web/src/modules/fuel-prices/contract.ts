import { z } from 'zod';

/**
 * #2011 — عقد إدارة أسعار الوقود (واجهة المسؤول). كل استجابة تُتحقق بالمخطط؛ المخالف يُرفض كاملاً (`invalid_shape`)
 * بدل عرض رقم من بيانات غير مفهومة. المبالغ هللات صحيحة؛ لا يُعرض السعر الغائب صفراً.
 */
const text = z.string();

export const stationSchema = z.object({
  id: text.min(1),
  code: text,
  name: text,
  status: text,
  timezone: z.string().nullable().optional(),
});

export const fuelProductSchema = z.object({ id: text.min(1), code: text, name: text, is_active: z.boolean() });

export const nozzleSchema = z.object({
  id: text.min(1),
  fuel_station_id: text.min(1),
  fuel_product_id: text.min(1),
  status: text,
});

/** صف `GET /fuel-stations/prices/effective` — القرار الخادمي نفسه الذي يستعمله إنهاء البيع. */
export const effectiveRowSchema = z.object({
  fuel_product_id: text.min(1),
  fuel_station_id: z.string().nullable(),
  status: text,
  source: z.string().nullable(),
  price_per_liter_minor: z.number().int().nonnegative().nullable(),
  unit: text,
  tax_mode: z.string().nullable(),
  effective_from: z.string().nullable(),
  effective_until: z.string().nullable(),
  sellable: z.boolean(),
  blockers: z.array(text),
});

/** صف `GET /fuel-stations/prices/suggestions` — اقتراح من بطاقة المنتج، قراءة فقط. */
export const suggestionRowSchema = z.object({
  fuel_product_id: text.min(1),
  fuel_station_id: z.string().nullable(),
  status: text,
  price_per_liter_minor: z.number().int().positive().nullable(),
  unit: text,
  card_unit_name: z.string().nullable(),
  tax_mode: z.string().nullable(),
  blockers: z.array(text),
  current_scope_price_minor: z.number().int().nullable(),
  matches_current: z.boolean(),
});

export const historyRowSchema = z.object({
  id: text.min(1),
  fuel_station_id: z.string().nullable(),
  fuel_product_id: text.min(1),
  price_per_liter_minor: z.number().int().positive(),
  effective_from: text,
  effective_until: z.string().nullable(),
  status: text,
  reason: z.string().nullable().optional(),
  entry_source: z.string().optional(),
});

export const stationsResponse = z.object({ data: z.array(stationSchema) });
export const productsResponse = z.object({ data: z.array(fuelProductSchema) });
export const nozzlesResponse = z.object({ data: z.array(nozzleSchema) });
export const effectiveResponse = z.object({ data: z.array(effectiveRowSchema) });
export const suggestionsResponse = z.object({ data: z.array(suggestionRowSchema) });
export const historyResponse = z.object({
  data: z.array(historyRowSchema),
  meta: z.object({ current_page: z.number().optional(), last_page: z.number().optional() }).nullable().optional(),
});
export const createResponse = z.object({
  data: historyRowSchema,
  meta: z.object({ replayed: z.boolean(), superseded_price_ids: z.array(text) }),
});

export type Station = z.infer<typeof stationSchema>;
export type FuelProduct = z.infer<typeof fuelProductSchema>;
export type Nozzle = z.infer<typeof nozzleSchema>;
export type EffectiveRow = z.infer<typeof effectiveRowSchema>;
export type SuggestionRow = z.infer<typeof suggestionRowSchema>;
export type HistoryRow = z.infer<typeof historyRowSchema>;
export type CreateResult = z.infer<typeof createResponse>;

export type TaxMode = 'tax_inclusive' | 'tax_exclusive';

/** نطاق الإدارة: محطة بعينها أو سعر المؤسسة الافتراضي. */
export type PriceScope = { kind: 'station'; stationId: string } | { kind: 'tenant' };

export function scopeKey(scope: PriceScope): string {
  return scope.kind === 'station' ? `station:${scope.stationId}` : 'tenant';
}
