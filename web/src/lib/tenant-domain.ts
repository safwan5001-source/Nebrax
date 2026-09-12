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
