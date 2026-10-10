/**
 * REM-01 — معاينة مبلغ المرتجع المرتبط بمصدر بالأرقام نفسها التي يرحّلها الخادم
 * (`ReturnSourceAllocator`). للمعاينة فقط: الخادم هو الحَكَم عند الترحيل.
 */

/** محصَّل سطر المصدر وما رُدَّ منه — لمعاينة المرتجع بالأرقام نفسها التي يرحّلها الخادم. */
export interface SourceCharge {
  soldQty: number; returnedQty: number; unitPrice: number;
  net: number; tax: number; remainingNet: number; remainingTax: number;
  /** سبق على السطر ردٌّ بسعر مخفَّض — فالجزء الأخير لا يأخذ «المتبقي». */
  reducedBefore?: boolean;
}
/** floor(a × b ÷ c) بلا فقد دقّة (BigInt): الأنصبة بالهللة لا تقبل تقريب float. */
function mulDiv(a: number, b: number, c: number): number {
  if (c <= 0) return 0;
  return Number((BigInt(Math.trunc(a)) * BigInt(Math.trunc(b))) / BigInt(Math.trunc(c)));
}

/**
 * مبلغ المرتجع كما سيشتقّه الخادم من سطر المصدر (`ReturnSourceAllocator`):
 * نصيب الوحدات المردودة = F(مردود + الآن) − F(مردود) مع F(n) = floor(المحصَّل × n ÷ المباع)،
 * والجزء الأخير بسعر كامل يأخذ المتبقي الفعلي (ما لم يسبق ردٌّ بسعر مخفَّض)،
 * ويخفَّض تناسبياً إن نقص السعر عن سعر البيع، ويُقيَّد بالمتبقي. للمعاينة فقط —
 * الخادم هو الحَكَم عند الترحيل.
 */
export function sourceLineAmounts(c: SourceCharge, quantity: number, priceMinor: number): { net: number; tax: number } {
  const share = (amount: number) => {
    const upTo = (n: number) => (n >= c.soldQty ? amount : mulDiv(amount, n, c.soldQty));
    return upTo(c.returnedQty + quantity) - upTo(c.returnedQty);
  };
  let net = share(c.net);
  let tax = share(c.tax);
  const fullPrice = c.unitPrice <= 0 || priceMinor >= c.unitPrice;
  if (c.returnedQty + quantity >= c.soldQty && fullPrice && !c.reducedBefore) {
    // الجزء الأخير بسعر كامل: المتبقي الفعلي (يُغلق هللات مرتجعات POS السابقة).
    net = c.remainingNet;
    tax = c.remainingTax;
  } else if (c.unitPrice > 0 && priceMinor < c.unitPrice) {
    net = mulDiv(net, Math.max(0, priceMinor), c.unitPrice);
    tax = mulDiv(tax, Math.max(0, priceMinor), c.unitPrice);
  }
  return { net: Math.min(net, c.remainingNet), tax: Math.min(tax, c.remainingTax) };
}

