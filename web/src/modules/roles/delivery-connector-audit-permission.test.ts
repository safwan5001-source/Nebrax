import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import enMessages from '@/messages/en.json';
import arMessages from '@/messages/ar.json';
import { groupCatalog, parsePermission, permissionLabel, moduleLabel, type CatalogLabels } from './catalog';
import { PERMISSION_RISK, riskCounts, riskOf, sensitiveKeys } from './risk';

/**
 * INT-UX-6 / PR-6a — الصلاحية المستقلة `delivery_connector.audit.view` في محرر الأدوار:
 * تصنيف `data` (D6)، وتسميات عربية/إنجليزية صحيحة من رسائل المنتج الحقيقية، دون تغيير بنية المحرر.
 */
const KEY = 'delivery_connector.audit.view';
const SIBLINGS = ['delivery_connector.view', 'delivery_connector.manage', 'delivery_connector.reassign'];

const source = readFileSync(fileURLToPath(new URL('../../../../app/Support/Rbac.php', import.meta.url)), 'utf8');
const block = /const PERMISSIONS = \[(.*?)\];/s.exec(source);
const SERVER_CATALOG = block ? [...block[1].matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]) : [];

function labelsOf(locale: 'en' | 'ar'): CatalogLabels {
  const hr = (locale === 'en' ? enMessages : arMessages).hr as unknown as { perm_modules: Record<string, string>; perm_actions: Record<string, string>; perm_areas: Record<string, string> };
  return { modules: hr.perm_modules, actions: hr.perm_actions, areas: hr.perm_areas };
}

describe('risk classification (D6)', () => {
  it('flags the audit key as sensitive data, and nothing else about delivery connectors changes', () => {
    expect(riskOf(KEY)).toBe('data');
    expect(PERMISSION_RISK[KEY]).toBe('data');
    for (const sibling of SIBLINGS) expect(riskOf(sibling), sibling).toBeNull();
    expect(sensitiveKeys([...SIBLINGS, KEY])).toEqual([KEY]);
    expect(riskCounts([...SIBLINGS, KEY])).toEqual({ access: 0, financial: 0, compliance: 0, data: 1 });
  });

  it('the key exists in the server registry exactly once (no drift, no duplicate)', () => {
    expect(SERVER_CATALOG.filter((key) => key === KEY)).toHaveLength(1);
    // والأشقاء الثلاثة ما زالوا في السجل وفي موضعهم المجاور.
    const at = SERVER_CATALOG.indexOf('delivery_connector.view');
    expect(SERVER_CATALOG.slice(at, at + 4)).toEqual([...SIBLINGS, KEY]);
  });
});

describe('catalog and labels (real product messages)', () => {
  it('parses to module delivery_connector / area audit / action view without special-casing', () => {
    expect(parsePermission(KEY)).toEqual({ key: KEY, module: 'delivery_connector', areas: ['audit'], action: 'view' });
  });

  it.each([
    ['en', 'Delivery connectors', 'Audit — View'],
    ['ar', 'موصّلات التوصيل', 'التدقيق — عرض'],
  ] as const)('%s: the module and the permission read correctly and never collide with the plain "View"', (locale, moduleName, label) => {
    const labels = labelsOf(locale);
    const entry = parsePermission(KEY);
    expect(moduleLabel(entry.module, labels)).toBe(moduleName);
    expect(permissionLabel(entry, labels)).toBe(label);

    const group = groupCatalog(SERVER_CATALOG).find((g) => g.module === 'delivery_connector');
    expect(group).toBeTruthy();
    const names = group!.entries.map((e) => permissionLabel(e, labels));
    expect(group!.entries.map((e) => e.key).sort()).toEqual([KEY, ...SIBLINGS].sort());
    expect(new Set(names).size).toBe(names.length); // لا تسميتان متطابقتان في الوحدة
    // التسمية الجديدة تحمل «التدقيق/Audit» فلا تُلتبس بـ«عرض/View» العادية.
    expect(names.filter((n) => n === labels.actions.view)).toHaveLength(1);
  });

  it('the editor-facing translations needed by the new key already exist in both locales (no new message added)', () => {
    for (const locale of ['en', 'ar'] as const) {
      const labels = labelsOf(locale);
      expect(labels.modules.delivery_connector, locale).toBeTruthy();
      expect(labels.areas.audit, locale).toBeTruthy();
      expect(labels.actions.view, locale).toBeTruthy();
    }
  });
});
