import Image from 'next/image';

/**
 * لقطات حقيقية من المنتج (وضع المعاينة ببيانات تجريبية) بنسختين لكل سمة ولغة.
 * النسخة غير المطابقة للسمة الحالية `display: none` عبر CSS فلا تُحمَّل (انظر `landing.css`)،
 * وبذلك لا حاجة لانتظار hydration لمعرفة السمة ولا إزاحة في التخطيط.
 */
export type LandingShotName =
  | 'hero-entry'
  | 'desk-invoices'
  | 'desk-journal'
  | 'desk-pos'
  | 'desk-purchases'
  | 'desk-reports'
  | 'phone-dashboard'
  | 'strip-invoice'
  | 'strip-entry'
  | 'card-invoice'
  | 'card-entry';

/** أبعاد الملف الأصلي بالبكسل (2x) لحجز المساحة؛ تتطابق عبر السمتين واللغتين. */
const SHOT_SIZE: Record<LandingShotName, readonly [number, number]> = {
  'hero-entry': [1652, 984],
  'desk-invoices': [2880, 1800],
  'desk-journal': [2880, 1800],
  'desk-pos': [2880, 1800],
  'desk-purchases': [2880, 1800],
  'desk-reports': [2880, 1800],
  'phone-dashboard': [780, 1688],
  'strip-invoice': [2332, 604],
  'strip-entry': [2332, 602],
  'card-invoice': [712, 322],
  'card-entry': [712, 306],
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
  const [width, height] = SHOT_SIZE[name];
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
