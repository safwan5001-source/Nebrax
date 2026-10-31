import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppSchemaComponent } from '@/lib/app-builder';
import { cloneWithFreshIds, insertChildAfter } from '@/lib/app-builder';
import { EASY_CATALOG, isAddable, isAddableOnPage, sectionSummary } from './easy-catalog';
import { selectionTargetFor, sectionContains } from './editor-mode';

const fixture = JSON.parse(readFileSync(resolve(process.cwd(), '../contracts/app-builder/registry-identifiers.v1.json'), 'utf8')) as { components: string[]; actions: string[] };

function walk(node: AppSchemaComponent, visit: (n: AppSchemaComponent, parent: AppSchemaComponent | null) => void, parent: AppSchemaComponent | null = null) {
  visit(node, parent);
  (node.children ?? []).forEach((child) => walk(child, visit, node));
}

describe('Easy Mode catalog', () => {
  const addable = EASY_CATALOG.filter(isAddable);

  it('proposed entries have no builder and are never addable; every addable entry has one', () => {
    for (const entry of EASY_CATALOG) {
      if (entry.status === 'proposed') {
        expect(entry.build).toBeUndefined();
        expect(isAddable(entry)).toBe(false);
        expect(entry.reasonKey).toBeTruthy();
      } else {
        expect(typeof entry.build).toBe('function');
      }
    }
    expect(addable.length).toBeGreaterThanOrEqual(5);
  });

  it.each(addable.map((e) => [e.key, e] as const))('%s builds a valid tree: known types only, fresh unique ids, Section root, no Page, leaves without children', (_key, entry) => {
    const root = entry.build!();
    expect(root.type).toBe('Section');
    const ids: string[] = [];
    walk(root, (n, parent) => {
      ids.push(n.id);
      expect(fixture.components, `نوع غير معروف ${n.type}`).toContain(n.type);
      expect(n.type).not.toBe('Page');
      if (n.action) expect(fixture.actions).toContain(n.action.type);
      if (['Text', 'Image', 'Button', 'Price', 'Quantity', 'CartSummary', 'ProductCard'].includes(n.type)) expect(n.children ?? []).toHaveLength(0);
      if (parent === null) expect(n.id).toMatch(/^section-/);
    });
    expect(new Set(ids).size).toBe(ids.length);
    // البناء مرتين لا يكرر معرّفاً
    const again: string[] = [];
    walk(entry.build!(), (n) => again.push(n.id));
    expect(again.filter((id) => ids.includes(id))).toEqual([]);
  });

  it('dump for server-side contract calibration (opt-in)', () => {
    if (!process.env.EASY_CATALOG_DUMP) return;
    writeFileSync(process.env.EASY_CATALOG_DUMP, JSON.stringify(Object.fromEntries(addable.map((e) => [e.key, e.build!()]))));
  });
});

describe('page-scoped sections', () => {
  const entry = (key: string) => EASY_CATALOG.find((e) => e.key === key)!;

  it('product list belongs to home, cart sections belong to cart, the rest to any page, proposed to none', () => {
    expect(isAddableOnPage(entry('productList'), 'home')).toBe(true);
    expect(isAddableOnPage(entry('productList'), 'cart')).toBe(false);
    expect(isAddableOnPage(entry('cartList'), 'cart')).toBe(true);
    expect(isAddableOnPage(entry('cartSummary'), 'home')).toBe(false);
    expect(isAddableOnPage(entry('text'), 'anything')).toBe(true);
    expect(isAddableOnPage(entry('productList'), null)).toBe(false);
    expect(isAddableOnPage(entry('slider'), 'home')).toBe(false);
  });
});

describe('section helpers', () => {
  const home: AppSchemaComponent = {
    type: 'Page', id: 'home-root',
    children: [
      { type: 'Section', id: 's1', props: { title: 'A' }, children: [{ type: 'Text', id: 't1', props: { text: 'hello' } }] },
      { type: 'Section', id: 's2', children: [{ type: 'ProductList', id: 'pl', children: [] }] },
    ],
  };

  it('insertChildAfter places after the anchor, or at the end when the anchor is absent', () => {
    const node: AppSchemaComponent = { type: 'Section', id: 'new', children: [] };
    expect(insertChildAfter(home, 'home-root', 's1', node).children!.map((c) => c.id)).toEqual(['s1', 'new', 's2']);
    expect(insertChildAfter(home, 'home-root', null, node).children!.map((c) => c.id)).toEqual(['s1', 's2', 'new']);
    expect(insertChildAfter(home, 'home-root', 'ghost', node).children!.map((c) => c.id)).toEqual(['s1', 's2', 'new']);
    expect(home.children).toHaveLength(2); // لا تحوّر المدخل
  });

  it('cloneWithFreshIds deep-copies with new ids on every node and never aliases the source', () => {
    const copy = cloneWithFreshIds(home.children![0]);
    const sourceIds = ['s1', 't1'];
    const copyIds: string[] = [];
    walk(copy, (n) => copyIds.push(n.id));
    expect(copyIds).toHaveLength(2);
    expect(copyIds.some((id) => sourceIds.includes(id))).toBe(false);
    (copy.props as { title: string }).title = 'changed';
    expect(home.children![0].props!.title).toBe('A');
  });

  it('selection target is the only content node, except data lists which keep the section (its title)', () => {
    expect(selectionTargetFor(home.children![0])).toBe('t1');
    expect(selectionTargetFor(home.children![1])).toBe('s2');
    expect(sectionContains(home.children![0], 't1')).toBe(true);
    expect(sectionContains(home.children![0], 'pl')).toBe(false);
    expect(sectionContains(home.children![0], null)).toBe(false);
  });

  it('sectionSummary derives a display title from the section or its content (never written to the schema)', () => {
    expect(sectionSummary(home.children![0])).toEqual({ primaryType: 'Text', title: 'A' });
    expect(sectionSummary({ type: 'Section', id: 'x', children: [{ type: 'Button', id: 'b', props: { label: 'Go' } }] })).toEqual({ primaryType: 'Button', title: 'Go' });
  });
});
