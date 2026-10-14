import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isNavEntryVisible } from '@/components/layout/nav-visibility';

/**
 * AC-UX-01: مدخل «المستخدمون» في مجموعة الإعدادات يُحرَس بـ`users.view` (الصلاحية لا
 * اسم الدور). قبل ذلك كان تبويباً داخل الموارد البشرية يظهر لـ owner/admin بالاسم فقط.
 */
const NONE = new Set<string>();
const entry = { permission: 'users.view' };

describe('users sidebar entry', () => {
  it('follows users.view, not the role name', () => {
    expect(isNavEntryVisible(entry, NONE, { role: 'owner', permissions: ['*'] })).toBe(true);
    expect(isNavEntryVisible(entry, NONE, { role: 'role-ab12cd34', permissions: ['users.view'] })).toBe(true);
    // admin جُرِّد من الصلاحية (قائمة صريحة) فلا مدخل يردّ مساره 403
    expect(isNavEntryVisible(entry, NONE, { role: 'admin', permissions: ['invoices.view'] })).toBe(false);
    expect(isNavEntryVisible(entry, NONE, { role: 'accountant', permissions: ['invoices.view'] })).toBe(false);
    expect(isNavEntryVisible(entry, NONE, null)).toBe(false);
  });

  it('is declared once in the settings group, gated by users.view and with no appKey', () => {
    const source = readFileSync(fileURLToPath(new URL('../sidebar.tsx', import.meta.url)), 'utf8');
    const line = source.split('\n').filter((l) => l.includes("href: '/users'"));

    expect(line).toHaveLength(1);
    expect(line[0]).toContain("key: 'users'");
    expect(line[0]).toContain("permission: 'users.view'");
    expect(line[0]).not.toContain('appKey');

    const settings = source.slice(source.indexOf("title: 'settings'"), source.indexOf("title: 'developer'"));
    expect(settings).toContain("href: '/users'");
  });
});
