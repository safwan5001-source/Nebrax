import { api } from '@/lib/api';

/** `GET /commerce/workspace/shipping-zones` (permission `commerce.manage`) — read-only, tenant-wide. */
export const SHIPPING_ZONES_PATH = '/commerce/workspace/shipping-zones';

export type ShippingZoneRow = {
  id: string;
  name: string;
  matchType: string;
  matchValue: string;
  /** Minor units, exactly as stored by the server. */
  rateMinor: number | null;
  isActive: boolean;
};

type Raw = {
  id?: unknown;
  name?: unknown;
  match_type?: unknown;
  match_value?: unknown;
  rate_amount_minor?: unknown;
  is_active?: unknown;
};

export function mapShippingZones(payload: unknown): ShippingZoneRow[] {
  const rows = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return [];
  const out: ShippingZoneRow[] = [];
  for (const raw of rows as Raw[]) {
    if (typeof raw?.id !== 'string' || typeof raw.name !== 'string') continue;
    out.push({
      id: raw.id,
      name: raw.name,
      matchType: typeof raw.match_type === 'string' ? raw.match_type : '',
      matchValue: typeof raw.match_value === 'string' ? raw.match_value : '',
      rateMinor: typeof raw.rate_amount_minor === 'number' ? raw.rate_amount_minor : null,
      isActive: raw.is_active !== false,
    });
  }
  return out;
}

export async function fetchShippingZones(): Promise<ShippingZoneRow[]> {
  return mapShippingZones(await api<unknown>(SHIPPING_ZONES_PATH));
}
