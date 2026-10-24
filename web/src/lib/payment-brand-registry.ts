/**
 * سجل علامات الدفع — المصدر الوحيد لاسم العلامة وأصل شعارها ومصدره وحالة حقوق استعماله.
 *
 * لا يُرسم شعار ولا يُلوَّن ولا تُغيَّر نسبته ولا يُستعاض عنه: الأصل المحلي (`web/public/payment-brands/*`)
 * يدخل هنا فقط مع `provenance` كاملة (الناشر، رابط المصدر، بصمة SHA-256، أصل الملف، حالة الحقوق). الملف يفحصه
 * اختبار آلي (لا سكربت/صورة مضمَّنة/مرجع خارجي/DOCTYPE) وتُقارَن بصمته بالمسجَّل.
 * أصلٌ ثبت منعُ استعماله لا يدخل السجل. التقرير: `docs/plans/payments/horizon/AWJ-PAY-BRAND-LOGOS-REPORT.md`.
 */
export const PAYMENT_BRAND_KEYS = ['moyasar', 'tap', 'mada', 'visa', 'mastercard', 'apple_pay'] as const;
export type PaymentBrandKey = (typeof PAYMENT_BRAND_KEYS)[number];

/**
 * أصل الملف:
 * - `official_kit`: حزمة/صفحة علامة رسمية منشورة من صاحب العلامة بشروط استعمال معلنة.
 * - `publisher_site_asset`: شعار منشور على موقع صاحب العلامة نفسه (بلا حزمة علامة ولا شروط إعادة استعمال معلنة).
 * - `community_copy`: نسخة من مستودع عام موثوق مرخَّص برخصة مفتوحة للأرتورك، أمّا العلامة التجارية فتبقى لصاحبها.
 */
export type PaymentBrandAssetOrigin = 'official_kit' | 'publisher_site_asset' | 'community_copy';

/** `granted`: شروط الاستعمال المعلنة تتيح العرض كما هو. `unverified`: لا إذن مكتوب لدينا؛ يُستبدل بالأصل الرسمي متى حصلنا عليه. */
export type PaymentBrandRightsStatus = 'granted' | 'unverified';

export interface PaymentBrandProvenance {
  /** ناشر الأصل (صاحب العلامة أو المستودع الذي نُقل عنه). */
  publisher: string;
  /** صفحة/رابط الأصل المنقول عنه. */
  source: string;
  /** تاريخ التحقق (ISO). */
  verifiedAt: string;
  origin: PaymentBrandAssetOrigin;
  rightsStatus: PaymentBrandRightsStatus;
  /** حالة الحقوق نصاً (رخصة الأرتورك، شروط الناشر، وما لم يُتحقق منه). */
  rights: string;
  /** SHA-256 للملف المحلي كما نُقل (غير معدَّل)؛ يحرسه الاختبار. */
  sha256: string;
  /** شروط الاستعمال المنشورة (ملخص حرفي لما يقيّد العرض)، إن وُجدت. */
  terms?: string;
}

export interface PaymentBrandLogoFile {
  src: string;
  width: number;
  height: number;
  sha256: string;
}

export type PaymentBrandLogo = {
  kind: 'official';
  src: string;
  width: number;
  height: number;
  /** نسخة رسمية للوضع الداكن حين ينشرها الناشر (بدل تلوين الأصل). */
  dark?: PaymentBrandLogoFile;
  /** شعار داكن الألوان بلا نسخة داكنة: يُعرض في الوضع الداكن على سطح أبيض بدل تلوينه. */
  needsLightSurface?: boolean;
  provenance: PaymentBrandProvenance;
};

export interface PaymentBrandPresentation {
  key: PaymentBrandKey;
  nameAr: string;
  nameEn: string;
  /** مزوّد بوابة (`moyasar`, `tap`) أم وسيلة/شبكة دفع. */
  kind: 'gateway_provider' | 'method';
  logo: PaymentBrandLogo;
}

