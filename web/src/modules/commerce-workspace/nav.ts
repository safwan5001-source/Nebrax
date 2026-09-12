export type CommerceWorkspaceNavItem = {
  href: string;
  labelKey: string;
};

export type CommerceWorkspaceNavGroup = {
  labelKey: string;
  items: CommerceWorkspaceNavItem[];
};

/**
 * Destinations that belong to Commerce Workspace only.
 * Core AWJ modules (products, customers, inventory, invoices, payments,
 * reports, RBAC) stay in AWJ and are not copied here.
 */
export const COMMERCE_WORKSPACE_NAV_GROUPS: CommerceWorkspaceNavGroup[] = [
  {
    labelKey: 'groupOverview',
    items: [{ href: '/commerce', labelKey: 'overview' }],
  },
  {
    labelKey: 'groupStore',
    items: [
      { href: '/commerce/stores', labelKey: 'stores' },
      { href: '/commerce/published-products', labelKey: 'publishedProducts' },
      { href: '/commerce/appearance', labelKey: 'appearance' },
    ],
  },
  {
    labelKey: 'groupChannel',
    items: [
      { href: '/commerce/domains', labelKey: 'domains' },
      { href: '/commerce/delivery', labelKey: 'delivery' },
      { href: '/commerce/integrations', labelKey: 'integrations' },
    ],
  },
];

export const COMMERCE_WORKSPACE_HREFS = COMMERCE_WORKSPACE_NAV_GROUPS.flatMap((group) =>
  group.items.map((item) => item.href),
);

export function isCommerceWorkspacePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === '/commerce' || pathname.startsWith('/commerce/');
}

export function isCommerceNavItemActive(href: string, pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (href === '/commerce') return pathname === '/commerce';
  return pathname === href || pathname.startsWith(`${href}/`);
}
