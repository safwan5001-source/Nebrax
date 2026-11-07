import { z } from 'zod';

/**
 * FUEL-B5/B5.1 — مخططات استجابات استلام الوقود (مصدر الشكل: `FuelDeliveryResource` و`FuelTankReadingResource` و`FuelSupplyReceivingController`).
 * مفتاح التكلفة **يغيب** (لا يُصفَّر) لمن لا يملك `products.view_cost`، فهو اختياري هنا: غيابه ≠ صفر. `null` = لم تُسجَّل بعد (لا صفر أبداً).
 * `cost_recorded` منطقي لكل من يرى الاستلام ولا يكشف مبلغاً. أي استجابة تخالف الحقول المطلوبة تُرفض كاملةً.
 */

const text = z.string();
const nullableText = z.string().nullable().optional();
const ml = z.number().int();

const readingBlock = z
  .object({ id: text.min(1), quantity_milliliters: ml.optional(), quantity_liters: z.string().optional(), measured_at: nullableText })
  .nullable();

const ref = z.object({ id: text, name: nullableText, code: nullableText }).nullable().optional();

export const attachmentSchema = z.object({
  id: text.min(1),
  name: text,
  mime_type: nullableText,
  size: z.number().int().nonnegative(),
  uploaded_by: nullableText,
  created_at: nullableText,
});
export const attachmentsResponse = z.object({ data: z.array(attachmentSchema) });

export const deliverySchema = z.object({
  id: text.min(1),
  /** رقم الاستلام الداخلي `FD-XXXXXXXX` (≠ رقم سند المورد `delivery_note_number`). غيابه (خادم أقدم) ⇒ يُشتق من المعرّف بنفس القاعدة. */
  reference: z.string().optional(),
  /** `draft` | `approved` — الحالتان الوحيدتان في الخادم (`FuelDelivery::STATUS_*`)؛ لا حالة «مرفوض». */
  status: text,
  station_id: text.min(1),
  tank_id: text.min(1),
  fuel_product_id: text.min(1),
  warehouse_id: text.min(1),
  supplier_id: text.min(1),
  purchase_reference: nullableText,
  delivery_note_number: nullableText,
  dispatched_milliliters: ml,
  received_milliliters: ml,
  transit_variance_milliliters: ml,
  /** غائب = لا صلاحية رؤية التكلفة؛ `null` = لم تُسجَّل بعد؛ رقم = هللات. */
  received_total_cost_minor: z.number().int().nonnegative().nullable().optional(),
  cost_recorded: z.boolean().optional(),
  cost_recorded_by: nullableText,
  cost_recorded_at: nullableText,
  attachments_count: z.number().int().nonnegative().optional(),
  attachments: z.array(z.lazy(() => attachmentSchema)).optional(),
  stock_movement_id: nullableText,
  received_at: nullableText,
  approved_at: nullableText,
  approved_by: nullableText,
  notes: nullableText,
  created_at: nullableText,
  created_by: nullableText,
  tanker_identifier: nullableText,
  driver_name: nullableText,
  temperature_milli_celsius: ml.nullable().optional(),
  density_kg_per_m3: ml.nullable().optional(),
  supplier: z.object({ id: text, name: nullableText, code: nullableText }).nullable().optional(),
  tank: ref,
  warehouse: ref,
  readings: z
    .object({ before_physical: readingBlock, after_physical: readingBlock, before_atg: readingBlock, after_atg: readingBlock })
    .optional(),
});

export const deliveriesResponse = z.object({
  data: z.array(deliverySchema),
  meta: z.object({ current_page: z.number().int(), last_page: z.number().int() }).partial().nullable().optional(),
});
export const deliveryResponse = z.object({ data: deliverySchema });

export const supplierSchema = z.object({ id: text.min(1), name: text, code: nullableText });
export const suppliersResponse = z.object({ data: z.array(supplierSchema) });

export const readingSchema = z.object({
  id: text.min(1),
  fuel_tank_id: text.min(1),
  reading_type: text,
  quantity_milliliters: ml,
  evidence_key: text,
  measured_at: nullableText,
});
export const readingsResponse = z.object({ data: z.array(readingSchema) });
export const readingResponse = z.object({ data: readingSchema });

