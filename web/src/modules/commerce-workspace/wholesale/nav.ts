/**
 * Wholesale Merchant Workspace — section map. Lives INSIDE `/commerce` (one entry in the Commerce navigation points
 * at `/commerce/wholesale`); this list drives the in-workspace section bar only, so Commerce navigation is not
 * duplicated. `permission` is what the backing API enforces — a viewer without it still reaches the route and sees a
 * permission-denied state (the server remains the authority; nothing is sent without it).
 */

export const WHOLESALE_BASE = '/commerce/wholesale';

export const WHOLESALE_SECTION_KEYS = [
  'overview',
  'orders',
  'buyers',
  'catalog',
  'priceLists',
  'offers',
  'quotations',
  'shipping',
  'payments',
  'reports',
  'settings',
] as const;
export type WholesaleSectionKey = (typeof WHOLESALE_SECTION_KEYS)[number];

/** What a section needs from the active channel before its data is meaningful. */
export type SectionRequirement = 'none' | 'channel' | 'wholesale_active';

export type WholesaleSection = {
  key: WholesaleSectionKey;
  href: string;
  /** Permission the primary endpoint enforces; `undefined` = each card gates itself (overview). */
  permission?: string;
  requires: SectionRequirement;
};

export const WHOLESALE_SECTIONS: readonly WholesaleSection[] = [
  { key: 'overview', href: WHOLESALE_BASE, requires: 'none' },
  { key: 'orders', href: `${WHOLESALE_BASE}/orders`, permission: 'commerce.orders.view', requires: 'wholesale_active' },
  { key: 'buyers', href: `${WHOLESALE_BASE}/buyers`, permission: 'commerce.wholesale.manage', requires: 'wholesale_active' },
  { key: 'catalog', href: `${WHOLESALE_BASE}/catalog`, permission: 'products.view', requires: 'channel' },
  { key: 'priceLists', href: `${WHOLESALE_BASE}/price-lists`, permission: 'invoices.view', requires: 'channel' },
  { key: 'offers', href: `${WHOLESALE_BASE}/offers`, permission: 'commerce.manage', requires: 'channel' },
  { key: 'quotations', href: `${WHOLESALE_BASE}/quotations`, permission: 'invoices.view', requires: 'none' },
  { key: 'shipping', href: `${WHOLESALE_BASE}/shipping`, permission: 'commerce.manage', requires: 'channel' },
  { key: 'payments', href: `${WHOLESALE_BASE}/payments`, permission: 'payments.view', requires: 'none' },
  { key: 'reports', href: `${WHOLESALE_BASE}/reports`, permission: 'commerce.orders.view', requires: 'wholesale_active' },
  { key: 'settings', href: `${WHOLESALE_BASE}/settings`, permission: 'commerce.channel_settings.manage', requires: 'channel' },
] as const;

export function wholesaleSection(key: WholesaleSectionKey): WholesaleSection {
  return WHOLESALE_SECTIONS.find((section) => section.key === key)!;
}

export function isWholesaleSectionActive(href: string, pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (href === WHOLESALE_BASE) return pathname === WHOLESALE_BASE;
  return pathname === href || pathname.startsWith(`${href}/`);
}
