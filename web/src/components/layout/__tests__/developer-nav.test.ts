import { describe, expect, it } from 'vitest';
import { isNavEntryVisible } from '@/components/layout/nav-visibility';

/**
 * تكامل مجموعة المطورين في الشريط: تُحرَس بصلاحية `developer.view` على مستوى
 * المجموعة كاملة، فتظهر للمالك/المدير وتختفي لمن دونها — **لا مجرّد إخفاء واجهة**،
 * بل نفس مرآة `Rbac::allows` التي يفرضها الخادم على `/api/developer/*`.
 */
const NONE = new Set<string>();
const groupEntry = { permission: 'developer.view' };

describe('developer sidebar group visibility', () => {
  it('is visible to owner/admin via the wildcard fallback (permissions absent)', () => {
    expect(isNavEntryVisible(groupEntry, NONE, { role: 'owner' })).toBe(true);
    expect(isNavEntryVisible(groupEntry, NONE, { role: 'admin' })).toBe(true);
  });

  it('is hidden from a role without developer.view (explicit permission list)', () => {
    expect(isNavEntryVisible(groupEntry, NONE, { role: 'staff', permissions: ['pos.view'] })).toBe(false);
    expect(isNavEntryVisible(groupEntry, NONE, { role: 'accountant', permissions: ['invoices.view'] })).toBe(false);
  });

  it('is visible to a custom role explicitly granted developer.view', () => {
    expect(isNavEntryVisible(groupEntry, NONE, { role: 'dev_viewer', permissions: ['developer.view'] })).toBe(true);
  });

  it('is hidden when the viewer is unknown', () => {
    expect(isNavEntryVisible(groupEntry, NONE, null)).toBe(false);
  });
});
