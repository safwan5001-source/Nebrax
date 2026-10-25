/** Display-only payment marks configured independently from checkout gateways. */
export const FOOTER_PAYMENT_LOGO_KEYS = [
  "mada",
  "visa",
  "mastercard",
  "apple_pay",
] as const;
export const FOOTER_PAYMENT_LOGO_STYLES = ["inline", "cards", "strip"] as const;
export const FOOTER_PAYMENT_LOGO_SIZES = ["sm", "md", "lg"] as const;

export type FooterPaymentLogoKey = (typeof FOOTER_PAYMENT_LOGO_KEYS)[number];
export type FooterPaymentLogoStyle =
  (typeof FOOTER_PAYMENT_LOGO_STYLES)[number];
export type FooterPaymentLogoSize = (typeof FOOTER_PAYMENT_LOGO_SIZES)[number];

export interface FooterPaymentLogos {
  enabled: boolean;
  brands: FooterPaymentLogoKey[];
  style: FooterPaymentLogoStyle;
  size: FooterPaymentLogoSize;
  showTitle: boolean;
}

export const DEFAULT_FOOTER_PAYMENT_LOGOS: FooterPaymentLogos = {
  enabled: false,
  brands: [...FOOTER_PAYMENT_LOGO_KEYS],
  style: "cards",
  size: "md",
  showTitle: true,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Absent/invalid objects stay absent so existing stores remain byte-identical and disabled. */
export function normalizeFooterPaymentLogos(
  raw: unknown,
): FooterPaymentLogos | undefined {
  if (!isObject(raw)) return undefined;
  const seen = new Set<FooterPaymentLogoKey>();
  const brands = Array.isArray(raw.brands)
    ? raw.brands.filter((value): value is FooterPaymentLogoKey => {
        if (
          typeof value !== "string" ||
          !(FOOTER_PAYMENT_LOGO_KEYS as readonly string[]).includes(value) ||
          seen.has(value as FooterPaymentLogoKey)
        ) {
          return false;
        }
        seen.add(value as FooterPaymentLogoKey);
        return true;
      })
    : [...FOOTER_PAYMENT_LOGO_KEYS];

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : false,
    brands,
    style: pick(raw.style, FOOTER_PAYMENT_LOGO_STYLES, "cards"),
    size: pick(raw.size, FOOTER_PAYMENT_LOGO_SIZES, "md"),
    showTitle: typeof raw.showTitle === "boolean" ? raw.showTitle : true,
  };
}

export function resolvedFooterPaymentLogos(
  value: FooterPaymentLogos | undefined,
): FooterPaymentLogos {
  return (
    value ?? {
      ...DEFAULT_FOOTER_PAYMENT_LOGOS,
      brands: [...DEFAULT_FOOTER_PAYMENT_LOGOS.brands],
    }
  );
}
