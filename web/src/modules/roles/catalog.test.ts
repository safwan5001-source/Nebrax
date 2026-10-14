import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import {
  filterCatalog,
  filterRoles,
  grantedKeys,
  groupCatalog,
  parsePermission,
  permissionLabel,
  roleCounts,
  type CatalogLabels,
} from './catalog';

const LABELS: CatalogLabels = {
  modules: { invoices: 'Invoices', pos: 'Point of sale' },
  actions: { view: 'View', manage: 'Manage', export: 'Export' },
  areas: { audit: 'Audit' },
};
const CATALOG = ['invoices.manage', 'invoices.view', 'pos.audit.export', 'pos.audit.view', 'zzz.custom_thing'];

describe('parsePermission (display only)', () => {
  it('uses the last segment as the action and keeps the canonical key untouched', () => {
    expect(parsePermission('products.view')).toEqual({ key: 'products.view', module: 'products', areas: [], action: 'view' });
    expect(parsePermission('pos.session.handover.confirm')).toEqual({
      key: 'pos.session.handover.confirm', module: 'pos', areas: ['session', 'handover'], action: 'confirm',
    });
  });
});

describe('groupCatalog', () => {
  it('groups by module in first-seen order and sorts view, manage, then alphabetical', () => {
    const groups = groupCatalog(CATALOG);
    expect(groups.map((g) => g.module)).toEqual(['invoices', 'pos', 'zzz']);
    expect(groups[0].entries.map((e) => e.key)).toEqual(['invoices.view', 'invoices.manage']);
    expect(groups[1].entries.map((e) => e.key)).toEqual(['pos.audit.view', 'pos.audit.export']);
  });
});

describe('grantedKeys / roleCounts', () => {
  it('expands the wildcard to the whole catalogue and flags full access', () => {
    expect(roleCounts({ permissions: ['*'] }, CATALOG)).toEqual({ granted: 5, total: 5, full: true });
    expect(grantedKeys({ permissions: ['*'] }, CATALOG).size).toBe(5);
  });

  it('counts only keys that are in the catalogue', () => {
    const counts = roleCounts({ permissions: ['invoices.view', 'retired.thing'] }, CATALOG);
    expect(counts).toEqual({ granted: 1, total: 5, full: false });
  });
});

describe('labels', () => {
  it('prefixes the area and falls back to a humanised segment instead of inventing a translation', () => {
    expect(permissionLabel(parsePermission('invoices.view'), LABELS)).toBe('View');
    expect(permissionLabel(parsePermission('pos.audit.export'), LABELS)).toBe('Audit — Export');
    expect(permissionLabel(parsePermission('zzz.some_area.do_thing'), LABELS)).toBe('Some Area — Do Thing');
  });
});

describe('filterCatalog', () => {
  const groups = groupCatalog(CATALOG);
  const granted = new Set(['invoices.view', 'pos.audit.view']);
  const none = { query: '', grantedOnly: false };

  it('returns everything for an empty query and only granted keys when asked', () => {
    expect(filterCatalog(groups, none, granted, LABELS).flatMap((g) => g.entries)).toHaveLength(5);
    const only = filterCatalog(groups, { ...none, grantedOnly: true }, granted, LABELS).flatMap((g) => g.entries.map((e) => e.key));
    expect(only).toEqual(['invoices.view', 'pos.audit.view']);
  });

  it('matches the module name (showing the whole module), the label, and the exact key', () => {
    const byModule = filterCatalog(groups, { ...none, query: 'point of' }, granted, LABELS);
    expect(byModule.map((g) => g.module)).toEqual(['pos']);
    expect(byModule[0].entries).toHaveLength(2);

    const byLabel = filterCatalog(groups, { ...none, query: 'audit — exp' }, granted, LABELS).flatMap((g) => g.entries.map((e) => e.key));
    expect(byLabel).toEqual(['pos.audit.export']);

    const byKey = filterCatalog(groups, { ...none, query: 'invoices.manage' }, granted, LABELS).flatMap((g) => g.entries.map((e) => e.key));
    expect(byKey).toEqual(['invoices.manage']);
  });

  it('drops groups with no matches', () => {
    expect(filterCatalog(groups, { ...none, query: 'nothing-like-this' }, granted, LABELS)).toEqual([]);
  });
});

describe('filterRoles', () => {
  it('filters by name, case-insensitively', () => {
    const roles = [{ name: 'Branch manager' }, { name: 'Accountant' }];
    expect(filterRoles(roles, 'BRANCH')).toEqual([{ name: 'Branch manager' }]);
    expect(filterRoles(roles, '  ')).toEqual(roles);
  });
});

/**
 * حارس الانجراف (P-1): كل وحدة وفعل ومجال في `Rbac::PERMISSIONS` له تسمية بالعربية والإنجليزية.
 * الصلاحية الجديدة في الخادم بلا تسمية تُفشل هذا الاختبار بدل أن تظهر مفتاحاً خاماً في الواجهة.
 */
describe('permission label coverage (Rbac::PERMISSIONS)', () => {
  const source = readFileSync(fileURLToPath(new URL('../../../../app/Support/Rbac.php', import.meta.url)), 'utf8');
  const block = /const PERMISSIONS = \[(.*?)\];/s.exec(source);
  const keys = block ? [...block[1].matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]) : [];
  const parsed = keys.map(parsePermission);

  it('reads the server catalogue', () => {
    expect(keys.length).toBeGreaterThan(100);
  });

  for (const [name, messages] of [['en', en], ['ar', ar]] as const) {
    it(`${name}: every module, action and area has a label`, () => {
      const hr = (messages as unknown as { hr: { perm_modules: Record<string, string>; perm_actions: Record<string, string>; perm_areas: Record<string, string> } }).hr;
      const missing = {
        modules: [...new Set(parsed.map((p) => p.module))].filter((m) => !hr.perm_modules[m]),
        actions: [...new Set(parsed.map((p) => p.action))].filter((a) => !hr.perm_actions[a]),
        areas: [...new Set(parsed.flatMap((p) => p.areas))].filter((a) => !hr.perm_areas[a]),
      };
      expect(missing).toEqual({ modules: [], actions: [], areas: [] });
    });
  }
});
