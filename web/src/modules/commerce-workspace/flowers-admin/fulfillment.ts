/**
 * FLOWERS-H2-5 / ADR-20 / ADR-27 — عميل مخزن تنفيذ قناة المتجر. الخادم (`FulfillmentPolicyService`) هو السلطة
 * الوحيدة؛ لا يُحتسب هنا توفّرٌ ولا «يصل اليوم». الاستجابة تضم قائمة مخازن المستأجر للاختيار ضمن الصلاحية نفسها.
 */

import { api } from '@/lib/api';
import { adminCall, bool, list, obj, str, storePath, type AdminResult } from './admin-http';

export type FulfillmentWarehouse = { id: string; code: string | null; name: string; city: string | null; isActive: boolean };
export type FulfillmentDocument = { current: FulfillmentWarehouse | null; warehouses: FulfillmentWarehouse[] };

function mapWarehouse(raw: unknown): FulfillmentWarehouse | null {
  const row = obj(raw);
  const id = str(row?.id);
  const name = str(row?.name);

  return row && id && name ? { id, name, code: str(row.code), city: str(row.city), isActive: bool(row.is_active, true) } : null;
}

export function mapFulfillment(payload: unknown): FulfillmentDocument | null {
  const data = obj(obj(payload)?.data);
  const fulfillment = obj(data?.fulfillment);
  if (!data || !fulfillment || !Array.isArray(data.warehouses)) return null;

  return {
    current: mapWarehouse(fulfillment.warehouse),
    warehouses: list(data.warehouses).map(mapWarehouse).filter((w): w is FulfillmentWarehouse => w !== null),
  };
}

const path = (storeId: string) => storePath(storeId, 'fulfillment');

export function loadFulfillment(storeId: string): Promise<AdminResult<FulfillmentDocument>> {
  return adminCall(async () => mapFulfillment(await api<unknown>(path(storeId))));
}

export function saveFulfillment(storeId: string, warehouseId: string): Promise<AdminResult<FulfillmentDocument>> {
  return adminCall(async () => mapFulfillment(await api<unknown>(path(storeId), { method: 'PUT', body: { warehouse_id: warehouseId } })));
}