/** المحطة مع مخزنها (`FuelStationResource` يحمّل `warehouse` في قائمة المحطات). */
export const stationWithWarehouseSchema = z.object({
  id: text.min(1),
  name: text,
  code: text,
  status: text,
  branch_id: nullableText,
  warehouse_id: nullableText,
  warehouse: z.object({ id: nullableText, name: nullableText, code: nullableText }).nullable().optional(),
});
export const stationsWithWarehouseResponse = z.object({ data: z.array(stationWithWarehouseSchema) });

// ───────────────────────── السند والكشف (B5.1) ─────────────────────────

const dec = z.string(); // لترات كنص (الخادم: عشري بلا أصفار زائدة) — لا float.
const company = z.object({ name: nullableText, vat_number: nullableText, cr_number: nullableText, currency: text });
const docReading = z.object({ liters: dec, measured_at: nullableText }).nullable();

export const receiptDocumentSchema = z.object({
  variant: z.enum(['operational', 'financial']),
  generated_at: text,
  generated_by: nullableText,
  company,
  station: z.object({ code: nullableText, name: nullableText, city: nullableText, address: nullableText }).nullable(),
  reference: text,
  status: text,
  delivery_note_number: nullableText,
  purchase_reference: nullableText,
  supplier: z.object({ name: nullableText, code: nullableText }).nullable(),
  product: z.object({ code: nullableText, name: nullableText }).nullable(),
  tank: z.object({ code: nullableText, name: nullableText }).nullable(),
  warehouse: z.object({ code: nullableText, name: nullableText }).nullable(),
  tanker_identifier: nullableText,
  driver_name: nullableText,
  temperature_milli_celsius: ml.nullable().optional(),
  density_kg_per_m3: ml.nullable().optional(),
  quantities: z.object({ dispatched_liters: dec, received_liters: dec, transit_variance_liters: dec, transit_variance_percent: dec.nullable() }),
  readings: z.object({ before_physical: docReading, after_physical: docReading, before_atg: docReading, after_atg: docReading }),
  received_at: nullableText,
  received_by: nullableText,
  approved_by: nullableText,
  approved_at: nullableText,
  notes: nullableText,
  attachments: z.array(z.object({ name: text, mime_type: nullableText, size: z.number().int() })),
  /** يغيب كاملاً في النسخة التشغيلية. */
  cost: z
    .object({ currency: text, total_minor: z.number().int().nonnegative().nullable(), per_liter: dec.nullable(), recorded_by: nullableText, recorded_at: nullableText })
    .optional(),
});
export const receiptDocumentResponse = z.object({ data: receiptDocumentSchema });

export const reportRowSchema = z.object({
  reference: text,
  received_at: nullableText,
  status: text,
  delivery_note_number: nullableText,
  station: nullableText,
  supplier: nullableText,
  product: nullableText,
  tank: nullableText,
  dispatched_liters: dec,
  received_liters: dec,
  transit_variance_liters: dec,
  total_cost_minor: z.number().int().nonnegative().nullable().optional(),
});
export const receiptReportSchema = z.object({
  variant: z.enum(['operational', 'financial']),
  generated_at: text,
  generated_by: nullableText,
  company,
  filters: z.record(z.string(), z.unknown()).or(z.array(z.never())),
  truncated: z.boolean(),
  rows: z.array(reportRowSchema),
  totals: z.object({
    count: z.number().int(),
    dispatched_liters: dec,
    received_liters: dec,
    transit_variance_liters: dec,
    total_cost_minor: z.number().int().optional(),
    uncosted_count: z.number().int().optional(),
  }),
});
export const receiptReportResponse = z.object({ data: receiptReportSchema });

export type Attachment = z.infer<typeof attachmentSchema>;
export type ReceiptDocument = z.infer<typeof receiptDocumentSchema>;
export type ReceiptReport = z.infer<typeof receiptReportSchema>;
export type Delivery = z.infer<typeof deliverySchema>;
export type Supplier = z.infer<typeof supplierSchema>;
export type TankReading = z.infer<typeof readingSchema>;
export type StationWithWarehouse = z.infer<typeof stationWithWarehouseSchema>;
