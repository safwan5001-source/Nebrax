/**
 * حالة نسخة السعر **مشتقّة من تاريخ النفاذ وتاريخ اليوم فقط** — الـ API لا يعيد حقل حالة.
 *
 * القاعدة تطابق نطاق الخادم `PlatformPriceVersion::scopeEffectiveOn`: لكل (خطة، عملة) تُعدّ النسخة
 * السارية في تاريخ ما هي صاحبة أحدث `effective_on` ≤ ذلك التاريخ. ما بعد اليوم «مجدول»، وما قبل أحدث
 * سارية «سابق». لا تُعدّ نسخة مجدولة سارية قبل بلوغ تاريخها، ولا يُستنتج شيء من غير هذين الحقلين.
 *
 * `today` نص `YYYY-MM-DD`؛ مقارنته نصّية فلا حساب تواريخ ولا مناطق زمنية. المنطقة الزمنية للخادم
 * ليست جزءاً من عقد الـ API، فالواجهة تعرض هذه الحالة إرشاداً وتقول ذلك صراحةً.
 */
export interface PriceVersionLike {
  id: string;
  plan: string;
  currency: string;
  effective_on: string | null;
}

export type PriceStatus = 'current' | 'scheduled' | 'superseded' | 'unknown';

export interface PriceClassification {
  status: PriceStatus;
  /** أكثر من نسخة تشترك في تاريخ النفاذ نفسه لهذه الخطة: الواجهة لا تختار بينها. */
  tied: boolean;
}

export function todayIsoDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function classifyPriceVersions(
  prices: readonly PriceVersionLike[],
  today: string
): Map<string, PriceClassification> {
  const result = new Map<string, PriceClassification>();
  const groups = new Map<string, PriceVersionLike[]>();
  for (const price of prices) {
    if (!price.effective_on) {
      result.set(price.id, { status: 'unknown', tied: false });
      continue;
    }
    const key = `${price.plan}\u0000${price.currency}`;
    groups.set(key, [...(groups.get(key) ?? []), price]);
  }

  for (const versions of groups.values()) {
    const started = versions.filter((price) => (price.effective_on as string) <= today);
    const latest = started.reduce<string | null>(
      (max, price) => (max === null || (price.effective_on as string) > max ? (price.effective_on as string) : max),
      null
    );
    const current = started.filter((price) => price.effective_on === latest);
    for (const price of versions) {
      if ((price.effective_on as string) > today) result.set(price.id, { status: 'scheduled', tied: false });
      else if (price.effective_on === latest) result.set(price.id, { status: 'current', tied: current.length > 1 });
      else result.set(price.id, { status: 'superseded', tied: false });
    }
  }
  return result;
}

/** أقرب نسخة مجدولة (أصغر تاريخ مستقبلي) في مجموعة نسخ خطة واحدة، أو null. */
export function nextScheduled<T extends PriceVersionLike>(versions: readonly T[], today: string): T | null {
  const future = versions.filter((price) => price.effective_on !== null && price.effective_on > today);
  if (future.length === 0) return null;
  return future.reduce((min, price) => ((price.effective_on as string) < (min.effective_on as string) ? price : min));
}
