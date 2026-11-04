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

/**
 * UI-1 — تفاصيل الوردية (`GET /fuel-stations/shifts/{id}` → `FuelShiftResource` مع العلاقات المحمَّلة).
 * القائمة لا تحمل القراءات؛ التفاصيل وحدها تحملها. المصفوفتان إلزاميتان: غيابهما ≠ «لا قراءات» (يُرفض الرد كاملاً).
 * لا نحوّل الأدلة (`evidence`) ولا الملاحظات الحرة ولا الحمولات إلى الواجهة: غير لازمة للقراءة وقد تحمل بيانات حساسة.
 */
const stage = z.enum(['opening', 'closing']);
const instant = z.string().nullable();

export const meterReadingSchema = z.object({
  id: text.min(1),
  nozzle_id: text.min(1),
  reading_stage: stage,
  meter_milliliters: z.number().int().nonnegative(),
  measured_at: instant,
});

export const tankReadingSchema = z.object({
  id: text.min(1),
  tank_id: text.min(1),
  reading_stage: stage,
  reading_type: text,
  quantity_milliliters: z.number().int().nonnegative(),
  measured_at: instant,
});

export const shiftDetailSchema = shiftSchema.extend({
  branch_id: nullableText,
  counted_cash_minor: z.number().int().nullable().optional(),
  expected_operational_cash_minor: z.number().int().nullable().optional(),
  operational_meter_milliliters: z.number().int().nonnegative(),
  locked_at: nullableText,
  meter_readings: z.array(meterReadingSchema),
  tank_readings: z.array(tankReadingSchema),
  staff_assignments: z.array(z.object({ user_id: text.min(1) })).optional(),
  cash_variance: z.object({ status: text, variance_direction: nullableText }).nullable().optional(),
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
export const shiftDetailResponse = z.object({ data: shiftDetailSchema });

export type Station = z.infer<typeof stationSchema>;
export type FuelProduct = z.infer<typeof fuelProductSchema>;
export type Pump = z.infer<typeof pumpSchema>;
export type Nozzle = z.infer<typeof nozzleSchema>;
export type Tank = z.infer<typeof tankSchema>;
export type FuelPrice = z.infer<typeof priceSchema>;
export type Shift = z.infer<typeof shiftSchema>;
export type ShiftsPage = z.infer<typeof shiftsResponse>;
export type MeterReading = z.infer<typeof meterReadingSchema>;
export type TankReading = z.infer<typeof tankReadingSchema>;
export type ShiftDetail = z.infer<typeof shiftDetailSchema>;
