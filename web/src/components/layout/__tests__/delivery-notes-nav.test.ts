import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hiddenApplicationKeys, isNavEntryVisible } from '@/components/layout/nav-visibility';

/**
 * AWJ-BACKEND-NAV-01: مدخل «سندات التسليم» يتبع بوابتي الخادم معاً — الاستحقاق التجاري لـ`sales.invoicing`
 * (يصل الآن صريحاً في `nav-state` بدل الغياب الذي كانت الواجهة تقرؤه «ظاهراً دائماً») و`delivery_notes.view`.
 */
const entry = { appKey: 'sales.invoicing', permission: 'delivery_notes.view' };
const owner = { role: 'owner' };

describe('delivery notes sidebar entry', () => {
  it('is hidden when nav-state reports sales.invoicing as not entitled, even for the owner', () => {
    expect(isNavEntryVisible(entry, hiddenApplicationKeys({ 'sales.invoicing': false }), owner)).toBe(false);
  });

  it('is visible to an entitled tenant whose user holds delivery_notes.view', () => {
    const shown = hiddenApplicationKeys({ 'sales.invoicing': true });
    expect(isNavEntryVisible(entry, shown, owner)).toBe(true);
    expect(isNavEntryVisible(entry, shown, { role: 'accountant', permissions: ['delivery_notes.view'] })).toBe(true);
  });

  it('stays hidden from a user without delivery_notes.view even when the tenant is entitled', () => {
    expect(isNavEntryVisible(entry, hiddenApplicationKeys({ 'sales.invoicing': true }), { role: 'staff', permissions: ['invoices.view'] })).toBe(false);
  });

  it('is declared once with the backend route guard key and permission', () => {
    const source = readFileSync(fileURLToPath(new URL('../sidebar.tsx', import.meta.url)), 'utf8');
    const line = source.split('\n').filter((l) => l.includes("href: '/delivery-notes'"));

    expect(line).toHaveLength(1);
    expect(line[0]).toContain("appKey: 'sales.invoicing'");
    expect(line[0]).toContain("permission: 'delivery_notes.view'");
  });
});
