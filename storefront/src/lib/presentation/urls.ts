const SAFE_HTTP = /^https:\/\//i;
const UNSAFE_PROTOCOL = /^(javascript|data|vbscript|file):/i;
const WHATSAPP_DIGITS = /^\+?[1-9]\d{7,14}$/;
const SAFE_LOGO =
  /^(https:\/\/[^\s]+|data:image\/(png|jpeg|jpg|webp);base64,[a-z0-9+/]+=*)$/i;

/**
 * External URLs the Customizer may preview. http, javascript: and data:
 * (except trusted image data URLs handled separately) are rejected.
 */
export function sanitizeExternalUrl(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (UNSAFE_PROTOCOL.test(trimmed)) return null;
  if (!SAFE_HTTP.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function sanitizeLogoUrl(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (trimmed.startsWith("data:image/svg")) return null;
  if (!SAFE_LOGO.test(trimmed)) return null;
  return trimmed;
}

export function normalizeWhatsAppPhone(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  const compact = trimmed.replace(/[^\d+]/g, "");
  const digits = compact.startsWith("+")
    ? compact
    : compact.replace(/^00/, "+");
  const candidate = digits.startsWith("+") ? digits : `+${digits}`;
  if (!WHATSAPP_DIGITS.test(candidate)) return null;
  return candidate;
}

/**
 * Builds a wa.me URL. Returns null when the number is unusable so a control
 * cannot invent a destination. Does not send a message.
 */
export function buildWhatsAppUrl(
  phone: string | null | undefined,
  message: string | null | undefined,
): string | null {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return null;
  const digits = normalized.replace(/^\+/, "");
  const text = message?.trim();
  const url = new URL(`https://wa.me/${digits}`);
  if (text) url.searchParams.set("text", text);
  return url.toString();
}

export function isSafeAppStoreUrl(value: string | null | undefined): boolean {
  const url = sanitizeExternalUrl(value);
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "apps.apple.com";
  } catch {
    return false;
  }
}

export function appStoreBadgeUrl(locale: string): string {
  const code = locale === "ar" ? "ar-sa" : "en-us";
  return `https://toolbox.marketingtools.apple.com/api/badges/download-on-the-app-store/black/${code}?size=250x83`;
}

export function playStoreBadgeUrl(locale: string): string {
  const code = locale === "ar" ? "ar" : "en";
  return `https://play.google.com/intl/en_us/badges/static/images/badges/${code}_badge_web_generic.png`;
}

export function isSafePlayStoreUrl(value: string | null | undefined): boolean {
  const url = sanitizeExternalUrl(value);
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "play.google.com" || host === "play.app.goo.gl";
  } catch {
    return false;
  }
}
