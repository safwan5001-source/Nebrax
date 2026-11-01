import { describe, expect, it } from 'vitest';
import {
  COMMERCE_WORKSPACE_HREFS,
  COMMERCE_WORKSPACE_NAV_GROUPS,
  isCommerceNavItemActive,
  isCommerceWorkspacePath,
} from './nav';
import { isNavEntryVisible } from '@/components/layout/nav-visibility';

describe('commerce workspace navigation', () => {
  it('exposes the approved commerce destinations only', () => {
    expect(COMMERCE_WORKSPACE_HREFS).toEqual([
      '/commerce',
      '/commerce/orders',
      '/commerce/stores',
      '/commerce/published-products',
      '/commerce/merchandising',
      '/commerce/themes',
      '/commerce/appearance',
      '/app-builder',
      '/commerce/domains',
      '/commerce/delivery',
      '/commerce/customer-accounts',
      '/commerce/gifting',
      '/commerce/integrations',
      '/commerce/wholesale',
    ]);
  });

  it('places Merchandising after publication, Theme Gallery before Store Experience and preserves App Builder guards', () => {
    const storeItems = COMMERCE_WORKSPACE_NAV_GROUPS.find((group) => group.labelKey === 'groupStore')?.items;
    expect(storeItems?.map((item) => item.href)).toEqual([
      '/commerce/stores',
      '/commerce/published-products',
      '/commerce/merchandising',
      '/commerce/themes',
      '/commerce/appearance',
      '/app-builder',
    ]);
    expect(storeItems?.[5]).toMatchObject({
      appKey: 'commerce.app_builder',
      permission: 'apps_builder.view',
    });
  });

  it('hides App Builder from viewers without the existing permission or entitlement', () => {
    const appBuilder = COMMERCE_WORKSPACE_NAV_GROUPS.find((group) => group.labelKey === 'groupStore')?.items[5];
    expect(appBuilder).toBeDefined();
    expect(isNavEntryVisible(appBuilder!, new Set(), { role: 'staff', permissions: [] })).toBe(false);
    expect(isNavEntryVisible(appBuilder!, new Set(['commerce.app_builder']), { role: 'admin' })).toBe(false);
  });

  it('lists Customer accounts under the channel group, visible only to owners/admins with the storefront capability', () => {
    const channelItems = COMMERCE_WORKSPACE_NAV_GROUPS.find((group) => group.labelKey === 'groupChannel')?.items;
    const accounts = channelItems?.find((item) => item.href === '/commerce/customer-accounts');
    expect(accounts).toMatchObject({
      labelKey: 'customerAccounts',
      appKey: 'commerce.storefront',
      permission: 'commerce.channel_settings.manage',
    });
    expect(isNavEntryVisible(accounts!, new Set(), { role: 'staff', permissions: [] })).toBe(false);
    expect(isNavEntryVisible(accounts!, new Set(), { role: 'owner' })).toBe(true);
    expect(isNavEntryVisible(accounts!, new Set(['commerce.storefront']), { role: 'owner' })).toBe(false);
  });

  it('hides Merchandising from roles without products.view, which every backing route requires', () => {
    const merchandising = COMMERCE_WORKSPACE_NAV_GROUPS.flatMap((group) => group.items).find((item) => item.href === '/commerce/merchandising');
    expect(merchandising).toMatchObject({ permission: 'products.view' });
    expect(isNavEntryVisible(merchandising!, new Set(), { role: 'staff', permissions: [] })).toBe(false);
    expect(isNavEntryVisible(merchandising!, new Set(), { role: 'staff', permissions: ['products.view'] })).toBe(true);
  });

  it('places Orders right after Overview, guarded by permission and the storefront capability', () => {
    const overview = COMMERCE_WORKSPACE_NAV_GROUPS[0].items;
    expect(overview.map((item) => item.href)).toEqual(['/commerce', '/commerce/orders']);
    const orders = overview[1];
    expect(orders).toMatchObject({ labelKey: 'orders', appKey: 'commerce.storefront', permission: 'commerce.orders.view' });
    // بلا الصلاحية، أو بقدرة معطّلة، لا يظهر العنصر.
    expect(isNavEntryVisible(orders, new Set(), { role: 'staff', permissions: [] })).toBe(false);
    expect(isNavEntryVisible(orders, new Set(), { role: 'accountant', permissions: ['payments.manage', 'commerce.manage'] })).toBe(false);
    expect(isNavEntryVisible(orders, new Set(['commerce.storefront']), { role: 'admin', permissions: ['*'] })).toBe(false);
    expect(isNavEntryVisible(orders, new Set(), { role: 'owner', permissions: ['*'] })).toBe(true);
    expect(isNavEntryVisible(orders, new Set(), { role: 'staff', permissions: ['commerce.orders.view'] })).toBe(true);
  });

  it('does not add copies of AWJ core modules', () => {
    expect(COMMERCE_WORKSPACE_HREFS).not.toContain('/products');
    expect(COMMERCE_WORKSPACE_HREFS).not.toContain('/partners');
    expect(COMMERCE_WORKSPACE_HREFS).not.toContain('/inventory');
    expect(COMMERCE_WORKSPACE_HREFS).not.toContain('/invoices');
    expect(COMMERCE_WORKSPACE_HREFS).not.toContain('/payments');
    expect(COMMERCE_WORKSPACE_NAV_GROUPS).toHaveLength(4);
  });

  it('adds Wholesale as ONE guarded entry — its eleven sections live in the workspace section bar, not here', () => {
    const group = COMMERCE_WORKSPACE_NAV_GROUPS.find((candidate) => candidate.labelKey === 'groupWholesale');
    expect(group?.items).toEqual([{ href: '/commerce/wholesale', labelKey: 'wholesale', permission: 'commerce.wholesale.manage' }]);
    expect(COMMERCE_WORKSPACE_HREFS.filter((href) => href.startsWith('/commerce/wholesale'))).toEqual(['/commerce/wholesale']);
    const entry = group!.items[0];
    expect(isNavEntryVisible(entry, new Set(), { role: 'staff', permissions: ['commerce.manage'] })).toBe(false);
    expect(isNavEntryVisible(entry, new Set(), { role: 'owner', permissions: ['*'] })).toBe(true);
    // Sub-routes keep the entry highlighted; the Orders entry does not capture /commerce/wholesale/orders.
    expect(isCommerceNavItemActive('/commerce/wholesale', '/commerce/wholesale/buyers')).toBe(true);
    expect(isCommerceNavItemActive('/commerce/orders', '/commerce/wholesale/orders')).toBe(false);
  });

  it('treats overview as an exact route and nested routes as prefixes', () => {
    expect(isCommerceNavItemActive('/commerce', '/commerce')).toBe(true);
    expect(isCommerceNavItemActive('/commerce', '/commerce/stores')).toBe(false);
    expect(isCommerceNavItemActive('/commerce/stores', '/commerce/stores')).toBe(true);
    expect(isCommerceWorkspacePath('/commerce/domains')).toBe(true);
    expect(isCommerceWorkspacePath('/inventory')).toBe(false);
  });
});
