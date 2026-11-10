import { describe, expect, it } from 'vitest';
import {
  effectiveOperations, INHERIT, isNarrowing, POLICY_DEFAULTS, policyChanges, readPolicy, sameOperations, SERVER_KEYS, toDraft, toStoredOperations,
} from './settings-logic';

describe('readPolicy', () => {
  it('returns the owner-approved defaults for missing, null or corrupt values (never guesses)', () => {
    expect(readPolicy(undefined)).toEqual(POLICY_DEFAULTS);
    expect(readPolicy(null)).toEqual(POLICY_DEFAULTS);
    expect(readPolicy({ tanker_voucher_unique_scope: 'branch', tanker_capacity_overrun_policy: 'supervisor_approval', tanker_selection_required: 'yes' })).toEqual(POLICY_DEFAULTS);
    expect(POLICY_DEFAULTS).toEqual({ selectionRequired: false, voucherScope: 'station', overrunPolicy: 'allow_with_confirmation' });
  });
  it('reads valid server values', () => {
    expect(readPolicy({ tanker_selection_required: true, tanker_voucher_unique_scope: 'tenant', tanker_capacity_overrun_policy: 'block' })).toEqual({ selectionRequired: true, voucherScope: 'tenant', overrunPolicy: 'block' });
  });
});

describe('policyChanges', () => {
  const current = readPolicy({});
  it('sends only changed keys, typed (boolean stays boolean)', () => {
    expect(policyChanges(current, toDraft(current), false)).toEqual({});
    expect(policyChanges(current, { ...toDraft(current), selectionRequired: 'true' }, false)).toEqual({ [SERVER_KEYS.selectionRequired]: true });
    expect(policyChanges(current, { ...toDraft(current), voucherScope: 'owner', overrunPolicy: 'block' }, false)).toEqual({ [SERVER_KEYS.voucherScope]: 'owner', [SERVER_KEYS.overrunPolicy]: 'block' });
  });
  it('inherit clears a station override (null) and is never sent at organization scope', () => {
    const draft = { ...toDraft(current), voucherScope: INHERIT };
    expect(policyChanges(current, draft, true)).toEqual({ [SERVER_KEYS.voucherScope]: null });
    expect(policyChanges(current, draft, false)).toEqual({});
  });
});

describe('nozzle operations', () => {
  it('null/empty means all operations, in canonical order', () => {
    expect(effectiveOperations(null)).toEqual(['direct_sale', 'tanker_fill', 'internal_issue']);
    expect(effectiveOperations([])).toEqual(['direct_sale', 'tanker_fill', 'internal_issue']);
    expect(effectiveOperations(['internal_issue', 'tanker_fill'])).toEqual(['tanker_fill', 'internal_issue']);
  });
  it('the full set is sent as null, an empty selection is invalid, otherwise a canonical list', () => {
    expect(toStoredOperations(['internal_issue', 'direct_sale', 'tanker_fill'])).toBeNull();
    expect(toStoredOperations([])).toBeUndefined();
    expect(toStoredOperations(['internal_issue', 'tanker_fill'])).toEqual(['tanker_fill', 'internal_issue']);
  });
  it('detects narrowing only when an allowed type is removed', () => {
    const all = effectiveOperations(null);
    expect(isNarrowing(all, ['tanker_fill'])).toBe(true);
    expect(isNarrowing(['tanker_fill'], all)).toBe(false);
    expect(isNarrowing(['tanker_fill'], ['tanker_fill'])).toBe(false);
    expect(sameOperations(['tanker_fill'], ['tanker_fill'])).toBe(true);
    expect(sameOperations(['tanker_fill'], all)).toBe(false);
  });
});
