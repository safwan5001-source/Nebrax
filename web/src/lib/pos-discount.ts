/**
 * PR-3: تحويل نسبة الخصم المئوية إلى مبلغ هللات وبالعكس — دوال نقية بلا React.
 *
 * القيمة المعتمدة والمخزَّنة في السلة تبقى دائماً **مبلغاً ثابتاً** (`PosCartLine.discount`)
 * تماماً كما كانت قبل PR-3؛ لا عقد سلة جديد ولا حقل جديد يُحفظ أو يُستعاد. وضع
 * «النسبة %» هو مجرّد مساعد إدخال يحسب المبلغ المكافئ لحظة الكتابة عبر هذه الدالة
 * ثم يستدعي مسار `setDiscount` القائم نفسه — فيبقى التحقق والتدقيق والصلاحية
 * (`allow_discount`) والتقييد بحدّ إجمالي السطر كما هي بلا ازدواج.
 *
 * محدودية موثّقة عمداً: لا إعادة اشتقاق تلقائي للمبلغ عند تغيّر الكمية/السعر
 * لاحقاً — يتطلب ذلك تخزين النسبة كحقل سلة معتمد (تغيير عقد مالي)، وهو خارج
 * نطاق PR-3. المستخدم يعيد كتابة النسبة أو يبدّل لوضع «مبلغ ثابت» عند الحاجة.
 */

export type PosDiscountMode = 'fixed' | 'percent';

/** يحوّل نسبة مئوية إلى هللات على إجمالي سطر خام، مقيَّداً بين 0 والإجمالي. */
export function discountMinorFromPercent(grossMinor: number, percent: number): number {
  if (!Number.isFinite(grossMinor) || grossMinor <= 0) return 0;
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  const clampedPercent = Math.min(percent, 100);
  return Math.min(grossMinor, Math.round((grossMinor * clampedPercent) / 100));
}

/** يشتق النسبة المكافئة لمبلغ خصم قائم — للعرض عند التبديل إلى وضع النسبة فقط. */
export function discountPercentFromMinor(grossMinor: number, discountMinor: number): number {
  if (!Number.isFinite(grossMinor) || grossMinor <= 0) return 0;
  if (!Number.isFinite(discountMinor) || discountMinor <= 0) return 0;
  return Math.min(100, (discountMinor / grossMinor) * 100);
}
