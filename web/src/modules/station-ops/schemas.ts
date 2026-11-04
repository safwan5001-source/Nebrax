import { z } from 'zod';

/**
 * UI-0 — مخططات التحقق من استجابات GET الفعلية لوحدة محطات الوقود في أَوْج.
 *
 * مصدر الشكل: `app/Http/Resources/Fuel*Resource.php` (فحص الكود، لا افتراض). نتحقق من الحقول التي
 * تعتمد عليها الواجهة فقط ونتجاهل الباقي، لكن **أي استجابة تخالف الحقول المطلوبة تُرفض كاملةً**
 * (`invalid_shape`) بدل إسقاط صفوف بصمت أو عرض أرقام مشتقة من بيانات غير مفهومة.
 */

const text = z.string();
const nullableText = z.string().nullable().optional();

/** رقم الفوهة/المضخة قد يصل نصاً أو رقماً بحسب العمود؛ نوحّده نصاً للعرض. */
const label = z.union([z.string(), z.number()]).transform((value) => String(value));

export const stationSchema = z.object({
  id: text.min(1),
  code: text,
  name: text,
  status: text,
  branch_id: nullableText,
  city: nullableText,
  region: nullableText,
  timezone: nullableText,
  license_number: nullableText,
  license_expires_at: nullableText,
});

export const fuelProductSchema = z.object({
  id: text.min(1),
  code: text,
  name: text,
  is_active: z.boolean(),
});

export const pumpSchema = z.object({
  id: text.min(1),
  fuel_station_id: text.min(1),
  pump_number: label,
  name: nullableText,
  status: text,
});

export const nozzleSchema = z.object({
  id: text.min(1),
  fuel_station_id: text.min(1),
  fuel_pump_id: text.min(1),
  fuel_tank_id: text.min(1),
  fuel_product_id: text.min(1),
  nozzle_number: label,
  status: text,
});

export const tankSchema = z.object({
  id: text.min(1),
  fuel_station_id: text.min(1),
  fuel_product_id: text.min(1),
  code: text,
  name: text,
  capacity_milliliters: z.number().int().nonnegative(),
  minimum_level_milliliters: z.number().int().nonnegative().nullable().optional(),
  status: text,
});

export const priceSchema = z.object({
  id: text.min(1),
  fuel_station_id: z.string().nullable(),
  fuel_product_id: text.min(1),
  price_per_liter_minor: z.number().int().nonnegative(),
  effective_from: text,
  effective_until: z.string().nullable(),
  status: text,
});

export const shiftSchema = z.object({
  id: text.min(1),
  number: text,
  status: text,
  station_id: text.min(1),
  opening_float_minor: z.number().int(),
  operational_liters: text,
  cash_variance_minor: z.number().int().nullable(),
  opened_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  approved_at: z.string().nullable(),
  cash_variance: z.object({ status: text }).nullable().optional(),
});

const collection = <T extends z.ZodTypeAny>(item: T) => z.object({ data: z.array(item) });

/** مجمّع Laravel القياسي (`paginate(50)`): `meta` غير مضمون الوجود في كل إصدار، فنقبل غيابه. */
const paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    data: z.array(item),
    meta: z.object({ current_page: z.number().int(), last_page: z.number().int() }).partial().nullable().optional(),
  });

export const stationsResponse = collection(stationSchema);
export const fuelProductsResponse = collection(fuelProductSchema);
export const pumpsResponse = collection(pumpSchema);
export const nozzlesResponse = collection(nozzleSchema);
export const tanksResponse = collection(tankSchema);
export const pricesResponse = paginated(priceSchema);
export const shiftsResponse = paginated(shiftSchema);

export type Station = z.infer<typeof stationSchema>;
export type FuelProduct = z.infer<typeof fuelProductSchema>;
export type Pump = z.infer<typeof pumpSchema>;
export type Nozzle = z.infer<typeof nozzleSchema>;
export type Tank = z.infer<typeof tankSchema>;
export type FuelPrice = z.infer<typeof priceSchema>;
export type Shift = z.infer<typeof shiftSchema>;
export type ShiftsPage = z.infer<typeof shiftsResponse>;
