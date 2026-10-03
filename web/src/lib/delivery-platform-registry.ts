/**
 * سجل عرض منصات التوصيل — المصدر الوحيد للاسم والشعار.
 *
 * شعارات المنصات الست هي الأيقونات الرسمية الحالية التي نشرها صاحب العلامة
 * على App Store في 2026-10-03. لم تُرسم ولم تُلوَّن ولم تُغيَّر نسبتها.
 * Brandfetch وSimple Icons وبحث الصور ليست مصدراً. الحرف المحايد يظهر فقط
 * لمنصة غير معروفة أو إذا فشل تحميل الأصل.
 */
export interface DeliveryPlatformPresentation {
  key: string;
  nameAr: string;
  nameEn: string;
  /** مسار الأصل الرسمي داخل التطبيق، أو null عند علامة AWJ المحايدة. */
  logoSrc: string | null;
  fallback: 'monogram';
  monogram: string;
}

export interface DeliveryPlatformLogoProvenance {
  key: string;
  file: string;
  publisher: string;
  source: string;
}

export const DELIVERY_PLATFORM_LOGO_POLICY =
  'The six canonical platforms use the publisher App Store icon committed in web/public/delivery-platforms. The file is not redrawn, recolored, or cropped. A monogram is only for an unknown platform or a failed asset.';

export const DELIVERY_PLATFORM_LOGO_PROVENANCE: readonly DeliveryPlatformLogoProvenance[] = [
  {
    key: 'hungerstation',
    file: 'hungerstation.png',
    publisher: 'HungerStation LLC',
    source: 'https://apps.apple.com/sa/app/hungerstation-food-delivery/id596011949',
  },
  {
    key: 'jahez',
    file: 'jahez.png',
    publisher: 'Jahez International Information Systems Technology Company Limited Liability',
    source: 'https://apps.apple.com/sa/app/jahez-%D8%AC%D8%A7%D9%87%D8%B2/id1137352156',
  },
  {
    key: 'mrsool',
    file: 'mrsool.png',
    publisher: 'MRSOOL',
    source: 'https://apps.apple.com/sa/app/mrsool-app-%D8%AA%D8%B7%D8%A8%D9%8A%D9%82-%D9%85%D8%B1%D8%B3%D9%88%D9%84/id1040038773',
  },
  {
    key: 'keeta',
    file: 'keeta.png',
    publisher: 'Kangaroo Limited',
    source: 'https://apps.apple.com/sa/app/keeta-food-delivery/id1662451643',
  },
  {
    key: 'ninja',
    file: 'ninja.png',
    publisher: 'TECH-ADVANCE FOR INFORMATION TECHNOLOGY CO',
    source: 'https://apps.apple.com/sa/app/ninja-%D9%86%D9%8A%D9%86%D8%AC%D8%A7/id1620153149',
  },
  {
    key: 'the_chefz',
    file: 'the-chefz.png',
    publisher: 'The Chefz',
    source: 'https://apps.apple.com/sa/app/the-chefz-gathering-delivery/id1139450244',
  },
];

const PROVENANCE_BY_KEY = new Map(DELIVERY_PLATFORM_LOGO_PROVENANCE.map((row) => [row.key, row]));

function officialLogo(key: string): string {
  const row = PROVENANCE_BY_KEY.get(key);
  if (!row) throw new Error(`Missing official logo for ${key}`);
  return `/delivery-platforms/${row.file}`;
}

const PLATFORMS: readonly DeliveryPlatformPresentation[] = [
  { key: 'hungerstation', nameAr: 'هنقرستيشن', nameEn: 'HungerStation', logoSrc: officialLogo('hungerstation'), fallback: 'monogram', monogram: 'H' },
  { key: 'jahez', nameAr: 'جاهز', nameEn: 'Jahez', logoSrc: officialLogo('jahez'), fallback: 'monogram', monogram: 'J' },
  { key: 'mrsool', nameAr: 'مرسول', nameEn: 'Mrsool', logoSrc: officialLogo('mrsool'), fallback: 'monogram', monogram: 'M' },
  { key: 'keeta', nameAr: 'كيتا', nameEn: 'Keeta', logoSrc: officialLogo('keeta'), fallback: 'monogram', monogram: 'K' },
  { key: 'ninja', nameAr: 'نينجا', nameEn: 'Ninja', logoSrc: officialLogo('ninja'), fallback: 'monogram', monogram: 'N' },
  { key: 'the_chefz', nameAr: 'ذا شيفز', nameEn: 'The Chefz', logoSrc: officialLogo('the_chefz'), fallback: 'monogram', monogram: 'C' },
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
