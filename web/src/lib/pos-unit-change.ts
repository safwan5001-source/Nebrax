import type { PosCartLine } from '@/lib/pos-active-cart';

export interface PosUnitChoice {
  name: string;
  price: string;
}

export interface PosUnitChangePlan {
  items: PosCartLine[];
  /** مفتاح السطر الذي يجب أن يبقى محدداً: السطر بعد إعادة كتابة المفتاح، أو سطر الدمج. */
  selectedKey: string;
}

/**
 * نفس تحويل `setUnit` السابق حرفياً.
 * يعيد مفتاح السطر الناتج لأن `setUnit` كان يبدّل `line.key` ويترك `selectedLineKey`
 * على المفتاح القديم، فيتعطّل شريط السطر (`usePosCartLineSelection` مع
 * `switchZoneToCart = false` يُبقي مفتاحاً غير موجود).
 * لا يغيّر صيغة المفتاح، ولا سعر الوحدة، ولا جمع الكميات عند الدمج.
 */
export function planPosCartUnitChange(
  items: readonly PosCartLine[],
  key: string,
  unitName: string,
  units: readonly PosUnitChoice[] | undefined,
): PosUnitChangePlan | null {
  const line = items.find((item) => item.key === key);
  if (!line || line.productId === null) return null;
  const unit = units?.find((item) => item.name === unitName);
  if (!unit || unit.name === line.unit) return null;

  const sameUnit = items.find((item) => item.key !== key && item.productId === line.productId && item.unit === unit.name);
  if (sameUnit) {
    return {
      selectedKey: sameUnit.key,
      items: items
        .filter((item) => item.key !== key)
        .map((item) => (item.key === sameUnit.key ? { ...item, qty: item.qty + line.qty } : item)),
    };
  }

  const selectedKey = `${line.productId}:${unit.name}`;
  return {
    selectedKey,
    items: items.map((item) => (item.key === key
      ? { ...item, key: selectedKey, unit: unit.name, price: unit.price }
      : item)),
  };
}
