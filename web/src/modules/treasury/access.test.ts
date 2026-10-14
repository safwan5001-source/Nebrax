import { describe, expect, it } from 'vitest';
import {
  changeScope,
  describeAccess,
  excludesActor,
  lookupAvailable,
  payloadSubject,
  subjectMissing,
  subjectOptions,
  type AccessLookups,
} from './access';

const SYSTEM = { admin: 'Admin', staff: 'Staff' };
const FULL: AccessLookups = {
  roles: [
    { id: 'r1', slug: 'staff', name: 'Floor staff', is_owner: false, is_system: true },
    { id: 'r2', slug: 'role-ab12cd34', name: 'Cashier', is_owner: false, is_system: false },
  ] as never,
  users: [{ id: 'u1', name: 'Hind', email: 'hind@acme.test' }, { id: 'u2', name: 'Amal' }],
  branches: [{ id: 'b1', name: 'Dammam' }],
};
const NONE: AccessLookups = { roles: null, users: null, branches: null };

describe('describeAccess — names, never raw identifiers', () => {
  it('describes "all" and resolves each subject to its name', () => {
    expect(describeAccess('all', null, FULL, SYSTEM)).toEqual({ kind: 'all' });
    expect(describeAccess('role', 'role-ab12cd34', FULL, SYSTEM)).toEqual({ kind: 'role', label: 'Cashier' });
    expect(describeAccess('user', 'u1', FULL, SYSTEM)).toEqual({ kind: 'user', label: 'Hind \u2068(hind@acme.test)\u2069' });
    expect(describeAccess('branch', 'b1', FULL, SYSTEM)).toEqual({ kind: 'branch', label: 'Dammam' });
  });

  it('without the lookups, system roles still have a name; everything else is unresolved (label null), never the raw value', () => {
    expect(describeAccess('role', 'staff', NONE, SYSTEM)).toEqual({ kind: 'role', label: 'Staff' });
    expect(describeAccess('role', 'role-ab12cd34', NONE, SYSTEM)).toEqual({ kind: 'role', label: null });
    expect(describeAccess('user', 'u1', NONE, SYSTEM)).toEqual({ kind: 'user', label: null });
    expect(describeAccess('branch', 'b-deleted', FULL, SYSTEM)).toEqual({ kind: 'branch', label: null });
  });

  it('a subject-scope with an empty subject is unresolved too', () => {
    expect(describeAccess('role', '', FULL, SYSTEM)).toEqual({ kind: 'role', label: null });
  });
});

describe('subject selection', () => {
  it('lists named options per scope', () => {
    expect(subjectOptions('role', FULL, SYSTEM).map((o) => [o.value, o.label])).toEqual([['staff', 'Floor staff'], ['role-ab12cd34', 'Cashier']]);
    expect(subjectOptions('user', FULL, SYSTEM)[1]).toEqual({ value: 'u2', label: 'Amal' });
    expect(subjectOptions('all', FULL, SYSTEM)).toEqual([]);
  });

  it('reports whether the picker can be offered', () => {
    expect(lookupAvailable('all', NONE)).toBe(true);
    expect(lookupAvailable('role', NONE)).toBe(false);
    expect(lookupAvailable('branch', FULL)).toBe(true);
  });

  it('changing the scope clears the subject, and a non-all scope needs one', () => {
    expect(changeScope('user')).toEqual({ scope: 'user', subject: '' });
    expect(subjectMissing('role', '')).toBe(true);
    expect(subjectMissing('role', 'staff')).toBe(false);
    expect(subjectMissing('all', '')).toBe(false);
  });

  it('sends null for "all" (the server rejects a subject there)', () => {
    expect(payloadSubject('all', 'stale-value')).toBeNull();
    expect(payloadSubject('role', 'staff')).toBe('staff');
    expect(payloadSubject('role', ' ')).toBeNull();
  });
});

describe('excludesActor (self-lockout warning; owners and admins are not exempt)', () => {
  const me = { id: 'u1', role: 'admin' };
  it('role / user scopes exclude whoever is not the subject', () => {
    expect(excludesActor('role', 'staff', me)).toBe(true);
    expect(excludesActor('role', 'admin', me)).toBe(false);
    expect(excludesActor('user', 'u2', me)).toBe(true);
    expect(excludesActor('user', 'u1', me)).toBe(false);
  });
  it('"all", an empty subject, and branch (active branch unknown here) never claim exclusion', () => {
    expect(excludesActor('all', '', me)).toBe(false);
    expect(excludesActor('role', '', me)).toBe(false);
    expect(excludesActor('branch', 'b1', me)).toBeNull();
    expect(excludesActor('role', 'staff', { id: null, role: null })).toBeNull();
  });
});
