/**
 * سجل عرض منصات التوصيل — مصدر واحد للاسم والعلامة.
 *
 * لا شعار رسمي في المستودع. إرشادات العلامات (جاهز وغيرها) تشترط الملف الأصلي
 * ولا تمنح ترخيص إعادة التوزيع هنا. ملف Wikimedia لهنقرستيشن موسوم كعلامة تجارية.
 * مجموعة Keeta Network تخص كياناً آخر وليست منصة التوصيل. العلامة هنا حرف محايد
 * وليست إعادة رسم للشعار. الاسم الظاهر يبقى المعرّف المقروء.
 */
export interface DeliveryPlatformPresentation {
  key: string;
  nameAr: string;
  nameEn: string;
  logoSrc: null;
  fallback: 'monogram';
  monogram: string;
}

export const DELIVERY_PLATFORM_LOGO_POLICY =
  'No official logo is committed. Brand masters are not licensed for this repository, and a generated or searched image is not a substitute.';

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
