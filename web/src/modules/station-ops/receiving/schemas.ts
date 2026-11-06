import { z } from 'zod';

/**
 * FUEL-B5 — مخططات استجابات استلام الوقود (مصدر الشكل: `FuelDeliveryResource` و`FuelTankReadingResource` و`FuelSupplyReceivingController::suppliers`).
 * مفتاح التكلفة **يغيب** (لا يُصفَّر) لمن لا يملك `products.view_cost`، فهو اختياري هنا: غيابه ≠ صفر. أي استجابة تخالف الحقول المطلوبة تُرفض كاملةً.
 */

const text = z.string();
const nullableText = z.string().nullable().optional();
const ml = z.number().int();

const readingBlock = z
  .object({ id: text.min(1), quantity_milliliters: ml.optional(), quantity_liters: z.string().optional(), measured_at: nullableText })
  .nullable();

const ref = z.object({ id: text, name: nullableText, code: nullableText }).nullable().optional();

export const deliverySchema = z.object({
  id: text.min(1),
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
  received_total_cost_minor: z.number().int().nonnegative().optional(),
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

export type Delivery = z.infer<typeof deliverySchema>;
export type Supplier = z.infer<typeof supplierSchema>;
export type TankReading = z.infer<typeof readingSchema>;
export type StationWithWarehouse = z.infer<typeof stationWithWarehouseSchema>;
