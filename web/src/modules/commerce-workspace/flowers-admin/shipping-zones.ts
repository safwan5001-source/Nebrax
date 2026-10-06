/**
 * FLOWERS-H2-3 — قراءة مناطق الشحن (للتاجر `commerce.manage`) لاختيار تقييد نافذة توصيل بوجهة. قراءة فقط:
 * المناطق وأسعارها سلطة `CommerceShippingZoneController`، ولا يُنسخ منها شيء. فشل القراءة يعني «لا قائمة» لا خطأً
 * قاتلاً: تبقى المنطقة المحفوظة على النافذة كما هي.
 */

import { api } from '@/lib/api';
import { adminCall, list, obj, str, type AdminResult } from './admin-http';

export type ShippingZoneOption = { id: string; name: string; isActive: boolean };

export function mapShippingZones(payload: unknown): ShippingZoneOption[] | null {
  const rows = obj(payload)?.data;
  if (!Array.isArray(rows)) return null;

  return list(rows)
    .map((raw): ShippingZoneOption | null => {
      const row = obj(raw);
      const id = str(row?.id);
      const name = str(row?.name);

      return row && id && name ? { id, name, isActive: row.is_active !== false } : null;
    })
    .filter((zone): zone is ShippingZoneOption => zone !== null);
}

export function loadShippingZones(): Promise<AdminResult<ShippingZoneOption[]>> {
  return adminCall(async () => mapShippingZones(await api<unknown>('/commerce/workspace/shipping-zones')));
}
