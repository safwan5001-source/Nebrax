import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import { isAllowedReadPath, shiftSettlementPreviewPath, StationOpsError } from './read-client';
import { blockerKey, differenceDirection, hasFinanceLayer, settlementPreviewResponse, stateKey } from './settlement-preview';

const base = {
  enabled: true, writes_nothing: true as const, shift: { id: 's1', number: 'SH-1', status: 'open' }, policy: { mode: 'post_on_close', sales_basis: 'per_invoice' },
  ready: false, blockers: [], preview_hash: 'a'.repeat(64), evaluated_at: '2026-11-08T10:00:00+00:00', disclaimers: ['preview_only_no_postings'],
  lines: [{ nozzle_id: 'n1', nozzle_number: 1, fuel_product_id: 'p1', metered_milliliters: 20_000, withheld: false }],
};

describe('settlement preview contract', () => {
  it('parses the basic layer (no amounts) and reports no finance layer', () => {
    const parsed = settlementPreviewResponse.parse({ data: base });
    expect(hasFinanceLayer(parsed.data)).toBe(false);
    expect(parsed.data.lines[0].nozzle_number).toBe('1');
  });

  it('parses the finance layer', () => {
    const parsed = settlementPreviewResponse.parse({
      data: {
        ...base,
        lines: [{ ...base.lines[0], erp_milliliters: 0, residual_milliliters: 20_000, expected_gross_minor: 4600, state: 'posted', price_per_liter_minor: 230 }],
        reference: { total_minor: 4600, components: {} }, declaration: { present: true, declared_total_minor: 4000, difference_vs_reference_minor: -600, by_method: [] },
        allocation: { rows: [{ payment_method_id: 'm1', method: 'Cash', settlement_type: 'cash', target_kind: 'settlement', target_ref: 'nozzle:1', amount_minor: 4000 }], allocated_total_minor: 4000 },
        variances: { shortage_minor: 600, surplus: [], held_for_withheld: [] },
      },
    });
    expect(hasFinanceLayer(parsed.data)).toBe(true);
  });

  it('rejects a response that does not promise to write nothing', () => {
    expect(settlementPreviewResponse.safeParse({ data: { ...base, writes_nothing: false } }).success).toBe(false);
  });

  it('maps server codes to message keys and never leaks an unknown raw code', () => {
    expect(blockerKey('FUEL_SETTLEMENT_METER_INCOMPLETE')).toBe('METER_INCOMPLETE');
    expect(blockerKey('FUEL_SETTLEMENT_NOT_READY_POLICY_NONE')).toBe('POLICY_NONE');
    expect(blockerKey('FUEL_SETTLEMENT_NOT_READY_COST_STATE:0e4b9c1e-1111-2222-3333-444455556666')).toBe('COST_STATE');
    expect(blockerKey('FUEL_SETTLEMENT_SUPERVISOR_ATTENTION')).toBe('SUPERVISOR_ATTENTION');
    expect(blockerKey('SOMETHING_ELSE')).toBe('unknown');
  });

  it('every known blocker and state has copy in both languages (and unknown has a fallback)', () => {
    const arTree = (ar as unknown as { stationOps: { settlement: { blocker: Record<string, string>; state: Record<string, string> } } }).stationOps.settlement;
    const enTree = (en as unknown as { stationOps: { settlement: { blocker: Record<string, string>; state: Record<string, string> } } }).stationOps.settlement;
    for (const tree of [arTree, enTree]) {
      for (const code of ['METER_INCOMPLETE', 'DECLARATION_MISSING', 'SUPERVISOR_ATTENTION', 'ERP_EXCEEDS_METER', 'DECLARATION_BELOW_RECEIPTS', 'PRICE_CHANGED', 'PRICE_UNAVAILABLE',
        'INSUFFICIENT_STOCK', 'PERIOD_LOCKED', 'RECEIPTS_UNATTRIBUTED', 'WALK_IN_REQUIRED', 'WALK_IN_INACTIVE', 'POLICY_NONE', 'DEPLOYMENT_GATE_CLOSED', 'TAX_OPINION_MISSING',
        'DECLARATION_GATE_CLOSED', 'RECEIPT_STAMPING_GATE_CLOSED', 'CASH_BASIS_NOT_DECLARED', 'NO_PAYMENT_METHODS', 'PAYMENT_METHOD_TREASURY', 'TAX_MODE_UNSET',
        'OPEN_SHIFT_INDEX_MISSING', 'COST_STATE', 'PRODUCT_UNAVAILABLE', 'DECLARATION_METHODS_CHANGED', 'unknown']) {
        expect(tree.blocker[code], code).toBeTruthy();
      }
      for (const state of ['posted', 'no_residual', 'withheld_cost_pool_changed', 'withheld_pool_history_open', 'withheld_period_boundary', 'blocked_erp_exceeds_meter', 'unavailable', 'unknown']) {
        expect(tree.state[state], state).toBeTruthy();
      }
    }
    expect(stateKey('withheld_period_boundary')).toBe('withheld_period_boundary');
    expect(stateKey('anything')).toBe('unknown');
    expect(stateKey(undefined)).toBe('unknown');
  });

  it('classifies the difference direction', () => {
    expect(differenceDirection(-1)).toBe('short');
    expect(differenceDirection(5)).toBe('over');
    expect(differenceDirection(0)).toBe('match');
    expect(differenceDirection(null)).toBeNull();
  });

  it('the preview path is a validated GET-only read path', () => {
    expect(shiftSettlementPreviewPath('s1')).toBe('/fuel-stations/shifts/s1/settlement-preview');
    expect(isAllowedReadPath('/fuel-stations/shifts/s1/settlement-preview')).toBe(true);
    expect(isAllowedReadPath('/fuel-stations/shifts/open/settlement-preview')).toBe(false);
    expect(isAllowedReadPath('/fuel-stations/shifts/../settlement-preview')).toBe(false);
    expect(() => shiftSettlementPreviewPath('open')).toThrow(StationOpsError);
    expect(() => shiftSettlementPreviewPath('../x')).toThrow(StationOpsError);
  });
});
