import { describe, expect, it } from 'vitest';
import {
  accessSummary,
  createPayload,
  diffPayload,
  hiddenIds,
  isDirty,
  scopeDraftFromStored,
  scopeIssue,
  scopeIssues,
  scopePayload,
  scopeToPayload,
  toggleId,
  type EditorCapabilities,
  type EditorForm,
  type ScopeForm,
} from './editor';

const form = (over: Partial<EditorForm> = {}): EditorForm => ({
  name: 'Hind', email: 'hind@acme.test', password: '', sendInvitation: false, role: 'staff',
  employeeId: '', isActive: true,
  branches: { mode: 'all', ids: [] }, warehouses: { mode: 'all', ids: [] }, ...over,
});
const ALL: EditorCapabilities = { role: true, employee: true, branches: true, warehouses: true };

describe('scope draft (empty stored = ALL, never "none")', () => {
  it('maps stored values to explicit modes', () => {
    expect(scopeDraftFromStored([])).toEqual({ mode: 'all', ids: [] });
    expect(scopeDraftFromStored(undefined)).toEqual({ mode: 'all', ids: [] });
    expect(scopeDraftFromStored(['b1', 'b2'])).toEqual({ mode: 'selected', ids: ['b1', 'b2'] });
  });

  it('serialises ALL to [] (unrestricted) and SELECTED to the ids — and keeps ids when switching to ALL', () => {
    expect(scopeToPayload({ mode: 'all', ids: ['b1'] })).toEqual([]);
    expect(scopeToPayload({ mode: 'selected', ids: ['b1'] })).toEqual(['b1']);
  });

  it('refuses SELECTED with nothing chosen (it would silently become ALL)', () => {
    expect(scopeIssue({ mode: 'selected', ids: [] }, false)).toBe('selected_empty');
    expect(scopeIssue({ mode: 'selected', ids: ['b1'] }, false)).toBeNull();
    expect(scopeIssue({ mode: 'all', ids: [] }, false)).toBeNull();
  });

  it('a restricted actor cannot choose ALL for the restricted dimension', () => {
    expect(scopeIssue({ mode: 'all', ids: [] }, true)).toBe('all_not_allowed');
    expect(scopeIssue({ mode: 'selected', ids: ['b1'] }, true)).toBeNull();
  });

  it('toggles ids and counts assignments the viewer cannot see', () => {
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
    expect(hiddenIds(['a', 'x', 'y'], [{ id: 'a' }])).toBe(2);
    expect(hiddenIds(['a'], null)).toBe(0);
    // الإسناد غير الظاهر يبقى عند التبديل
    expect(toggleId(['hidden', 'a'], 'a')).toEqual(['hidden']);
  });
});

describe('payloads', () => {
  it('diffPayload sends only what changed', () => {
    const initial = form({ branches: { mode: 'selected', ids: ['b1'] } });
    expect(diffPayload(initial, { ...initial }, ALL)).toEqual({});
    expect(diffPayload(initial, { ...initial, name: 'Hind A' }, ALL)).toEqual({ name: 'Hind A' });
    expect(diffPayload(initial, { ...initial, branches: { mode: 'selected', ids: ['b1', 'b2'] } }, ALL))
      .toEqual({ branch_ids: ['b1', 'b2'] });
    expect(diffPayload(initial, { ...initial, branches: { mode: 'all', ids: ['b1'] } }, ALL)).toEqual({ branch_ids: [] });
    expect(diffPayload(initial, { ...initial, password: 'newpass123' }, ALL)).toEqual({ password: 'newpass123' });
  });

  it('diffPayload never sends a field the viewer cannot edit, even if the draft differs', () => {
    const initial = form();
    const changed = form({ role: 'admin', employeeId: 'e9', branches: { mode: 'selected', ids: ['b1'] }, warehouses: { mode: 'selected', ids: ['w1'] } });
    expect(diffPayload(initial, changed, { role: false, employee: false, branches: false, warehouses: false })).toEqual({});
  });

  it('a no-op toggle of an order does not count as a scope change', () => {
    const initial = form({ branches: { mode: 'selected', ids: ['b1', 'b2'] } });
    expect(diffPayload(initial, { ...initial, branches: { mode: 'selected', ids: ['b2', 'b1'] } }, ALL)).toEqual({});
  });

  it('createPayload omits ALL scopes and sends SELECTED non-empty', () => {
    const body = createPayload(form({ password: 'x'.repeat(8), warehouses: { mode: 'selected', ids: ['w1'] } }), ALL);
    expect(body).toMatchObject({ name: 'Hind', email: 'hind@acme.test', role: 'staff', password: 'xxxxxxxx', warehouse_ids: ['w1'] });
    expect('branch_ids' in body).toBe(false);
  });

  it('createPayload with an invitation sends no password', () => {
    const body = createPayload(form({ sendInvitation: true, password: 'ignored' }), ALL);
    expect(body.send_invitation).toBe(true);
    expect('password' in body).toBe(false);
  });
});

