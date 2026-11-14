import { z } from 'zod';

/**
 * TANKER-PR7 — مخططات التحقق من استجابات تعبئة الصهاريج لتطبيق المحطات (مصدر الشكل: `FuelTankerFillResource` و`FuelTankerOwnerResource` و`FuelTankerResource`).
 * نتحقق من الحقول التي تعتمد عليها الواجهة فقط؛ **أي استجابة تخالف الحقول المطلوبة تُرفض كاملةً** (`invalid_shape`) بدل عرض أرقام مشتقة من بيانات غير مفهومة.
 * لا حقول مالية هنا أصلاً (السند لا يحمل مبلغاً ولا تكلفة). الهاتف والملاحظات لا تصل جلسة الموظف (يحذفها الخادم لغير المدير).
 */

const text = z.string();
const nullableText = z.string().nullable().optional();
const wholeMl = z.number().int().nonnegative();

export const ownerSchema = z.object({
  id: text.min(1),
  name: text,
  code: nullableText,
  status: text,
});

export const tankerSchema = z.object({
  id: text.min(1),
  fuel_tanker_owner_id: text.min(1),
  plate_number: text,
  capacity_milliliters: wholeMl.nullable().optional(),
  status: text,
});

const nestedOwner = z.object({ id: text.min(1), name: text, code: nullableText });
const nestedTanker = z.object({ id: text.min(1), plate_number: text, capacity_milliliters: wholeMl.nullable().optional() });

export const fillSchema = z.object({
  id: text.min(1),
  number: text.min(1),
  voucher_number: text,
  status: text,
  inventory_status: text,
  fuel_station_id: text.min(1),
  fuel_shift_id: text.min(1),
  fuel_pump_id: text.min(1),
  fuel_nozzle_id: text.min(1),
  fuel_tank_id: text.min(1),
  fuel_product_id: text.min(1),
  fuel_tanker_owner_id: text.min(1),
  fuel_tanker_id: nullableText,
  quantity_milliliters: wholeMl,
  quantity_liters: text,
  tanker_capacity_milliliters: wholeMl.nullable().optional(),
  capacity_overrun_milliliters: wholeMl.nullable().optional(),
  recorded_by: nullableText,
  recorded_at: z.string().nullable(),
  voided_at: nullableText,
  owner: nestedOwner.nullish(),
  tanker: nestedTanker.nullish(),
  attachments_count: z.number().int().nonnegative().optional(),
});

const pageMeta = z.object({ current_page: z.number().int().optional(), last_page: z.number().int().optional(), per_page: z.number().int().optional(), total: z.number().int().optional() }).partial();

export const ownersResponse = z.object({ data: z.array(ownerSchema), meta: pageMeta.optional() });
export const tankersResponse = z.object({ data: z.array(tankerSchema), meta: pageMeta.optional() });
export const fillsResponse = z.object({ data: z.array(fillSchema), meta: pageMeta.optional() });
export const fillResponse = z.object({ data: fillSchema, meta: z.object({ replayed: z.boolean().optional() }).partial().optional() });

/** سياسة التعبئة الفعّالة للمحطة من `GET stations/{id}/settings` (الخادم يفرضها دائماً؛ الواجهة تعرضها إرشاداً فقط). الحقول غير المعروفة تُتجاهل. */
export const tankerPolicyResponse = z.object({
  data: z.object({
    tanker_selection_required: z.boolean().optional(),
    tanker_capacity_overrun_policy: z.string().optional(),
    tanker_voucher_unique_scope: z.string().optional(),
  }).passthrough(),
});

export type Owner = z.infer<typeof ownerSchema>;
export type Tanker = z.infer<typeof tankerSchema>;
export type TankerFill = z.infer<typeof fillSchema>;
