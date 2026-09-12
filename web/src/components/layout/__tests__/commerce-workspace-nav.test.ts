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

describe('commerce workspace main navigation entry', () => {
  it('adds exactly one /commerce entry with the approved key', () => {
    const entries = findSidebarEntriesByHref('/commerce');
    expect(entries).toHaveLength(1);
    expect(readStringProperty(entries[0], 'key')).toBe('ecommerce');
    expect(readStringProperty(entries[0], 'appKey')).toBeUndefined();
  });

  it('uses the approved AR/EN main navigation labels', () => {
    expect(arMessages.nav.ecommerce).toBe('التجارة الإلكترونية');
    expect(enMessages.nav.ecommerce).toBe('E-commerce');
    expect(arMessages.nav.groups.ecommerce).toBe('التجارة الإلكترونية');
    expect(enMessages.nav.groups.ecommerce).toBe('E-commerce');
  });

  it('keeps the entry visible without inventing a new permission gate', () => {
    expect(isNavEntryVisible({}, new Set(), { role: 'staff' })).toBe(true);
    expect(isNavEntryVisible({}, new Set(['commerce.storefront']), { role: 'staff' })).toBe(true);
  });

  it('does not regress the inventory workspace leaf', () => {
    const inventoryEntries = findSidebarEntriesByHref('/inventory');
    expect(inventoryEntries).toHaveLength(1);
    expect(readStringProperty(inventoryEntries[0], 'key')).toBe('stockBalances');
    expect(arMessages.nav.stockBalances).toBe('مساحة عمل المخزون');
    expect(enMessages.nav.stockBalances).toBe('Inventory Workspace');
  });
});
