import { z } from 'zod';
import { cashSummarySchema } from './cash-summary';

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
  /**
   * TANK-LEVEL-P2 — عقد الرصيد الدفتري (`FuelTankBookBalanceReader`). يعبران كـ`unknown` عمداً ويُتحقَّق منهما في
   * `tank-book-level.ts`: حقل فاسد في بطاقة واحدة لا يجوز أن يرفض استجابة الخزانات كلها. الغياب (خادم أقدم) مقبول.
   */
  book_level: z.unknown().optional(),
  book_level_unavailable_reason: z.unknown().optional(),
});

/**
 * السعر الفعّال لمنتج في محطة — صف `GET /fuel-stations/prices/effective` (الخادم يحسم الزمن والأولوية والضريبة).
 * `status`/`source`/`tax_mode` نصوص متسامحة؛ القيم غير المعروفة تُعامل «تعذّر» في `prices.ts` لا سعراً.
 */
export const effectivePriceSchema = z.object({
  fuel_product_id: text.min(1),
  fuel_station_id: text.min(1),
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

/**
 * UI-2 — حركات النقد التشغيلية في الوردية (`FuelShiftResource.cash_movements`). `type` نص مفتوح: نوع غير معروف لا يُسقط
 * الاستجابة لكن يجعل «المتوقع» غير متاح (لا نجمع ما لا نعرف إشارته). `reason` نص حرّ كتبه الموظف وقد يحمل بيانات؛ يُعرض فقط.
 */
export const cashMovementSchema = z.object({
  id: text.min(1),
  type: z.string(),
  amount_minor: z.number().int().nonnegative(),
  reason: nullableText,
  recorded_at: instant,
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
  cash_movements: z.array(cashMovementSchema).optional(),
  cash_variance: z.object({ status: text, variance_direction: nullableText, reviewed_at: nullableText, reviewed_by: nullableText }).nullable().optional(),
  /** من فتح/أغلق/اعتمد (معرّفات فقط): تُستعمل في شاشة مراجعة المشرف لقاعدة «مشرف مختلف عن فاتح الوردية» ولا تُعرض أسماء مخمَّنة. */
  opened_by: nullableText,
  closed_by: nullableText,
  approved_by: nullableText,
  /** سجل أحداث الوردية (تدقيق append-only). الحمولة حرّة فلا تُعرض منها إلا `note` النصية لمراجعات المشرف. */
  events: z.array(z.object({ id: text.min(1), type: text, actor_id: nullableText, occurred_at: nullableText, payload: z.record(z.unknown()).nullish() })).optional(),
  /** #2021: ملخص النقد من الخادم (D1/D2/D5)؛ غيابه = خادم أقدم ⇒ يبقى قسم النقد القديم. */
  cash_summary: cashSummarySchema.nullish(),
});

/**
 * UI-2 — سياسة الوردية للمحطة (`GET /fuel-stations/stations/{id}/settings` → مفاتيح `shift_*`). كل مفتاح اختياري هنا: غياب
 * مفتاح أو فشل القراءة يعني «غير معروف» فتُفترض السياسة الصارمة (انظر `policy.ts`) ولا يُحجب شيء بناءً على تخمين.
 */
export const stationSettingsResponse = z.object({
  data: z
    .object({
      shift_opening_meter_reading_required: z.boolean().optional(),
      shift_opening_tank_reading_required: z.boolean().optional(),
      shift_opening_cash_float_required: z.boolean().optional(),
      shift_closing_meter_reading_required: z.boolean().optional(),
      shift_closing_tank_reading_required: z.boolean().optional(),
      shift_mandatory_staff_assignment: z.boolean().optional(),
      shift_mandatory_cash_count: z.boolean().optional(),
      shift_supervisor_approval_required: z.boolean().optional(),
      shift_allow_close_with_pending_cash_variance: z.boolean().optional(),
    })
    .passthrough(),
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
export const effectivePricesResponse = collection(effectivePriceSchema);
export const shiftsResponse = paginated(shiftSchema);
export const shiftDetailResponse = z.object({ data: shiftDetailSchema });

export type Station = z.infer<typeof stationSchema>;
export type FuelProduct = z.infer<typeof fuelProductSchema>;
export type Pump = z.infer<typeof pumpSchema>;
export type Nozzle = z.infer<typeof nozzleSchema>;
export type Tank = z.infer<typeof tankSchema>;
export type EffectivePrice = z.infer<typeof effectivePriceSchema>;
export type Shift = z.infer<typeof shiftSchema>;
export type ShiftsPage = z.infer<typeof shiftsResponse>;
export type MeterReading = z.infer<typeof meterReadingSchema>;
export type TankReading = z.infer<typeof tankReadingSchema>;
export type ShiftDetail = z.infer<typeof shiftDetailSchema>;
export type CashMovement = z.infer<typeof cashMovementSchema>;
export type StationSettings = z.infer<typeof stationSettingsResponse>['data'];
