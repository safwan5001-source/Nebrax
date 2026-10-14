import { describe, expect, it } from 'vitest';
import {
  filterUsers,
  resolveRoleLabel,
  rowCapabilities,
  sortUsers,
  summarizeScope,
  type RoleSummary,
  type UserRecord,
} from './model';

const user = (over: Partial<UserRecord> = {}): UserRecord => ({
  id: 'u1', name: 'Hind', email: 'hind@acme.test', role: 'staff', is_active: true, branch_ids: [], warehouse_ids: [], ...over,
});

describe('summarizeScope', () => {
  const branches = [{ id: 'b1', name: 'Dammam' }, { id: 'b2', name: 'Khobar' }, { id: 'b3', name: 'Jubail' }];

  it('treats an empty or absent assignment as ALL, never as none', () => {
    expect(summarizeScope([], branches)).toEqual({ kind: 'all' });
    expect(summarizeScope(undefined, null)).toEqual({ kind: 'all' });
  });

  it('shows the first name plus the remaining count', () => {
    expect(summarizeScope(['b1'], branches)).toEqual({ kind: 'names', first: 'Dammam', more: 0 });
    expect(summarizeScope(['b1', 'b2', 'b3'], branches)).toEqual({ kind: 'names', first: 'Dammam', more: 2 });
  });

  it('falls back to a count when names are unavailable or partially out of view', () => {
    expect(summarizeScope(['b1', 'b2'], null)).toEqual({ kind: 'count', count: 2 });
    expect(summarizeScope(['b1', 'hidden'], branches)).toEqual({ kind: 'count', count: 2 });
  });
});

describe('resolveRoleLabel', () => {
  const roles: RoleSummary[] = [
    { id: 'r1', slug: 'admin', name: 'Operations Lead', is_owner: false, is_system: true },
    { id: 'r2', slug: 'role-ab12cd34', name: 'Branch manager', is_owner: false, is_system: false },
  ];
  const system = { owner: 'Owner', admin: 'Admin', staff: 'Staff' };

  it('prefers the fetched name, including a renamed system role', () => {
    expect(resolveRoleLabel('admin', roles, system)).toEqual({ kind: 'name', name: 'Operations Lead' });
    expect(resolveRoleLabel('role-ab12cd34', roles, system)).toEqual({ kind: 'name', name: 'Branch manager' });
  });

  it('falls back to the system translation without roles.view', () => {
    expect(resolveRoleLabel('staff', null, system)).toEqual({ kind: 'name', name: 'Staff' });
  });

  it('never exposes a raw custom slug as a name', () => {
    expect(resolveRoleLabel('role-ab12cd34', null, system)).toEqual({ kind: 'custom' });
    expect(resolveRoleLabel('constructor', null, system)).toEqual({ kind: 'custom' });
  });
});

describe('filterUsers / sortUsers', () => {
  const users = [
    user({ id: 'a', name: 'Zaid', email: 'z@acme.test', role: 'admin' }),
    user({ id: 'b', name: 'Amal', email: 'amal@acme.test', is_active: false, branch_ids: ['b1'], employee: { id: 'e1', name: 'Amal Q', employee_no: 'E-17' } }),
    user({ id: 'c', name: 'Mona', email: 'm@acme.test', warehouse_ids: ['w1'] }),
  ];
  const base = { search: '', status: '' as const, role: '', scope: '' as const };

  it('searches name, email and linked employee', () => {
    expect(filterUsers(users, { ...base, search: 'AMAL' }).map((u) => u.id)).toEqual(['b']);
    expect(filterUsers(users, { ...base, search: 'e-17' }).map((u) => u.id)).toEqual(['b']);
    expect(filterUsers(users, { ...base, search: 'm@acme' }).map((u) => u.id)).toEqual(['c']);
  });

  it('filters status, role and scope (restricted = any branch OR warehouse assignment)', () => {
    expect(filterUsers(users, { ...base, status: 'inactive' }).map((u) => u.id)).toEqual(['b']);
    expect(filterUsers(users, { ...base, role: 'admin' }).map((u) => u.id)).toEqual(['a']);
    expect(filterUsers(users, { ...base, scope: 'restricted' }).map((u) => u.id)).toEqual(['b', 'c']);
    expect(filterUsers(users, { ...base, scope: 'all' }).map((u) => u.id)).toEqual(['a']);
  });

  it('keeps server order for newest and sorts by name without mutating', () => {
    expect(sortUsers(users, 'newest', 'en')).toBe(users);
    expect(sortUsers(users, 'name', 'en').map((u) => u.id)).toEqual(['b', 'c', 'a']);
    expect(sortUsers(users, '-name', 'en').map((u) => u.id)).toEqual(['a', 'c', 'b']);
    expect(users.map((u) => u.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('rowCapabilities', () => {
  const manager = { id: 'me', role: 'admin', canManage: true };

  it('offers nothing to a view-only viewer', () => {
    const caps = rowCapabilities({ id: 'me', role: 'staff', canManage: false }, user());
    expect(Object.values(caps).every((c) => !c.allowed && c.reason === undefined)).toBe(true);
  });

  it('protects owner accounts from non-owners but not from owners', () => {
    const owner = user({ id: 'o', role: 'owner' });
    expect(rowCapabilities(manager, owner).edit).toEqual({ allowed: false, reason: 'owner_protected' });
    expect(rowCapabilities({ id: 'o2', role: 'owner', canManage: true }, owner).edit.allowed).toBe(true);
  });

  it('blocks self-delete and self-deactivate with reasons but allows editing self', () => {
    const caps = rowCapabilities(manager, user({ id: 'me' }));
    expect(caps.edit.allowed).toBe(true);
    expect(caps.remove).toEqual({ allowed: false, reason: 'self_delete' });
    expect(caps.toggle).toEqual({ allowed: false, reason: 'self_deactivate' });
  });

  it('cannot invite a user without an email', () => {
    expect(rowCapabilities(manager, user({ email: ' ' })).invite).toEqual({ allowed: false, reason: 'no_email' });
  });
});
