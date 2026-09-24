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
      '/commerce/stores',
      '/commerce/published-products',
      '/commerce/appearance',
      '/app-builder',
      '/commerce/domains',
      '/commerce/delivery',
      '/commerce/integrations',
    ]);
  });

  it('places App Builder after Store Experience and preserves its guards', () => {
    const storeItems = COMMERCE_WORKSPACE_NAV_GROUPS.find((group) => group.labelKey === 'groupStore')?.items;
    expect(storeItems?.map((item) => item.href)).toEqual([
      '/commerce/stores',
      '/commerce/published-products',
      '/commerce/appearance',
      '/app-builder',
    ]);
    expect(storeItems?.[3]).toMatchObject({
      appKey: 'commerce.app_builder',
      permission: 'apps_builder.view',
    });
  });

  it('hides App Builder from viewers without the existing permission or entitlement', () => {
    const appBuilder = COMMERCE_WORKSPACE_NAV_GROUPS.find((group) => group.labelKey === 'groupStore')?.items[3];
    expect(appBuilder).toBeDefined();
    expect(isNavEntryVisible(appBuilder!, new Set(), { role: 'staff', permissions: [] })).toBe(false);
    expect(isNavEntryVisible(appBuilder!, new Set(['commerce.app_builder']), { role: 'admin' })).toBe(false);
  });

  it('does not add copies of AWJ core modules', () => {
    expect(COMMERCE_WORKSPACE_HREFS).not.toContain('/products');
    expect(COMMERCE_WORKSPACE_HREFS).not.toContain('/partners');
    expect(COMMERCE_WORKSPACE_HREFS).not.toContain('/inventory');
    expect(COMMERCE_WORKSPACE_HREFS).not.toContain('/invoices');
    expect(COMMERCE_WORKSPACE_HREFS).not.toContain('/payments');
    expect(COMMERCE_WORKSPACE_NAV_GROUPS).toHaveLength(3);
  });

  it('treats overview as an exact route and nested routes as prefixes', () => {
    expect(isCommerceNavItemActive('/commerce', '/commerce')).toBe(true);
    expect(isCommerceNavItemActive('/commerce', '/commerce/stores')).toBe(false);
    expect(isCommerceNavItemActive('/commerce/stores', '/commerce/stores')).toBe(true);
    expect(isCommerceWorkspacePath('/commerce/domains')).toBe(true);
    expect(isCommerceWorkspacePath('/inventory')).toBe(false);
  });
});
