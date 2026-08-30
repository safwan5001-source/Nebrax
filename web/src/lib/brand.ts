export const BRAND = {
  name: {
    ar: 'أَوْج',
    en: 'AWJ',
  },
  displayName: 'أَوْج | AWJ',
} as const;

export type BrandLocale = keyof typeof BRAND.name;

export function getBrandName(locale: string): string {
  return locale === 'en' ? BRAND.name.en : BRAND.name.ar;
}
