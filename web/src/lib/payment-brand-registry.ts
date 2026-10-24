/**
 * سجل علامات الدفع — المصدر الوحيد لاسم العلامة وحالة شعارها الرسمي.
 *
 * لا يُرسم شعار ولا يُستنسخ ولا يُجلب من Brandfetch/Simple Icons/بحث الصور. الأصل المحلي
 * (`web/public/payment-brands/*`) يدخل هنا فقط حين يُوثَّق مصدره الرسمي وشروط استعماله في `provenance`.
 * حتى ذلك الحين تكون الحالة `pending` وتعرض الواجهة الاسم نصاً (لا شعاراً بديلاً) ويظل المتطلب مسجَّلاً في
 * `docs/plans/payments/horizon/AWJ-PAY-H2-01c-IMPLEMENTATION-REPORT.md`.
 */
export const PAYMENT_BRAND_KEYS = ['moyasar', 'mada', 'visa', 'mastercard', 'apple_pay'] as const;
export type PaymentBrandKey = (typeof PAYMENT_BRAND_KEYS)[number];

export interface PaymentBrandProvenance {
  /** ناشر الأصل (صاحب العلامة). */
  publisher: string;
  /** صفحة الأصل أو إرشادات الاستعمال الرسمية. */
  source: string;
  /** تاريخ التحقق (ISO). */
  verifiedAt: string;
  /** شروط الاستعمال المنشورة لدى الناشر (ملخص حرفي لما يقيّد العرض)، لا اجتهاد. */
  terms?: string;
}

export type PaymentBrandLogo =
  | { kind: 'pending'; requirement: string }
  | { kind: 'official'; src: string; width: number; height: number; provenance: PaymentBrandProvenance };

export interface PaymentBrandPresentation {
  key: PaymentBrandKey;
  nameAr: string;
  nameEn: string;
  /** مزوّد بوابة (`moyasar`) أم وسيلة/شبكة دفع. */
  kind: 'gateway_provider' | 'method';
  logo: PaymentBrandLogo;
}

export const PAYMENT_BRAND_LOGO_POLICY =
  'Only an official asset with recorded provenance is rendered as a logo. Otherwise the brand is shown by name as text. No redrawn, recolored, cropped, or substitute artwork.';

const PENDING = {
  moyasar: 'BLOCKED: moyasar.com/press and docs.moyasar.com publish no logo pack or reuse terms (only their own site header logo). Request the official logo pack and usage terms via help.moyasar.com / the partner channel before adopting.',
  mada: 'BLOCKED: mada.com.sa (Saudi Payments) was unreachable from the build environment and no official download page was verified; third-party copies are not official. Obtain the mada brand pack and e-commerce merchant guideline from Saudi Payments or the acquiring partner.',
  visa: 'BLOCKED (owner action): the Visa Brand Center (globalclient.visa.com/brand-mark) releases files only after a named business submits a form and accepts the Terms of Use. Submit it as the AWJ business and register the files here.',
  mastercard: 'BLOCKED (owner action): the Mastercard Brand Center (mastercard.com/brandcenter) was not reachable from the build environment (HTTP 403) and also releases artwork under its terms. Obtain it as the AWJ business and register the files here.',
} as const satisfies Record<Exclude<PaymentBrandKey, 'apple_pay'>, string>;

const BRANDS: Readonly<Record<PaymentBrandKey, PaymentBrandPresentation>> = {
  moyasar: { key: 'moyasar', nameAr: 'ميسّر', nameEn: 'Moyasar', kind: 'gateway_provider', logo: { kind: 'pending', requirement: PENDING.moyasar } },
  mada: { key: 'mada', nameAr: 'مدى', nameEn: 'mada', kind: 'method', logo: { kind: 'pending', requirement: PENDING.mada } },
  visa: { key: 'visa', nameAr: 'فيزا', nameEn: 'Visa', kind: 'method', logo: { kind: 'pending', requirement: PENDING.visa } },
  mastercard: { key: 'mastercard', nameAr: 'ماستركارد', nameEn: 'Mastercard', kind: 'method', logo: { kind: 'pending', requirement: PENDING.mastercard } },
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

/** كل علامة لم يُعتمد شعارها الرسمي بعد، مع متطلب الحصول عليه (للتقرير والاختبار). */
export function pendingPaymentBrandRequirements(): { key: PaymentBrandKey; requirement: string }[] {
  return PAYMENT_BRAND_KEYS.flatMap((key) => {
    const logo = BRANDS[key].logo;
    return logo.kind === 'pending' ? [{ key, requirement: logo.requirement }] : [];
  });
}
