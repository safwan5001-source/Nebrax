import type { FuelPrice } from './schemas';
import { StationOpsError } from './read-client';

/**
 * UI-0 — السعر الفعّال لمنتج في محطة، للعرض فقط.
 *
 * يعكس ترتيب الخادم في `FuelStationProductPriceService::effective`: سعر المحطة أولاً ثم الافتراضي على مستوى
 * المستأجر (`fuel_station_id = null`)؛ وغياب كليهما = «غير مضبوط» وليس صفراً (شرط خروج UI-0). الخادم يبقى
 * السلطة وقت البيع؛ وقت العميل هنا لأغراض العرض فقط.
 *
 * فجوة موثّقة في الـAPI: `GET /fuel-stations/prices` لا يقيّد الصفوف بمحطات المستخدم ولا يمكنه طلب الافتراضي
 * وحده. لذلك نسأل بمرشح `station_id` أولاً (لا نلمس بيانات محطات أخرى في الحالة الشائعة)، ولا ننتقل إلى استعلام
 * المنتج كله إلا لغياب سعر المحطة، ثم **نُسقط فوراً** أي صف لا يخص المحطة المختارة أو الافتراضي العام.
 */

export type PriceResult =
  | { kind: 'known'; minor: number; scope: 'station' | 'tenant'; effectiveFrom: string }
  | { kind: 'not_configured' }
  | { kind: 'incomplete' }
  | { kind: 'forbidden' }
  | { kind: 'error' };

export type PricePage = { data: FuelPrice[]; meta?: { current_page?: number; last_page?: number } | null };
export type PriceQuery = { fuel_product_id: string; station_id?: string; page: number };
export type PriceFetcher = (query: PriceQuery) => Promise<PricePage>;

/** سقف الصفحات المقروءة للمنتج (50 صفاً لكل صفحة) قبل الإقرار بأن الاستعلام ناقص. */
export const MAX_PRICE_PAGES = 6;

function isEffective(row: FuelPrice, at: number): boolean {
  if (row.status !== 'active') return false;
  const from = Date.parse(row.effective_from);
  if (Number.isNaN(from) || from > at) return false;
  if (row.effective_until === null) return true;
  const until = Date.parse(row.effective_until);
  return !Number.isNaN(until) && until > at;
}

function newest(rows: FuelPrice[]): FuelPrice | null {
  return rows.reduce<FuelPrice | null>(
    (best, row) => (best === null || Date.parse(row.effective_from) > Date.parse(best.effective_from) ? row : best),
    null,
  );
}

/** دالة نقية: تختار السعر الفعّال من صفوف جُلبت. صفوف محطات أخرى تُهمل دائماً. */
export function pickEffectivePrice(rows: FuelPrice[], stationId: string, productId: string, at: number): PriceResult {
  const candidates = rows.filter((row) => row.fuel_product_id === productId && isEffective(row, at));
  const station = newest(candidates.filter((row) => row.fuel_station_id === stationId));
  if (station) return { kind: 'known', minor: station.price_per_liter_minor, scope: 'station', effectiveFrom: station.effective_from };
  const tenant = newest(candidates.filter((row) => row.fuel_station_id === null));
  if (tenant) return { kind: 'known', minor: tenant.price_per_liter_minor, scope: 'tenant', effectiveFrom: tenant.effective_from };
  return { kind: 'not_configured' };
}

/** يمشي الصفحات حتى النهاية أو السقف؛ `complete = false` إن توقف عند السقف. */
async function collect(fetchPage: PriceFetcher, base: Omit<PriceQuery, 'page'>, keep: (row: FuelPrice) => boolean) {
  const rows: FuelPrice[] = [];
  for (let page = 1; page <= MAX_PRICE_PAGES; page += 1) {
    const result = await fetchPage({ ...base, page });
    rows.push(...result.data.filter(keep));
    const last = result.meta?.last_page;
    if (last === undefined || page >= last) return { rows, complete: true };
  }
  return { rows, complete: false };
}

export async function resolveProductPrice(
  fetchPage: PriceFetcher,
  stationId: string,
  productId: string,
  now: number = Date.now(),
): Promise<PriceResult> {
  try {
    const stationRows = await collect(fetchPage, { fuel_product_id: productId, station_id: stationId }, (row) => row.fuel_station_id === stationId);
    const stationPick = pickEffectivePrice(stationRows.rows, stationId, productId, now);
    if (stationPick.kind === 'known') return stationPick;
    if (!stationRows.complete) return { kind: 'incomplete' };

    const tenantRows = await collect(fetchPage, { fuel_product_id: productId }, (row) => row.fuel_station_id === null);
    const tenantPick = pickEffectivePrice(tenantRows.rows, stationId, productId, now);
    if (tenantPick.kind === 'known') return tenantPick;
    return tenantRows.complete ? { kind: 'not_configured' } : { kind: 'incomplete' };
  } catch (error) {
    if (error instanceof StationOpsError && error.kind === 'forbidden') return { kind: 'forbidden' };
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return { kind: 'error' };
  }
}
