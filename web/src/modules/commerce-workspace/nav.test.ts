import { describe, expect, it } from 'vitest';
import {
  COMMERCE_WORKSPACE_HREFS,
  COMMERCE_WORKSPACE_NAV_GROUPS,
  isCommerceNavItemActive,
  isCommerceWorkspacePath,
} from './nav';

describe('commerce workspace navigation', () => {
  it('exposes the approved commerce destinations only', () => {
    expect(COMMERCE_WORKSPACE_HREFS).toEqual([
      '/commerce',
      '/commerce/stores',
      '/commerce/published-products',
      '/commerce/appearance',
      '/commerce/domains',
      '/commerce/delivery',
      '/commerce/integrations',
    ]);
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
