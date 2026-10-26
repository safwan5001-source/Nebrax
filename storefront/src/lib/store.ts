/**
 * Centralized store configuration.
 *
 * All store-level environment variables are accessed here so the rest of the
 * codebase has a single source of truth with consistent fallback values.
 */

/**
 * Ensure a URL has a protocol prefix.
 * If the URL doesn't start with http:// or https://, prepend https://.
 */
export function ensureProtocol(url: string): string {
  const trimmed = url.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

/**
 * Get the store URL, preferring NEXT_PUBLIC_SITE_URL and falling back to
 * NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL. In development, falls back to
 * http://localhost:3001. Returns undefined in production when unconfigured
 * so misconfiguration surfaces immediately.
 */
export function getStoreUrl(): string | undefined {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL;
  if (raw) return ensureProtocol(raw);
  return process.env.NODE_ENV === "development"
    ? "http://localhost:3001"
    : undefined;
}

/**
 * Deployment-wide fallback store name for surfaces with no request context
 * (transactional emails, the legacy checkout shell). It is **not** a source for
 * page titles or SEO/social metadata — those use the published Storefront
 * identity (`lib/metadata/store-identity.ts`), because one deployment serves
 * many stores and an environment value would be shared between them.
 */
export function getStoreName(): string {
  return process.env.NEXT_PUBLIC_STORE_NAME || "Store";
}

/**
 * Get the default country ISO code (lowercase).
 */
export function getDefaultCountry(): string {
  return (process.env.NEXT_PUBLIC_DEFAULT_COUNTRY || "us").toLowerCase();
}

/**
 * Get the default locale code. Falls back to "ar" — AWJ Store's primary
 * language (AWJ_STORE_LANGUAGE_DECISION.md §1) — not to the original
 * Spree Storefront template's "en" default.
 */
export function getDefaultLocale(): string {
  return process.env.NEXT_PUBLIC_DEFAULT_LOCALE || "ar";
}

/**
 * Get the "from" address for transactional emails.
 */
export function getStoreEmailFrom(): string {
  return process.env.EMAIL_FROM || "orders@example.com";
}

/**
 * Returns true when EMAIL_FROM is not set and getStoreEmailFrom() will
 * return the fallback address.
 */
export function isStoreEmailFromFallback(): boolean {
  return !process.env.EMAIL_FROM;
}
