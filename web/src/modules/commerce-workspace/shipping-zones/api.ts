import { api } from '@/lib/api';
import type { ZoneMatchType, ZonePayload } from './form';

/**
 * COPS-H4-2 — قراءة/كتابة مناطق الشحن فوق الـAPI القائم (`commerce/workspace/shipping-zones`، صلاحية `commerce.manage`).
 * **لا استدعاء حذف هنا عمداً** (D-H4-09): حذف المنطقة يُسقط نوافذ التوصيل المقيَّدة بها (`cascadeOnDelete`)، فلا يُعرض في الواجهة
 * قبل قرار وحساب أثر. التعطيل `is_active=false` عكوس ويؤدي وظيفة «إيقاف المنطقة». يحرس ذلك `shipping-zones-no-delete.test.ts`.
 */
export const SHIPPING_ZONES_PATH = '/commerce/workspace/shipping-zones';

export type ShippingZone = {
  id: string;
  name: string;
  matchType: ZoneMatchType;
  matchValue: string;
  /** هللات كما خزّنها الخادم. */
  rateMinor: number;
  isActive: boolean;
};

type Raw = Record<string, unknown>;

/** تحويل متسامح: صف مشوَّه يُسقط ولا يُخترع له معنى (لا يُقرأ «نشط» إلا بتصريح الخادم). */
export function mapShippingZone(raw: unknown): ShippingZone | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Raw;
  const matchType = row.match_type;
  if (
    typeof row.id !== 'string' ||
    typeof row.name !== 'string' ||
    (matchType !== 'city' && matchType !== 'region') ||
    typeof row.match_value !== 'string' ||
    typeof row.rate_amount_minor !== 'number' ||
    !Number.isInteger(row.rate_amount_minor)
  ) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    matchType,
    matchValue: row.match_value,
    rateMinor: row.rate_amount_minor,
    isActive: row.is_active === true,
  };
}

export function mapShippingZones(payload: unknown): ShippingZone[] {
  const rows = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return [];

  return rows.map(mapShippingZone).filter((zone): zone is ShippingZone => zone !== null);
}

export async function fetchShippingZones(): Promise<ShippingZone[]> {
  return mapShippingZones(await api<unknown>(SHIPPING_ZONES_PATH));
}

async function writeZone(path: string, method: 'POST' | 'PUT', payload: ZonePayload): Promise<ShippingZone> {
  const response = await api<{ data?: unknown }>(path, { method, body: payload });
  const zone = mapShippingZone(response?.data);
  if (!zone) throw new Error('shipping zone response not recognised');

  return zone;
}

export function createShippingZone(payload: ZonePayload): Promise<ShippingZone> {
  return writeZone(SHIPPING_ZONES_PATH, 'POST', payload);
}

/** الخادم يطلب الجسم كاملاً (PUT)؛ تبديل الحالة يُرسل القيم الحالية مع `is_active` الجديد. */
export function updateShippingZone(id: string, payload: ZonePayload): Promise<ShippingZone> {
  return writeZone(`${SHIPPING_ZONES_PATH}/${encodeURIComponent(id)}`, 'PUT', payload);
}

export function zoneToPayload(zone: ShippingZone, overrides: Partial<ZonePayload> = {}): ZonePayload {
  return {
    name: zone.name,
    match_type: zone.matchType,
    match_value: zone.matchValue,
    rate_amount_minor: zone.rateMinor,
    is_active: zone.isActive,
    ...overrides,
  };
}