export const PAYMENT_BRAND_LOGO_POLICY =
  'Only an asset with recorded provenance and rights status is rendered as a logo. No redrawn, recolored, cropped, or substitute artwork; an asset proven prohibited is never registered.';

const SHOPIFY_ICONS_SOURCE = 'https://github.com/activemerchant/payment_icons/blob/master/app/assets/images/payment_icons';
const SHOPIFY_ICONS_RIGHTS =
  'Artwork file under the MIT licence (Shopify Inc., activemerchant/payment_icons, MIT-LICENSE); the mark itself remains the trademark of its owner. Official brand-kit copy not yet obtained — replace when received.';

const BRANDS: Readonly<Record<PaymentBrandKey, PaymentBrandPresentation>> = {
  moyasar: {
    key: 'moyasar',
    nameAr: 'ميسّر',
    nameEn: 'Moyasar',
    kind: 'gateway_provider',
    logo: {
      kind: 'official',
      src: '/payment-brands/moyasar.svg',
      width: 430,
      height: 414,
      dark: { src: '/payment-brands/moyasar-dark.svg', width: 430, height: 414, sha256: 'f3b566f5e7314a4400cdd0da22e8862beab141da5a589e995cd0aa34ea50ec6c' },
      provenance: {
        publisher: 'Moyasar',
        source: 'https://docs.moyasar.com/img/logo.svg',
        verifiedAt: '2026-10-24',
        origin: 'publisher_site_asset',
        rightsStatus: 'unverified',
        rights: "Moyasar's own logomark (light + dark variants) as published on docs.moyasar.com. No brand kit or reuse terms are published and none prohibits identifying the provider; request written confirmation via help.moyasar.com.",
        sha256: 'd6a06c3ac5e63221b65cec8b047dc18bf3d74c06f9fcbd609e02d3d899262241',
      },
    },
  },
  tap: {
    key: 'tap',
    nameAr: 'تاب',
    nameEn: 'Tap',
    kind: 'gateway_provider',
    logo: {
      kind: 'official',
      src: '/payment-brands/tap.svg',
      width: 161,
      height: 68,
      needsLightSurface: true,
      provenance: {
        publisher: 'Tap Payments',
        source: 'https://websiteimages.b-cdn.net/Logo_7de102aab6.svg',
        verifiedAt: '2026-10-24',
        origin: 'publisher_site_asset',
        rightsStatus: 'unverified',
        rights: 'Tap\'s own wordmark as served on tap.company (header logo). No brand kit or reuse terms are published; no prohibition found. Tap has no adapter in AWJ yet (H2-04); shown only for an existing tap connection.',
        sha256: '1d8f62a85c52b184ceaf791dcdbba5cdbf7d67b12d6ae3ed778ace0a2ccd29b2',
      },
    },
  },
  mada: {
    key: 'mada',
    nameAr: 'مدى',
    nameEn: 'mada',
    kind: 'method',
    logo: {
      kind: 'official',
      src: '/payment-brands/mada.svg',
      width: 38,
      height: 24,
      provenance: {
        publisher: 'Shopify Inc. (activemerchant/payment_icons)',
        source: `${SHOPIFY_ICONS_SOURCE}/mada.svg`,
        verifiedAt: '2026-10-24',
        origin: 'community_copy',
        rightsStatus: 'unverified',
        rights: SHOPIFY_ICONS_RIGHTS,
        sha256: 'b6fb3c3237f4a87afb975d628dcfa38f86cc67d354af7534b57febfb975c6800',
      },
    },
  },
  visa: {
    key: 'visa',
    nameAr: 'فيزا',
    nameEn: 'Visa',
    kind: 'method',
    logo: {
      kind: 'official',
      src: '/payment-brands/visa.svg',
      width: 38,
      height: 24,
      provenance: {
        publisher: 'Shopify Inc. (activemerchant/payment_icons)',
        source: `${SHOPIFY_ICONS_SOURCE}/visa.svg`,
        verifiedAt: '2026-10-24',
        origin: 'community_copy',
        rightsStatus: 'unverified',
        rights: SHOPIFY_ICONS_RIGHTS,
        sha256: '229b859539b38737ab4f47d3422aef50480a7b361d9b01ea47c0afc86b24854f',
      },
    },
  },
  mastercard: {
    key: 'mastercard',
    nameAr: 'ماستركارد',
    nameEn: 'Mastercard',
    kind: 'method',
    logo: {
      kind: 'official',
      src: '/payment-brands/mastercard.svg',
      width: 38,
      height: 24,
      provenance: {
        publisher: 'Shopify Inc. (activemerchant/payment_icons)',
        source: `${SHOPIFY_ICONS_SOURCE}/master.svg`,
        verifiedAt: '2026-10-24',
        origin: 'community_copy',
        rightsStatus: 'unverified',
        rights: SHOPIFY_ICONS_RIGHTS,
        sha256: '769f705370cbc2e6e5be851ac34e0bdf7767e52b4257f4db05ddef684ad548eb',
      },
    },
  },
  apple_pay: {
    key: 'apple_pay',
    nameAr: 'Apple Pay',
    nameEn: 'Apple Pay',
    kind: 'method',
    logo: {
      kind: 'official',
      src: '/payment-brands/apple-pay.svg',
      width: 166,
      height: 106,
      provenance: {
        publisher: 'Apple Inc.',
        source: 'https://developer.apple.com/apple-pay/marketing/',
        verifiedAt: '2026-10-24',
        origin: 'official_kit',
        rightsStatus: 'granted',
        rights: 'Apple-provided artwork from the Apple Pay Marketing Guidelines download (Apple-Pay-Mark.zip), unmodified.',
        sha256: '66baf110b86c1f1ae01a0e28985970d3827465e6aba6be54d5142a6d1eaa803c',
        terms:
          'Apple-provided artwork only; no recreation, recolor, stretch, corner-radius change, shadow/glow, flip/rotate/animation; clear space = 1/4 of mark height; not smaller than other payment marks; show Apple Pay messaging only on supported devices.',
      },
    },
  },
};

