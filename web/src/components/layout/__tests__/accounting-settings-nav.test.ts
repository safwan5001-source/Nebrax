import { describe, expect, it } from 'vitest';
import { isNavEntryVisible } from '@/components/layout/nav-visibility';

/**
 * ACC-1: عنصر «إعدادات المحاسبة» في الشريط محروس بصلاحية `accounting_settings.view`
 * وحدها — نفس مرآة `Rbac::allows` التي يفرضها الخادم، لا مجرّد إخفاء واجهة.
 */
const NONE = new Set<string>();
const entry = { permission: 'accounting_settings.view' };

describe('accounting settings sidebar leaf visibility', () => {
  it('is visible to owner/admin via the wildcard fallback (permissions absent)', () => {
    expect(isNavEntryVisible(entry, NONE, { role: 'owner' })).toBe(true);
    expect(isNavEntryVisible(entry, NONE, { role: 'admin' })).toBe(true);
  });

  it('is hidden from accountant/staff by default (explicit permission list without it)', () => {
    expect(isNavEntryVisible(entry, NONE, { role: 'accountant', permissions: ['invoices.view', 'cost_centers.view'] })).toBe(false);
    expect(isNavEntryVisible(entry, NONE, { role: 'staff', permissions: ['invoices.view'] })).toBe(false);
  });

  it('is visible to a custom role explicitly granted accounting_settings.view', () => {
    expect(isNavEntryVisible(entry, NONE, { role: 'custom_accountant', permissions: ['accounting_settings.view'] })).toBe(true);
  });

  it('is hidden when the viewer is unknown', () => {
    expect(isNavEntryVisible(entry, NONE, null)).toBe(false);
  });
});
