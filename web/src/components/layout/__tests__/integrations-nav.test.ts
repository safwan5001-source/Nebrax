import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isNavEntryVisible } from '@/components/layout/nav-visibility';

/**
 * INT-UX-1: مدخل «مركز التكاملات» في مجموعة الإعدادات. محروس بـ`invoices.view` (الفئة
 * الفاعلة الوحيدة اليوم هي منصات التوصيل) بمرآة `Rbac::allows`، وبلا `appKey` لأن
 * المركز يمتدّ إلى فئات مستقبلية بقدرات مختلفة. لا صلاحية جديدة.
 */
const NONE = new Set<string>();
const entry = { permission: 'invoices.view' };

describe('integration center sidebar entry', () => {
  it('is visible to owner/admin through the wildcard fallback and to roles with invoices.view', () => {
    expect(isNavEntryVisible(entry, NONE, { role: 'owner' })).toBe(true);
    expect(isNavEntryVisible(entry, NONE, { role: 'admin' })).toBe(true);
    expect(isNavEntryVisible(entry, NONE, { role: 'accountant', permissions: ['invoices.view'] })).toBe(true);
    expect(isNavEntryVisible(entry, NONE, { role: 'staff', permissions: ['invoices.view', 'reports.view'] })).toBe(true);
  });

  it('is hidden from self-service and unknown viewers, so no entry ends in a denial page', () => {
    expect(isNavEntryVisible(entry, NONE, { role: 'self_service', permissions: ['self_service.access'] })).toBe(false);
    expect(isNavEntryVisible(entry, NONE, null)).toBe(false);
  });

  it('stays visible when the POS application is hidden (the page explains it; no appKey on the entry)', () => {
    expect(isNavEntryVisible(entry, new Set(['sales.pos']), { role: 'owner' })).toBe(true);
  });

  it('is declared once in the settings group with the documented shape and no new permission', () => {
    const source = readFileSync(fileURLToPath(new URL('../sidebar.tsx', import.meta.url)), 'utf8');
    const line = source.split('\n').filter((l) => l.includes("href: '/integrations'"));

    expect(line).toHaveLength(1);
    expect(line[0]).toContain("key: 'integrations'");
    expect(line[0]).toContain("permission: 'invoices.view'");
    expect(line[0]).not.toContain('appKey');

    const settings = source.slice(source.indexOf("title: 'settings'"), source.indexOf("title: 'developer'"));
    expect(settings).toContain("href: '/integrations'");
    expect(settings.indexOf("href: '/applications'")).toBeLessThan(settings.indexOf("href: '/integrations'"));
    expect(settings.indexOf("href: '/integrations'")).toBeLessThan(settings.indexOf("href: '/settings'"));
  });
});
