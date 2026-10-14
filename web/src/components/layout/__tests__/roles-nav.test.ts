import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isNavEntryVisible } from '@/components/layout/nav-visibility';

/**
 * AC-UX-03A: مدخل «الأدوار والصلاحيات» في مجموعة الإعدادات يُحرَس بـ`roles.view` (الصلاحية
 * لا اسم الدور). قبل ذلك كان تبويباً داخل الموارد البشرية يظهر لـ owner/admin بالاسم فقط.
 */
const NONE = new Set<string>();
const entry = { permission: 'roles.view' };

describe('roles sidebar entry', () => {
  it('follows roles.view, not the role name', () => {
    expect(isNavEntryVisible(entry, NONE, { role: 'owner', permissions: ['*'] })).toBe(true);
    expect(isNavEntryVisible(entry, NONE, { role: 'role-ab12cd34', permissions: ['roles.view'] })).toBe(true);
    expect(isNavEntryVisible(entry, NONE, { role: 'admin', permissions: ['invoices.view'] })).toBe(false);
    expect(isNavEntryVisible(entry, NONE, { role: 'accountant', permissions: ['users.view'] })).toBe(false);
    expect(isNavEntryVisible(entry, NONE, null)).toBe(false);
  });

  it('is declared once in the settings group, gated by roles.view and with no appKey', () => {
    const source = readFileSync(fileURLToPath(new URL('../sidebar.tsx', import.meta.url)), 'utf8');
    const line = source.split('\n').filter((l) => l.includes("href: '/roles'"));

    expect(line).toHaveLength(1);
    expect(line[0]).toContain("key: 'roles'");
    expect(line[0]).toContain("permission: 'roles.view'");
    expect(line[0]).not.toContain('appKey');

    const settings = source.slice(source.indexOf("title: 'settings'"), source.indexOf("title: 'developer'"));
    expect(settings).toContain("href: '/roles'");
  });
});
