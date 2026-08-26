import type { PosCartLine } from '@/components/pos/use-pos-active-carts';

export interface PosBarcodeDefinition {
  code: string;
  unit_name: string;
  default_quantity: number;
}

export interface PosBarcodeProduct {
  sku: string | null;
  barcode: string | null;
  pos_barcodes: PosBarcodeDefinition[];
}

export interface PosBarcodeMatch<TProduct extends PosBarcodeProduct> {
  product: TProduct;
  unitName: string | null;
  quantity: number;
  kind: 'base' | 'alternate';
}

/**
 * يطابق بصرامة سلوك POS السابق: SKU/الباركود الأساسي لوحدة الأساس، ثم الباركود
 * البديل بوحدته وكميته المعرّفتين من الخادم. لا يتخذ أي قرار تسعير أو مخزون.
 */
export function matchPosBarcode<TProduct extends PosBarcodeProduct>(
  products: TProduct[],
  rawCode: string,
): PosBarcodeMatch<TProduct> | null {
  const code = rawCode.trim();
  if (!code) return null;

  const base = products.find((product) => (
    (product.sku ?? '').trim() === code || (product.barcode ?? '').trim() === code
  ));
  if (base) return { product: base, unitName: null, quantity: 1, kind: 'base' };

  for (const product of products) {
    const alternate = product.pos_barcodes.find((barcode) => barcode.code.trim() === code);
    if (alternate) {
      return {
        product,
        unitName: alternate.unit_name,
        quantity: alternate.default_quantity,
        kind: 'alternate',
      };
    }
  }

  return null;
}

interface PosCartProduct {
  id: string;
  name: string;
  sku: string | null;
  tax_rate: number;
}

interface PosCartUnit {
  name: string;
  price: string;
}

/**
 * يضيف أو يزيد السطر نفسه بالمنطق السابق، منفصلاً كي يغطيه اختبار دون نقل منطق
 * الأعمال إلى طبقة الصوت أو تغيير سلوك وحدات/أسعار السلة.
 */
export function appendPosCartProduct(
  cart: PosCartLine[],
  product: PosCartProduct,
  unit: PosCartUnit,
  quantity = 1,
): PosCartLine[] {
  const normalizedQuantity = Number.isInteger(quantity) && quantity >= 1 && quantity <= 1_000_000
    ? quantity
    : 1;
  const existing = cart.find((line) => line.productId === product.id && line.unit === unit.name);

  if (existing) {
    return cart.map((line) => (
      line.key === existing.key ? { ...line, qty: line.qty + normalizedQuantity } : line
    ));
  }

  return [
    ...cart,
    {
      key: `${product.id}:${unit.name}`,
      productId: product.id,
      description: product.name,
      sku: product.sku,
      unit: unit.name,
      price: unit.price,
      qty: normalizedQuantity,
      tax: product.tax_rate,
      discount: '',
    },
  ];
}
