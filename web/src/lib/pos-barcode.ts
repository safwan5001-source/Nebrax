import type { PosCartLine } from '@/components/pos/use-pos-active-carts';

export interface PosBarcodeDefinition {
  code: string;
  unit_name: string;
  default_quantity: number;
  /** VAR-POS-1: المتغيّر الفعلي الذي يحدِّده هذا الباركود — فارغ لمنتجٍ بسيط. */
  product_variant_id?: string | null;
}

export interface PosVariantDefinition {
  id: string;
  sku: string | null;
  descriptor: string | null;
  price: string;
  /** VAR-FU-5/GAP-06: نفس هويّة الصورة التي يعرضها اختيار المتغيّر يدوياً —
   *  كلا المسارين يقرآن من `pos_variants` نفسها، فلا حلٌّ مستقلٌّ هنا. */
  image?: { download_url: string } | null;
}

export interface PosBarcodeProduct {
  sku: string | null;
  barcode: string | null;
  pos_barcodes: PosBarcodeDefinition[];
  /** VAR-POS-1: متغيّرات المنتج النشطة — فارغة لمنتجٍ بسيط. */
  pos_variants?: PosVariantDefinition[];
}

export interface PosBarcodeMatch<TProduct extends PosBarcodeProduct> {
  product: TProduct;
  unitName: string | null;
  quantity: number;
  kind: 'base' | 'alternate';
  /** VAR-POS-1: المتغيّر المحلول من الباركود — `undefined` يعني «غير محدَّد بعد». */
  variant?: PosVariantDefinition | null;
}

/**
 * يطابق بصرامة سلوك POS السابق: SKU/الباركود الأساسي لوحدة الأساس، ثم الباركود
 * البديل بوحدته وكميته المعرّفتين من الخادم. لا يتخذ أي قرار تسعير أو مخزون —
 * التحقق والسعر الملزمان النهائيان دوماً من `PosService`/`InvoiceService`
 * الخادميين عند الإتمام، بصرف النظر عمّا تطابقه هذه الدالة محلياً.
 *
 * VAR-POS-1: باركودٌ بديل يحمل `product_variant_id` يحدِّد المتغيّر مباشرة —
 * منتجٌ متعدد الخيارات بلا باركودٍ يحدِّد متغيّراً فعلياً **لا يُطابَق إطلاقاً**
 * (لا مسار بيع غامض على الأب)؛ الباركود الأساسي/SKU لمنتجٍ كهذا مرفوضٌ لنفس السبب.
 */
export function matchPosBarcode<TProduct extends PosBarcodeProduct>(
  products: TProduct[],
  rawCode: string,
): PosBarcodeMatch<TProduct> | null {
  const code = rawCode.trim();
  if (!code) return null;

  const isVariantManaged = (product: TProduct) => (product.pos_variants?.length ?? 0) > 0;

  const base = products.find((product) => (
    !isVariantManaged(product)
    && ((product.sku ?? '').trim() === code || (product.barcode ?? '').trim() === code)
  ));
  if (base) return { product: base, unitName: null, quantity: 1, kind: 'base' };

  for (const product of products) {
    const alternate = product.pos_barcodes.find((barcode) => barcode.code.trim() === code);
    if (!alternate) continue;

    if (isVariantManaged(product)) {
      const variant = product.pos_variants?.find((v) => v.id === alternate.product_variant_id) ?? null;
      if (!variant) continue; // باركودٌ لا يحدِّد متغيّراً فعلياً على منتجٍ متعدد الخيارات — غير قابلٍ للمطابقة.

      return { product, unitName: alternate.unit_name, quantity: alternate.default_quantity, kind: 'alternate', variant };
    }

    return { product, unitName: alternate.unit_name, quantity: alternate.default_quantity, kind: 'alternate' };
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
 *
 * VAR-POS-1: هويّة السطر الآن (منتج + متغيّرٌ اختياري + وحدة) — أسود/كبير +
 * قطعة ليس نفس أبيض/صغير + قطعة، ولا نفس أسود/كبير + كرتون. منتجٌ بسيط
 * (`variant` غائب) يحتفظ بالسلوك السابق حرفياً (منتج + وحدة فقط).
 */
export function appendPosCartProduct(
  cart: PosCartLine[],
  product: PosCartProduct,
  unit: PosCartUnit,
  quantity = 1,
  variant?: PosVariantDefinition | null,
): PosCartLine[] {
  const normalizedQuantity = Number.isInteger(quantity) && quantity >= 1 && quantity <= 1_000_000
    ? quantity
    : 1;
  const variantId = variant?.id ?? null;
  const existing = cart.find((line) => (
    line.productId === product.id && line.unit === unit.name && (line.productVariantId ?? null) === variantId
  ));

  if (existing) {
    return cart.map((line) => (
      line.key === existing.key ? { ...line, qty: line.qty + normalizedQuantity } : line
    ));
  }

  return [
    ...cart,
    {
      key: `${product.id}:${variantId ?? '-'}:${unit.name}`,
      productId: product.id,
      productVariantId: variantId,
      variantDescriptor: variant?.descriptor ?? null,
      description: variant?.descriptor ? `${product.name} — ${variant.descriptor}` : product.name,
      sku: variant?.sku ?? product.sku,
      unit: unit.name,
      price: variant ? variant.price : unit.price,
      qty: normalizedQuantity,
      tax: product.tax_rate,
      discount: '',
    },
  ];
}
