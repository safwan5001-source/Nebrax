import type { EffectivePrice } from './schemas';
import { StationOpsError } from './read-client';

/**
 * السعر الفعّال لمنتج في محطة، للعرض فقط.
 *
 * **الخادم هو المصدر الوحيد** (`GET /fuel-stations/prices/effective` ← `FuelStationProductPriceService::resolve`، وهو
 * نفسه ما يُسعَّر به إنهاء البيع). لا يعيد المتصفح بناء الأولوية ولا يقرأ سجل الأسعار ولا يقيس الصلاحية بساعة الجهاز ولا يقرأ
 * سعر بطاقة المنتج. غياب السعر «غير مضبوط» وليس صفراً (شرط خروج UI-0)، والصلاحية/الاتصال/المخطط المرفوض حالات مستقلة.
 */

export type TaxMode = 'tax_inclusive' | 'tax_exclusive';

export type PriceResult =
  | {
      kind: 'known';
      minor: number;
      scope: 'station' | 'tenant';
      effectiveFrom: string | null;
      effectiveUntil: string | null;
      /** null = نمط الضريبة غير معيَّن؛ البيع الرسمي سيُرفض (`blockers` تذكره). */
      taxMode: TaxMode | null;
      /** هل يقبل الخادم بيعاً بهذا السعر الآن (سعر + ضريبة + وحدة + منتج نشط). */
      sellable: boolean;
      blockers: string[];
    }
  | { kind: 'not_configured' }
  | { kind: 'product_inactive' }
  | { kind: 'forbidden' }
  | { kind: 'error' };

export type PriceFetcher = () => Promise<EffectivePrice[]>;

const SOURCE_SCOPE: Record<string, 'station' | 'tenant'> = { station_override: 'station', tenant_default: 'tenant' };

/**
 * يحوّل صف الخادم إلى حالة عرض. أي تناقض (سعر بلا مصدر، وحدة غير اللتر، حالة غير معروفة) ⇒ `error`، لا سعر مخمَّن.
 */
export function toPriceResult(row: EffectivePrice): PriceResult {
  if (row.unit !== 'L') return { kind: 'error' }; // اللتر وحده: لا يُعرض سعر قطعة/مللتر كأنه سعر لتر
  if (row.status === 'not_configured') return { kind: 'not_configured' };
  if (row.status === 'product_inactive') return { kind: 'product_inactive' };
  if (row.status !== 'effective') return { kind: 'error' };

  const scope = row.source ? SOURCE_SCOPE[row.source] : undefined;
  if (row.price_per_liter_minor === null || !scope) return { kind: 'error' };
  const taxMode = row.tax_mode === 'tax_inclusive' || row.tax_mode === 'tax_exclusive' ? row.tax_mode : null;
  if (row.tax_mode !== null && taxMode === null) return { kind: 'error' };

  return {
    kind: 'known',
    minor: row.price_per_liter_minor,
    scope,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    taxMode,
    sellable: row.sellable,
    blockers: row.blockers,
  };
}

/**
 * يقرأ أسعار المحطة المختارة بطلب واحد ويربطها بالمنتجات المعروضة. صف محطة أخرى يُهمل (دفاع إضافي؛ الخادم هو السلطة)،
 * ومنتج بلا صف في الاستجابة ⇒ `error` (لا نعتبره «غير مضبوط» لأن الخادم لم يقل ذلك).
 */
export async function resolveStationPrices(
  fetchRows: PriceFetcher,
  stationId: string,
  productIds: readonly string[],
): Promise<Record<string, PriceResult>> {
  const fill = (result: PriceResult) => Object.fromEntries(productIds.map((id) => [id, result]));
  try {
    const rows = (await fetchRows()).filter((row) => row.fuel_station_id === stationId);
    const byProduct = new Map(rows.map((row) => [row.fuel_product_id, row]));
    return Object.fromEntries(
      productIds.map((id) => {
        const row = byProduct.get(id);
        return [id, row ? toPriceResult(row) : ({ kind: 'error' } as PriceResult)];
      }),
    );
  } catch (error) {
    if (error instanceof StationOpsError && error.kind === 'forbidden') return fill({ kind: 'forbidden' });
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return fill({ kind: 'error' });
  }
}
