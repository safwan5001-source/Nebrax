import { describe, expect, it } from 'vitest';
import type { RoleSummary, UserRecord } from './model';
import { buildAccessSummary, roleDetail, scopeDetail } from './summary';

const role = (over: Partial<RoleSummary>): RoleSummary => ({ id: 'r', slug: 'x', name: 'X', is_owner: false, is_system: false, ...over });
const user = (over: Partial<UserRecord> = {}): UserRecord => ({ id: 'u1', name: 'Hind', email: 'h@x.test', role: 'staff', is_active: true, ...over });

describe('scopeDetail', () => {
  const options = [{ id: 'b1', name: 'Khobar' }, { id: 'b2', name: 'Dammam' }];
  it('empty or missing stored scope means "all", never "none"', () => {
    expect(scopeDetail([], options)).toEqual({ kind: 'all' });
    expect(scopeDetail(undefined, null)).toEqual({ kind: 'all' });
  });
  it('lists resolved names sorted, and counts the ids the viewer cannot see', () => {
    expect(scopeDetail(['b1', 'b2', 'ghost'], options)).toEqual({ kind: 'names', names: ['Dammam', 'Khobar'], hidden: 1 });
  });
  it('falls back to the count (no invented names) when the list is unavailable', () => {
    expect(scopeDetail(['b1', 'b2'], null)).toEqual({ kind: 'count', count: 2 });
  });
});

describe('roleDetail', () => {
  const systemNames = { staff: 'Staff', admin: 'Admin' };
  it('reads kind and permission counts from the roles list, with sensitive count', () => {
    const roles = [role({ slug: 'role-ab12cd34', name: 'Cashier', permissions: ['invoices.view', 'roles.manage'] })];
    const detail = roleDetail('role-ab12cd34', roles, systemNames);
    expect(detail.label).toEqual({ kind: 'name', name: 'Cashier' });
    expect(detail.kind).toBe('custom');
    expect(detail.access?.kind).toBe('count');
    if (detail.access?.kind === 'count') {
      expect(detail.access.count).toBe(2);
      expect(detail.access.sensitive).toBeGreaterThanOrEqual(1);
    }
  });
  it('wildcard is "full", owner is flagged', () => {
    const roles = [role({ slug: 'owner', name: 'Owner', is_owner: true, is_system: true, permissions: ['*'] })];
    expect(roleDetail('owner', roles, systemNames)).toMatchObject({ kind: 'owner', access: { kind: 'full' } });
  });
  it('without a roles list: system roles keep their translated name, custom ones are generic, no counts', () => {
    expect(roleDetail('staff', null, systemNames)).toEqual({ label: { kind: 'name', name: 'Staff' }, kind: 'system', access: null });
    expect(roleDetail('role-ab12cd34', null, systemNames)).toEqual({ label: { kind: 'custom' }, kind: null, access: null });
  });
  it('a listed role without permissions keeps counts unknown', () => {
    expect(roleDetail('staff', [role({ slug: 'staff', is_system: true })], systemNames).access).toBeNull();
  });
});

describe('buildAccessSummary', () => {
  it('assembles source assignments only', () => {
    const summary = buildAccessSummary(
      user({ is_active: false, branch_ids: ['b1'], employee: { id: 'e1', name: 'Hind A.', employee_no: 'E-7' } }),
      { roles: null, branches: [{ id: 'b1', name: 'Dammam' }], warehouses: null, systemNames: { staff: 'Staff' } },
    );
    expect(summary.signIn).toBe('blocked');
    expect(summary.branches).toEqual({ kind: 'names', names: ['Dammam'], hidden: 0 });
    expect(summary.warehouses).toEqual({ kind: 'all' });
    expect(summary.employee).toEqual({ id: 'e1', label: 'E-7 — Hind A.' });
    expect(Object.keys(summary).sort()).toEqual(['branches', 'employee', 'role', 'signIn', 'warehouses']);
  });
});
