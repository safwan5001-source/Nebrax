import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isNavEntryVisible } from '@/components/layout/nav-visibility';
import arMessages from '@/messages/ar.json';
import enMessages from '@/messages/en.json';

const sidebarPath = resolve(process.cwd(), 'src/components/layout/sidebar.tsx');
const sidebarSource = readFileSync(sidebarPath, 'utf8');
const hiddenInventory = new Set(['inventory.core']);
const visibleApps = new Set<string>();
const inventoryEntry = { appKey: 'inventory.core' };

describe('inventory workspace sidebar navigation label', () => {
  it('keeps exactly one /inventory entry with the existing stockBalances key and inventory.core appKey', () => {
    expect(sidebarSource.match(/href:\s*'\/inventory'/g)).toHaveLength(1);

    const inventoryLeaf = sidebarSource.match(/\{[^{}]*href:\s*'\/inventory'[^{}]*\}/)?.[0];

    expect(inventoryLeaf).toBeTruthy();
    expect(inventoryLeaf).toContain("key: 'stockBalances'");
    expect(inventoryLeaf).toContain("appKey: 'inventory.core'");
  });

  it('uses the updated nav labels only for the sidebar leaf in Arabic and English', () => {
    expect(arMessages.nav.stockBalances).toBe('مساحة عمل المخزون');
    expect(enMessages.nav.stockBalances).toBe('Inventory Workspace');
  });

  it('keeps inventory.core visibility controlled by isNavEntryVisible', () => {
    expect(isNavEntryVisible(inventoryEntry, visibleApps, { role: 'owner' })).toBe(true);
    expect(isNavEntryVisible(inventoryEntry, hiddenInventory, { role: 'owner' })).toBe(false);
  });

  it('leaves the stock balances report catalog titles unchanged', () => {
    expect(arMessages.reports.catalog.reports.stockBalances.title).toBe('أرصدة المخزون');
    expect(enMessages.reports.catalog.reports.stockBalances.title).toBe('Inventory balances');
  });
});