describe('dirty state and summary', () => {
  it('detects changes in any field', () => {
    const initial = form();
    expect(isDirty(initial, { ...initial })).toBe(false);
    expect(isDirty(initial, { ...initial, name: 'x' })).toBe(true);
    expect(isDirty(initial, { ...initial, password: 'p' })).toBe(true);
    expect(isDirty(initial, { ...initial, isActive: false })).toBe(true);
    expect(isDirty(initial, { ...initial, warehouses: { mode: 'selected', ids: ['w1'] } })).toBe(true);
  });

  it('summarises source assignments only', () => {
    expect(accessSummary(form())).toEqual({ branches: { kind: 'all' }, warehouses: { kind: 'all' } });
    expect(accessSummary(form({ branches: { mode: 'selected', ids: ['a', 'b', 'c'] } })).branches).toEqual({ kind: 'selected', count: 3 });
  });
});

describe('shared scope payload (users editor + employee dialog)', () => {
  const scope = (b: ScopeForm['branches'], w: ScopeForm['warehouses']): ScopeForm => ({ branches: b, warehouses: w });
  const ALLS = scope({ mode: 'all', ids: [] }, { mode: 'all', ids: [] });
  const caps = { branches: true, warehouses: true };

  it('edit: only the changed dimension, "All" as [] (unrestricted)', () => {
    const initial = scope({ mode: 'selected', ids: ['b1'] }, { mode: 'all', ids: [] });
    expect(scopePayload(initial, initial, caps, true)).toEqual({});
    expect(scopePayload(initial, scope({ mode: 'all', ids: ['b1'] }, initial.warehouses), caps, true)).toEqual({ branch_ids: [] });
    expect(scopePayload(initial, scope(initial.branches, { mode: 'selected', ids: ['w1'] }), caps, true)).toEqual({ warehouse_ids: ['w1'] });
  });

  it('create: "All" omits the key, "Selected" sends ids', () => {
    expect(scopePayload(ALLS, ALLS, caps, false)).toEqual({});
    expect(scopePayload(ALLS, scope({ mode: 'selected', ids: ['b2'] }, ALLS.warehouses), caps, false)).toEqual({ branch_ids: ['b2'] });
  });

  it('never emits a dimension the viewer cannot read', () => {
    const next = scope({ mode: 'selected', ids: ['b2'] }, { mode: 'selected', ids: ['w1'] });
    expect(scopePayload(ALLS, next, { branches: false, warehouses: true }, true)).toEqual({ warehouse_ids: ['w1'] });
    expect(scopePayload(ALLS, next, { branches: false, warehouses: false }, false)).toEqual({});
  });
});

describe('scopeIssues', () => {
  const caps = { branches: true, warehouses: true };
  const none = { branches: false, warehouses: false };
  const blank: ScopeForm = { branches: { mode: 'all', ids: [] }, warehouses: { mode: 'all', ids: [] } };

  it('flags an empty "Selected" even when it equals the stored "All" payload, on edit and create', () => {
    const empty: ScopeForm = { ...blank, branches: { mode: 'selected', ids: [] } };
    expect(scopeIssues(blank, empty, caps, none, true)).toEqual({ branches: 'selected_empty', warehouses: null });
    expect(scopeIssues(blank, empty, caps, none, false)).toEqual({ branches: 'selected_empty', warehouses: null });
  });

  it('ignores untouched dimensions on edit but checks them on create for restricted actors', () => {
    expect(scopeIssues(blank, blank, caps, { branches: true, warehouses: false }, true)).toEqual({ branches: null, warehouses: null });
    expect(scopeIssues(blank, blank, caps, { branches: true, warehouses: false }, false)).toEqual({ branches: 'all_not_allowed', warehouses: null });
  });

  it('skips dimensions the viewer cannot edit', () => {
    const empty: ScopeForm = { ...blank, branches: { mode: 'selected', ids: [] } };
    expect(scopeIssues(blank, empty, { branches: false, warehouses: true }, none, true).branches).toBeNull();
  });
});
