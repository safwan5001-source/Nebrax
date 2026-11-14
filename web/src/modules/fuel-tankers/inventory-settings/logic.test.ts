import { describe, expect, it } from 'vitest';
import {
  candidateAccounts, clearingReasonFromMessage, DEFAULT_VALUES, INHERIT, isoToZonedLocal, overrideFields, postingChanges, readAccounts, readEvaluation, readValues, toDraft, touchesGovernance, UNSET,
} from './logic';

const toIso = (local: string) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) ? `${local}:00.000Z` : null);

describe('readValues', () => {
  it('falls back to the safe defaults for missing or corrupt keys', () => {
    expect(readValues(null)).toEqual(DEFAULT_VALUES);
    expect(readValues({ fuel_pool_ledger_variance_policy: 'ignore', tanker_cost_recognition: 'immediate_cogs', tanker_inventory_alerts_enabled: 'x' })).toEqual({ ...DEFAULT_VALUES, alerts: true });
    expect(DEFAULT_VALUES.variance).toBe('block');
    expect(DEFAULT_VALUES.clearingAccountId).toBe('');
  });

  it('reads stored values', () => {
    expect(readValues({ tanker_issue_clearing_account_id: 'a1', fuel_pool_ledger_variance_policy: 'warn', tanker_inventory_posting_start_at: '2026-12-01T00:00:00Z', tanker_inventory_alerts_enabled: false, operating_timezone: 'Asia/Riyadh' }))
      .toEqual({ clearingAccountId: 'a1', cost: 'clearing_until_invoice', variance: 'warn', startAt: '2026-12-01T00:00:00Z', alerts: false, timezone: 'Asia/Riyadh' });
  });
});

describe('readEvaluation', () => {
  it('maps the server evaluation and hides unknown reasons behind "other"', () => {
    const evaluation = readEvaluation({
      data: { clearing_account: { configured: true, valid: false, reason: 'weird', account: { id: 'a', code: '1145', name: 'وسيط' } }, blockers: ['clearing_account_invalid', 7], notices: ['posting_gate_closed'] },
      meta: { posting_gate_open: false },
    });
    expect(evaluation.clearing).toEqual({ configured: true, valid: false, reason: 'other', account: { id: 'a', code: '1145', name: 'وسيط' } });
    expect(evaluation.blockers).toEqual(['clearing_account_invalid']);
    expect(evaluation.postingGateOpen).toBe(false);
  });

  it('fails closed on garbage (nothing configured, no account, gate closed)', () => {
    expect(readEvaluation(null)).toEqual({ clearing: { configured: false, valid: false, reason: null, account: null }, blockers: [], notices: [], postingGateOpen: false });
  });
});

describe('clearingReasonFromMessage', () => {
  it('extracts the stable reason code from the server message', () => {
    expect(clearingReasonFromMessage('FUEL_TANKER_CLEARING_ACCOUNT_INVALID:inventory_account: لا يجوز')).toBe('inventory_account');
    expect(clearingReasonFromMessage('FUEL_TANKER_CLEARING_ACCOUNT_INVALID:mystery: x')).toBe('other');
    expect(clearingReasonFromMessage('أي رسالة أخرى')).toBeNull();
    expect(clearingReasonFromMessage(null)).toBeNull();
  });
});

describe('accounts', () => {
  it('keeps only active non-group asset accounts as candidates, sorted by code', () => {
    const accounts = readAccounts({ data: [
      { id: '3', code: '1146', name: 'ب', type: 'asset', is_active: true, is_group: false },
      { id: '1', code: '1145', name: 'أ', type: 'asset', is_active: true, is_group: false },
      { id: '2', code: '2110', name: 'التزام', type: 'liability', is_active: true, is_group: false },
      { id: '4', code: '1147', name: 'معطل', type: 'asset', is_active: false, is_group: false },
      { id: '5', code: '11', name: 'مجموعة', type: 'asset', is_active: true, is_group: true },
      { code: 'x' },
    ] });
    expect(candidateAccounts(accounts).map((account) => account.code)).toEqual(['1145', '1146']);
  });

  it('returns nothing for a malformed payload', () => {
    expect(readAccounts({ data: {} })).toEqual([]);
    expect(readAccounts(undefined)).toEqual([]);
  });
});

describe('draft and changes', () => {
  const values = { ...DEFAULT_VALUES, clearingAccountId: 'a1', startAt: '2026-11-30T21:00:00Z' };

  it('zoned local conversion uses the organization timezone, not the device', () => {
    expect(isoToZonedLocal('2026-11-30T21:00:00Z', 'Asia/Riyadh')).toBe('2026-12-01T00:00');
    expect(isoToZonedLocal('', 'Asia/Riyadh')).toBe('');
    expect(isoToZonedLocal('garbage', 'Asia/Riyadh')).toBe('');
  });

  it('organization scope: sends only what changed and clears with null', () => {
    const initial = toDraft(values);
    expect(postingChanges(initial, initial, 'Asia/Riyadh', toIso).payload).toEqual({});
    const changed = postingChanges(initial, { ...initial, clearing: UNSET, variance: 'warn', alerts: 'false', start: UNSET }, 'Asia/Riyadh', toIso);
    expect(changed.payload).toEqual({ tanker_issue_clearing_account_id: null, fuel_pool_ledger_variance_policy: 'warn', tanker_inventory_alerts_enabled: false, tanker_inventory_posting_start_at: null });
    expect(changed.invalid).toEqual([]);
  });

  it('an invalid date is reported and never sent', () => {
    const initial = toDraft(DEFAULT_VALUES);
    const result = postingChanges(initial, { ...initial, start: 'not-a-date' }, 'Asia/Riyadh', toIso);
    expect(result.invalid).toEqual(['start']);
    expect(result.payload).toEqual({});
  });

  it('station scope: inherit shows for fields without an override and maps back to null; an empty start over inherit is not a change', () => {
    const initial = toDraft(values, overrideFields(['tanker_issue_clearing_account_id']));
    expect(initial.clearing).toBe('a1');
    expect(initial.variance).toBe(INHERIT);
    expect(initial.start).toBe(INHERIT);
    const result = postingChanges(initial, { ...initial, clearing: INHERIT, variance: 'warn', start: UNSET }, 'Asia/Riyadh', toIso);
    expect(result.payload).toEqual({ tanker_issue_clearing_account_id: null, fuel_pool_ledger_variance_policy: 'warn' });
  });

  it('governance keys are every key except the alerts toggle', () => {
    expect(touchesGovernance({ tanker_inventory_alerts_enabled: true })).toBe(false);
    for (const key of ['tanker_issue_clearing_account_id', 'tanker_cost_recognition', 'fuel_pool_ledger_variance_policy', 'tanker_inventory_posting_start_at']) expect(touchesGovernance({ [key]: 'x' })).toBe(true);
  });
});
