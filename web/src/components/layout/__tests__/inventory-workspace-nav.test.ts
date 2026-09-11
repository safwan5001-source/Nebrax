import { describe, expect, it } from 'vitest';
import { isNavEntryVisible } from '@/components/layout/nav-visibility';

/**
 * PR-INV-WS-NAV: مساحة عمل المخزون في الشريط تستخدم قدرة inventory.core
 * القائمة — نفس بوابة أرصدة المخزون/المخازن — بلا صلاحية RBAC جديدة.
 */
const NONE = new Set<string>();
const hiddenCore = new Set<string>(['inventory.core']);
const entry = { appKey: 'inventory.core' };

describe('inventory workspace sidebar visibility', () => {
  it('is visible when inventory.core is not hidden, regardless of role list', () => {
    expect(isNavEntryVisible(entry, NONE, { role: 'owner' })).toBe(true);
    expect(isNavEntryVisible(entry, NONE, { role: 'staff', permissions: ['products.view'] })).toBe(true);
    expect(isNavEntryVisible(entry, NONE, null)).toBe(true);
  });

  it('is hidden when inventory.core is disabled in nav-state', () => {
    expect(isNavEntryVisible(entry, hiddenCore, { role: 'owner' })).toBe(false);
    expect(isNavEntryVisible(entry, hiddenCore, { role: 'admin' })).toBe(false);
  });
});
