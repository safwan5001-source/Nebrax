import Image from 'next/image';

/**
 * لقطات حقيقية من المنتج (وضع المعاينة ببيانات تجريبية) بنسختين لكل سمة ولغة.
 * النسخة غير المطابقة للسمة الحالية `display: none` عبر CSS فلا تُحمَّل (انظر `landing.css`)،
 * وبذلك لا حاجة لانتظار hydration لمعرفة السمة ولا إزاحة في التخطيط.
 */
export type LandingShotName =
  | 'hero-entry'
  | 'mod-sales'
  | 'mod-pos'
  | 'mod-purchases'
  | 'mod-books'
  | 'mod-reports'
  | 'phone-dashboard'
  | 'phone-entry'
  | 'strip-invoice'
  | 'strip-entry'
  | 'card-invoice'
  | 'card-entry'
  | 'card-purchase-a'
  | 'card-purchase-b';

type ShotSize = readonly [number, number];

/** أبعاد الملف الأصلي بالبكسل (2x) لحجز المساحة؛ تتطابق عبر السمتين، وتختلف باللغة حيث يختلف ارتفاع الجدول الملتقط. */
const SHOT_SIZE: Record<LandingShotName, ShotSize | Record<'ar' | 'en', ShotSize>> = {
  'hero-entry': [1652, 808],
  'mod-sales': [2012, 880],
  'mod-pos': [2360, 1520],
  'mod-purchases': { ar: [1652, 872], en: [1652, 662] },
  'mod-books': [1652, 780],
  'mod-reports': [1752, 1120],
  'phone-dashboard': [780, 1688],
  'phone-entry': [716, 696],
  'strip-invoice': [2332, 604],
  'strip-entry': [2332, 602],
  'card-invoice': [712, 322],
  'card-entry': [712, 306],
  'card-purchase-a': [712, 322],
  'card-purchase-b': [712, 324],
};

const THEMES = ['light', 'dark'] as const;

export function landingShotSrc(name: LandingShotName, theme: (typeof THEMES)[number], locale: string): string {
  return `/landing/${name}-${theme}-${locale === 'en' ? 'en' : 'ar'}.webp`;
}

interface LandingShotProps {
  name: LandingShotName;
  locale: string;
  alt: string;
  sizes: string;
  /** صورة أول شاشة: تُحمَّل مبكراً بالنسخة الفاتحة فقط؛ الداكنة تبقى كسولة. */
  priority?: boolean;
  /** يُحمَّل فوراً بلا preload (لقطة الجوال في أول شاشة: أرخص من preload على سطح المكتب). */
  eager?: boolean;
  /** `narrow` تظهر على الجوال فقط، و`wide` تختفي عليه. بدونها تظهر دائماً. */
  view?: 'wide' | 'narrow';
}

export function LandingShot({ name, locale, alt, sizes, priority = false, eager: eagerLoad = false, view }: LandingShotProps) {
  const spec = SHOT_SIZE[name];
  const [width, height] = Array.isArray(spec) ? (spec as ShotSize) : (spec as Record<'ar' | 'en', ShotSize>)[locale === 'en' ? 'en' : 'ar'];
  return (
    <>
      {THEMES.map((theme) => {
        const preload = priority && theme === 'light';
        const eager = preload || (eagerLoad && theme === 'light');
        return (
          <Image
            key={theme}
            src={landingShotSrc(name, theme, locale)}
            width={width}
            height={height}
            alt={alt}
            sizes={sizes}
            quality={90}
            priority={preload}
            loading={preload ? undefined : eager ? 'eager' : 'lazy'}
            className={`lp-img lp-theme-${theme}${view ? ` lp-${view}` : ''}`}
          />
        );
      })}
    </>
  );
}
