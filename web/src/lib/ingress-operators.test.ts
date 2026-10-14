import { describe, expect, it } from 'vitest';
import { eligibleOperators, operatorLabels, operatorName, readOperatorDirectory, type OperatorEntry } from './ingress-operators';

const user = (over: Record<string, unknown> = {}) => ({ id: 'u1', name: 'Amal', email: 'amal@example.test', role: 'cashier', is_active: true, branch_ids: [], employee_id: 'e1', ...over });
const entry = (over: Partial<OperatorEntry> = {}): OperatorEntry => ({ id: 'u1', name: 'Amal', active: true, branchIds: [], ...over });

describe('readOperatorDirectory (allow-list)', () => {
  it('keeps id, name, active and branch scope only — never email, role or anything else', () => {
    const [read] = readOperatorDirectory({ data: [user()] }) ?? [];
    expect(read).toEqual({ id: 'u1', name: 'Amal', active: true, branchIds: [] });
    expect(JSON.stringify(read)).not.toMatch(/example\.test|cashier|e1/);
  });

  it.each([null, undefined, {}, { data: null }, { data: {} }, { data: 'x' }])('returns null for a non-list payload (%j)', (payload) => {
    expect(readOperatorDirectory(payload)).toBeNull();
  });

  it('skips malformed rows, duplicate ids and unsafe names; keeps the valid ones', () => {
    const read = readOperatorDirectory({
      data: [
        user({ id: 'a' }), user({ id: 'a', name: 'Dup' }), user({ id: '../x' }), user({ id: 'b', name: '' }), user({ id: 'c', name: 'bad\u0007' }),
        user({ id: 'd', is_active: 'yes' }), user({ id: 'e', name: 'x'.repeat(201) }), null, 'str', [], user({ id: 'f', name: '  Fahd  ' }),
      ],
    });
    expect(read?.map((r) => [r.id, r.name])).toEqual([['a', 'Amal'], ['f', 'Fahd']]);
  });

  it('marks an unreadable branch scope as unknown (null), not as unrestricted', () => {
    const read = readOperatorDirectory({ data: [user({ id: 'a', branch_ids: undefined }), user({ id: 'b', branch_ids: [1] }), user({ id: 'c', branch_ids: ['br 1'] }), user({ id: 'd', branch_ids: ['br-1'] })] });
    expect(read?.map((r) => r.branchIds)).toEqual([null, null, null, ['br-1']]);
  });
});

describe('operatorName', () => {
  it('resolves a name or null (unknown id, null id, missing directory)', () => {
    expect(operatorName([entry()], 'u1')).toBe('Amal');
    expect(operatorName([entry()], 'zz')).toBeNull();
    expect(operatorName([entry()], null)).toBeNull();
    expect(operatorName(null, 'u1')).toBeNull();
  });
});

describe('eligibleOperators (mirror of the server rule — convenience, not authority)', () => {
  const all: OperatorEntry[] = [
    entry({ id: 'free', name: 'Free', branchIds: [] }),
    entry({ id: 'br1', name: 'OnlyBr1', branchIds: ['br-1'] }),
    entry({ id: 'br2', name: 'OnlyBr2', branchIds: ['br-2'] }),
    entry({ id: 'off', name: 'Inactive', active: false, branchIds: [] }),
    entry({ id: 'unk', name: 'UnknownScope', branchIds: null }),
    entry({ id: 'cur', name: 'Current', branchIds: [] }),
  ];

  it('routed point: unrestricted or branch-including users, active, excluding the current operator', () => {
    expect(eligibleOperators(all, { branchId: 'br-1' }, 'cur').map((e) => e.id)).toEqual(['free', 'br1']);
  });

  it('unrouted point: only unrestricted users qualify', () => {
    expect(eligibleOperators(all, { branchId: null }, 'cur').map((e) => e.id)).toEqual(['free']);
  });

  it('fails closed on unknown scope and excludes inactive users', () => {
    const ids = eligibleOperators(all, { branchId: 'br-1' }, null).map((e) => e.id);
    expect(ids).not.toContain('unk');
    expect(ids).not.toContain('off');
  });

  it('sorts by name', () => {
    const list = [entry({ id: 'b', name: 'Zed' }), entry({ id: 'a', name: 'Abe' })];
    expect(eligibleOperators(list, { branchId: null }, null).map((e) => e.name)).toEqual(['Abe', 'Zed']);
  });
});

describe('operatorLabels', () => {
  it('uses the bare name, and numbers only duplicated names — never an email or id', () => {
    const labels = operatorLabels([entry({ id: 'a', name: 'Sam' }), entry({ id: 'b', name: 'Sam' }), entry({ id: 'c', name: 'Lina' })]);
    expect(labels.get('a')).toBe('Sam (1)');
    expect(labels.get('b')).toBe('Sam (2)');
    expect(labels.get('c')).toBe('Lina');
  });
});