export function isPaymentBrandKey(value: unknown): value is PaymentBrandKey {
  return typeof value === 'string' && (PAYMENT_BRAND_KEYS as readonly string[]).includes(value);
}

export function paymentBrandPresentation(key: string | null | undefined): PaymentBrandPresentation | null {
  return isPaymentBrandKey(key) ? BRANDS[key] : null;
}

/** علامة مزوّد البوابة (`PaymentGateway.provider`) إن كانت لها علامة موثّقة؛ غير ذلك `null` (لا اختلاق). */
export function gatewayProviderBrand(provider: string | null | undefined): PaymentBrandPresentation | null {
  const brand = paymentBrandPresentation(provider);
  return brand?.kind === 'gateway_provider' ? brand : null;
}

/**
 * علامات وسائل الدفع المعروضة للمتسوّق/الدافع: تقاطع ما **مدعوم ومفعَّل فعلاً** (يمرّره المستدعي من بيانات الخادم)
 * مع السجل، بترتيب السجل وبلا تكرار. مفتاح غير معروف أو مزوّد بوابة لا يُعرض كوسيلة. لا افتراض لقائمة.
 */
export function enabledMethodBrands(enabled: readonly string[] | null | undefined): PaymentBrandPresentation[] {
  if (!enabled || enabled.length === 0) return [];
  const wanted = new Set(enabled);
  return PAYMENT_BRAND_KEYS.map((key) => BRANDS[key]).filter((brand) => brand.kind === 'method' && wanted.has(brand.key));
}

/** علامات شعارها بحالة حقوق غير موثَّقة بعد (للتقرير والمتابعة): تُستبدل بالأصل الرسمي متى وصل. */
export function brandsWithUnverifiedRights(): PaymentBrandKey[] {
  return PAYMENT_BRAND_KEYS.filter((key) => BRANDS[key].logo.provenance.rightsStatus === 'unverified');
}
