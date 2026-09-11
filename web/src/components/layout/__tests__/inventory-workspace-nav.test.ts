import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { isNavEntryVisible } from '@/components/layout/nav-visibility';
import arMessages from '@/messages/ar.json';
import enMessages from '@/messages/en.json';

const sidebarPath = resolve(process.cwd(), 'src/components/layout/sidebar.tsx');
const sidebarSource = readFileSync(sidebarPath, 'utf8');
const sidebarAst = ts.createSourceFile(sidebarPath, sidebarSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const hiddenInventory = new Set(['inventory.core']);
const visibleApps = new Set<string>();
const inventoryEntry = { appKey: 'inventory.core' };

function readStringProperty(node: ts.ObjectLiteralExpression, propertyName: string): string | undefined {
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (!ts.isIdentifier(property.name) || property.name.text !== propertyName) continue;
    if (!ts.isStringLiteral(property.initializer)) continue;

    return property.initializer.text;
  }

  return undefined;
}

function findSidebarEntriesByHref(href: string): ts.ObjectLiteralExpression[] {
  const matches: ts.ObjectLiteralExpression[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node) && readStringProperty(node, 'href') === href) {
      matches.push(node);
    }

    ts.forEachChild(node, visit);
  };

  visit(sidebarAst);

  return matches;
}

describe('inventory workspace sidebar navigation label', () => {
  it('keeps exactly one /inventory entry with the existing stockBalances key and inventory.core appKey', () => {
    const inventoryEntries = findSidebarEntriesByHref('/inventory');

    expect(inventoryEntries).toHaveLength(1);
    expect(readStringProperty(inventoryEntries[0], 'key')).toBe('stockBalances');
    expect(readStringProperty(inventoryEntries[0], 'appKey')).toBe('inventory.core');
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
