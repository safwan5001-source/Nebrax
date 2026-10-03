/**
 * سجل عرض منصات التوصيل — المصدر الوحيد للاسم والعلامة.
 *
 * لا يُلتزم بشعار رسمي: إرشادات جاهز تشترط الملف الأصلي وتمنع إعادة الرسم،
 * ونص حقوق جاهز يمنع إعادة النشر. وسم Wikimedia لهنقرستيشن علامة تجارية.
 * لا رخصة إعادة توزيع مؤكدة لمرسول أو كيتا أو نينجا أو ذا شيفز.
 * Brandfetch وبحث الصور ليسا ترخيصاً. الحرف المحايد ليس الشعار.
 * الاسم الظاهر يبقى المعرّف المقروء دائماً.
 */
export interface DeliveryPlatformPresentation {
  key: string;
  nameAr: string;
  nameEn: string;
  /** مسار أصل مرخّص داخل التطبيق، أو null عند علامة AWJ المحايدة. */
  logoSrc: string | null;
  fallback: 'monogram';
  monogram: string;
}

export const DELIVERY_PLATFORM_LOGO_POLICY =
  'No official logo is committed. Brand masters are not licensed for redistribution in this repository, and a generated or searched image is not a substitute.';

const PLATFORMS: readonly DeliveryPlatformPresentation[] = [
  { key: 'hungerstation', nameAr: 'هنقرستيشن', nameEn: 'HungerStation', logoSrc: null, fallback: 'monogram', monogram: 'H' },
  { key: 'jahez', nameAr: 'جاهز', nameEn: 'Jahez', logoSrc: null, fallback: 'monogram', monogram: 'J' },
  { key: 'mrsool', nameAr: 'مرسول', nameEn: 'Mrsool', logoSrc: null, fallback: 'monogram', monogram: 'M' },
  { key: 'keeta', nameAr: 'كيتا', nameEn: 'Keeta', logoSrc: null, fallback: 'monogram', monogram: 'K' },
  { key: 'ninja', nameAr: 'نينجا', nameEn: 'Ninja', logoSrc: null, fallback: 'monogram', monogram: 'N' },
  { key: 'the_chefz', nameAr: 'ذا شيفز', nameEn: 'The Chefz', logoSrc: null, fallback: 'monogram', monogram: 'C' },
];

const BY_KEY = new Map(PLATFORMS.map((platform) => [platform.key, platform]));

export function deliveryPlatformPresentations(): readonly DeliveryPlatformPresentation[] {
  return PLATFORMS;
}

export function deliveryPlatformPresentation(key: string | null | undefined): DeliveryPlatformPresentation | null {
  if (!key) return null;
  return BY_KEY.get(key) ?? null;
}

export function deliveryPlatformMonogram(key: string | null | undefined, name: string): string {
  return deliveryPlatformPresentation(key)?.monogram ?? (name.trim().slice(0, 1) || '—');
}

/** الاسم المعتمد من السجل أولاً، ثم اسم الواجهة، ثم المفتاح. */
export function deliveryPlatformLabel(
  key: string | null | undefined,
  locale: string,
  fallback?: { name?: string | null; nameEn?: string | null },
): string {
  const known = deliveryPlatformPresentation(key);
  if (locale === 'en') return known?.nameEn || fallback?.nameEn || fallback?.name || key || '';
  return known?.nameAr || fallback?.name || fallback?.nameEn || key || '';
}
