import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isNavEntryVisible } from '@/components/layout/nav-visibility';
import arMessages from '@/messages/ar.json';
import enMessages from '@/messages/en.json';

/**
 * مساحة عمل المخزون تُعرَض من البند الحالي stockBalances → /inventory
 * بقدرة inventory.core. لا بند ثانٍ ولا صلاحية RBAC جديدة.
 */
const NONE = new Set<string>();
const hiddenCore = new Set<string>(['inventory.core']);
const entry = { appKey: 'inventory.core' };

const sidebarSource = readFileSync(resolve(process.cwd(), 'src/components/layout/sidebar.tsx'), 'utf8');
const inventoryHrefs = [...sidebarSource.matchAll(/href: '\/inventory'/g)];
const workspaceLeaf =
  "{ href: '/inventory', icon: Warehouse, key: 'stockBalances', built: true, appKey: 'inventory.core' }";

describe('inventory workspace sidebar leaf', () => {
  it('keeps exactly one /inventory sidebar entry as stockBalances + inventory.core', () => {
    expect(inventoryHrefs).toHaveLength(1);
    expect(sidebarSource).toContain(workspaceLeaf);
    expect(sidebarSource).not.toContain("key: 'inventoryWorkspace'");
  });

  it('labels the existing nav key as Inventory Workspace in AR and EN', () => {
    expect(arMessages.nav.stockBalances).toBe('مساحة عمل المخزون');
    expect(enMessages.nav.stockBalances).toBe('Inventory Workspace');
  });

  it('does not rename the reports catalog stockBalances title', () => {
    expect(arMessages.reports.catalog.reports.stockBalances.title).toBe('أرصدة المخزون');
    expect(enMessages.reports.catalog.reports.stockBalances.title).toBe('Inventory balances');
  });
});

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
