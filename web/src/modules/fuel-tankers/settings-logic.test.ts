import { describe, expect, it } from 'vitest';
import {
  effectiveOperations, INHERIT, isNarrowing, overrideFields, POLICY_DEFAULTS, policyChanges, readPolicy, sameOperations, SERVER_KEYS, toDraft, toStoredOperations,
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
  const org = toDraft(current);
  it('sends only changed keys, typed (boolean stays boolean)', () => {
    expect(policyChanges(org, org)).toEqual({});
    expect(policyChanges(org, { ...org, selectionRequired: 'true' })).toEqual({ [SERVER_KEYS.selectionRequired]: true });
    expect(policyChanges(org, { ...org, voucherScope: 'owner', overrunPolicy: 'block' })).toEqual({ [SERVER_KEYS.voucherScope]: 'owner', [SERVER_KEYS.overrunPolicy]: 'block' });
  });
  it('station scope keeps inherited vs overridden state: inherit is the initial value of a non-overridden key', () => {
    const station = toDraft(current, new Set(['voucherScope']));
    expect(station).toEqual({ selectionRequired: INHERIT, voucherScope: 'station', overrunPolicy: INHERIT });
    expect(policyChanges(station, station)).toEqual({});
  });
  it('pinning an explicit value EQUAL to the current effective one creates an override (Codex P2)', () => {
    const station = toDraft(current, new Set());
    expect(policyChanges(station, { ...station, overrunPolicy: 'allow_with_confirmation' })).toEqual({ [SERVER_KEYS.overrunPolicy]: 'allow_with_confirmation' });
  });
  it('choosing inherit on an overridden key clears it (null); an untouched inherited key sends nothing', () => {
    const station = toDraft(current, new Set(['voucherScope']));
    expect(policyChanges(station, { ...station, voucherScope: INHERIT })).toEqual({ [SERVER_KEYS.voucherScope]: null });
  });
  it('maps server override keys to UI fields and ignores unknown or malformed input', () => {
    expect([...overrideFields(['tanker_voucher_unique_scope', 'unrelated', 'tanker_selection_required'])].sort()).toEqual(['selectionRequired', 'voucherScope']);
    expect(overrideFields(undefined).size).toBe(0);
    expect(overrideFields('x').size).toBe(0);
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
