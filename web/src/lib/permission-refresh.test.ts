import { describe, expect, it } from 'vitest';
import type { AuthUser } from './auth';
import { mergeRefreshedAccess } from './permission-refresh';

const me = (over: Partial<AuthUser> = {}): AuthUser => ({
  id: 'u1', name: 'Safwan', email: 's@x.test', role: 'staff', tenant_id: 't1',
  permissions: ['invoices.view'], preferences: { locale: 'ar', theme: 'dark' }, ...over,
});

describe('mergeRefreshedAccess', () => {
  it('returns null when nothing changed (no needless write)', () => {
    expect(mergeRefreshedAccess(me(), { id: 'u1', role: 'staff', permissions: ['invoices.view'] })).toBeNull();
  });

  it('ignores ordering differences', () => {
    const current = me({ permissions: ['a.view', 'b.view'] });
    expect(mergeRefreshedAccess(current, { id: 'u1', role: 'staff', permissions: ['b.view', 'a.view'] })).toBeNull();
  });

  it('adopts a revoked and a granted permission, touching only role + permissions', () => {
    const next = mergeRefreshedAccess(me(), {
      id: 'u1', role: 'role-ab12cd34', permissions: ['payments.view'], name: 'Renamed', preferences: { locale: 'en', theme: 'light' },
    });
    expect(next).toEqual(me({ role: 'role-ab12cd34', permissions: ['payments.view'] }));
    expect(next?.name).toBe('Safwan');
    expect(next?.preferences).toEqual({ locale: 'ar', theme: 'dark' });
  });

  it('adopts an empty list (an explicit "no permission")', () => {
    expect(mergeRefreshedAccess(me(), { id: 'u1', role: 'staff', permissions: [] })?.permissions).toEqual([]);
  });

  it('upgrades legacy storage that has no list', () => {
    const legacy = me();
    delete legacy.permissions;
    expect(mergeRefreshedAccess(legacy, { id: 'u1', role: 'staff', permissions: ['invoices.view'] })?.permissions).toEqual(['invoices.view']);
  });

  it('never adopts another user, a missing list, or nothing', () => {
    expect(mergeRefreshedAccess(me(), { id: 'other', role: 'owner', permissions: ['*'] })).toBeNull();
    expect(mergeRefreshedAccess(me(), { id: 'u1', role: 'owner' })).toBeNull();
    expect(mergeRefreshedAccess(me(), null)).toBeNull();
    expect(mergeRefreshedAccess(null, { id: 'u1', permissions: ['*'] })).toBeNull();
  });

  it('keeps the stored role when the response carries none', () => {
    expect(mergeRefreshedAccess(me(), { id: 'u1', permissions: ['x.view'] })?.role).toBe('staff');
  });
});
