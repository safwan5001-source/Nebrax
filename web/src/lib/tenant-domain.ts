/**
 * Configurable AWJ ERP tenant base domain.
 *
 * Production default: `awj.app` → `{slug}.awj.app`.
 * Override with NEXT_PUBLIC_TENANT_BASE_DOMAIN for local/preview
 * (`localhost`, `awj.test`, …). Do not scatter `awj.app` literals.
 */
export function tenantBaseDomain(
  value = process.env.NEXT_PUBLIC_TENANT_BASE_DOMAIN,
): string {
  const raw = (value ?? 'awj.app').trim().replace(/^\.+/, '').replace(/\.+$/, '').toLowerCase();
  return raw || 'awj.app';
}

export function tenantHostSuffix(value?: string): string {
  return `.${tenantBaseDomain(value)}`;
}

/** Builds `{slug}.{base_domain}` — the tenant's own AWJ subdomain. */
export function tenantHostFor(slug: string, value?: string): string {
  return `${slug.trim().toLowerCase()}${tenantHostSuffix(value)}`;
}

/**
 * True when `hostname` is itself under the configured tenant base domain
 * (e.g. `test.awjdev.xyz`, or an existing tenant's own subdomain) — i.e. the
 * browser is genuinely in AWJ's subdomain-hosted mode, as opposed to plain
 * `localhost:3000` dev or a Vercel preview domain the base domain doesn't
 * cover. Only in that mode does a post-registration cross-subdomain
 * transition make sense; everywhere else the existing same-origin behavior
 * (`router.replace`) is preserved untouched.
 */
export function isTenantSubdomainHost(hostname: string, value?: string): boolean {
  return hostname.trim().toLowerCase().endsWith(tenantHostSuffix(value));
}

const CLIENT_RESERVED_SLUGS = [
  'www',
  'api',
  'app',
  'admin',
  'platform',
  'support',
  'store',
  'storefront',
] as const;

export function isReservedTenantSlug(slug: string): boolean {
  return (CLIENT_RESERVED_SLUGS as readonly string[]).includes(slug.trim().toLowerCase());
}
