import { describe, expect, it } from 'vitest';
import { eligibleOperators, nameKey, operatorChoices, operatorName, readOperatorDirectory, type OperatorEntry } from './ingress-operators';

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

describe('nameKey (conservative: what looks like one name is one name)', () => {
  it.each([
    ['Sam', 'sam'], ['Sam', '  Sam  '], ['José', 'Jose'], ['Sam', 'ＳＡＭ'],
    ['محمد', 'مُحَمَّد'], ['محمد', 'محـمد'], ['Sam   Lee', 'sam lee'],
  ])('%j and %j collide', (a, b) => {
    expect(nameKey(a)).toBe(nameKey(b));
  });

  it.each([['Sam', 'Sami'], ['محمد', 'أحمد'], ['Sam Lee', 'SamLee']])('%j and %j stay different', (a, b) => {
    expect(nameKey(a)).not.toBe(nameKey(b));
  });
});

describe('operatorChoices — same-name candidates are excluded together, never numbered', () => {
  const point = { branchId: null as string | null };

  it('two eligible operators with the same name are both excluded and the name is reported once', () => {
    const list = [entry({ id: 'a', name: 'Sam' }), entry({ id: 'b', name: 'sam ' }), entry({ id: 'c', name: 'Lina' })];
    const { selectable, ambiguousNames } = operatorChoices(list, point, null);
    expect(selectable.map((e) => e.id)).toEqual(['c']);
    expect(ambiguousNames).toEqual(['Sam']);
  });

  it('a unique name next to a colliding pair stays selectable', () => {
    const list = [entry({ id: 'a', name: 'Amal' }), entry({ id: 'b', name: 'Amal' }), entry({ id: 'c', name: 'Bader' }), entry({ id: 'd', name: 'Cara' })];
    const { selectable, ambiguousNames } = operatorChoices(list, point, null);
    expect(selectable.map((e) => e.name)).toEqual(['Bader', 'Cara']);
    expect(ambiguousNames).toEqual(['Amal']);
  });

  it('distinct names behave exactly as before (no regression)', () => {
    const list = [entry({ id: 'a', name: 'Zed' }), entry({ id: 'b', name: 'Abe' }), entry({ id: 'cur', name: 'Current' })];
    const { selectable, ambiguousNames } = operatorChoices(list, point, 'cur');
    expect(selectable.map((e) => e.name)).toEqual(['Abe', 'Zed']);
    expect(ambiguousNames).toEqual([]);
  });

  it('a candidate sharing the CURRENT operator\'s name is excluded too (no "from Sam to Sam"), while the current operator is never a candidate', () => {
    const list = [entry({ id: 'cur', name: 'Sam' }), entry({ id: 'x', name: 'Sam' }), entry({ id: 'y', name: 'Lina' })];
    const { selectable, ambiguousNames } = operatorChoices(list, point, 'cur');
    expect(selectable.map((e) => e.id)).toEqual(['y']);
    expect(ambiguousNames).toEqual(['Sam']);
  });

  it('only ELIGIBLE candidates are compared: an inactive or out-of-scope namesake does not exclude an eligible user', () => {
    const list = [entry({ id: 'a', name: 'Sam' }), entry({ id: 'off', name: 'Sam', active: false }), entry({ id: 'br', name: 'Sam', branchIds: ['br-9'] })];
    const { selectable, ambiguousNames } = operatorChoices(list, point, null);
    expect(selectable.map((e) => e.id)).toEqual(['a']);
    expect(ambiguousNames).toEqual([]);
  });

  it('exposes no email, id or any distinguishing data — only names', () => {
    const list = [entry({ id: 'secret-id-1', name: 'Sam' }), entry({ id: 'secret-id-2', name: 'Sam' })];
    expect(JSON.stringify(operatorChoices(list, point, null))).not.toContain('secret-id');
  });
});
