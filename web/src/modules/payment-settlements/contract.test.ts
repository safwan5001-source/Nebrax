import { describe, expect, it } from 'vitest';
import {
  buildListQuery, buildSettlementBody, canApproveAdjustment, canCancelAdjustment, differenceTone, expectedNet, feeTaxOpen, knownError, minorToInput, parseMinor,
  primaryAction, selectableAdjustment, settlementTone, adjustmentTone, type PreviewInput, type SettlementPreview,
} from './contract';

const preview = (over: Partial<SettlementPreview> = {}): SettlementPreview => ({
  gross: 115000, refunds_total: 0, net_bank_amount: 111000, provider_fee_ex_tax: 4000, provider_fee_tax: 0, provider_deductions: 0, provider_credits: 0,
  adjustments_deductions: 0, adjustments_credits: 0, difference: 0, reconciled: true, postable: true, saveable_as_unreconciled: false, replay: false,
  existing_status: null, blockers: [], ...over,
});

const input = (over: Partial<PreviewInput> = {}): PreviewInput => ({
  gatewayId: 'g1', bankId: 'b1', ref: ' S-1 ', date: '', netMinor: 111000, feeMinor: 4000, feeTaxMinor: 0, feeTaxInvoiceRef: '',
  items: [{ payment_id: 'p1', gross_amount: 115000 }], refunds: [], adjustmentIds: [], ...over,
});

describe('payment-settlements contract', () => {
  it('parses riyals to halalas with no float and allows zero only on request', () => {
    expect(parseMinor('1150.5')).toBe(115050);
    expect(parseMinor('١٫٢٥')).toBe(125);
    expect(parseMinor('0')).toBeNull();
    expect(parseMinor('0', true)).toBe(0);
    expect(parseMinor('1.234')).toBeNull();
    expect(parseMinor('abc')).toBeNull();
    expect(parseMinor('-1')).toBeNull();
    expect(minorToInput(115000)).toBe('1150');
    expect(minorToInput(115005)).toBe('1150.05');
  });

  it('chooses the primary action from the server preview alone', () => {
    expect(primaryAction(null)).toBeNull();
    expect(primaryAction(preview())).toBe('post');
    expect(primaryAction(preview({ postable: false, reconciled: false, saveable_as_unreconciled: true, difference: 500 }))).toBe('unreconciled');
    expect(primaryAction(preview({ postable: false, saveable_as_unreconciled: false, difference: 500 }))).toBeNull();
  });

  it('restates the A6 equation: expected = gross − refunds − fee − fee tax − debits + credits', () => {
    expect(expectedNet(preview())).toBe(111000);
    expect(expectedNet(preview({ refunds_total: 10000, provider_fee_tax: 600, adjustments_deductions: 2000, adjustments_credits: 500 }))).toBe(115000 - 10000 - 4000 - 600 - 2000 + 500);
    expect(expectedNet(preview({ gross: null }))).toBeNull();
  });

  it('builds a body without empty arrays and sends fee-tax fields only when entered', () => {
    const body = buildSettlementBody(input());
    expect(body).toEqual({
      payment_gateway_id: 'g1', cash_bank_account_id: 'b1', provider_settlement_ref: 'S-1', net_bank_amount: 111000, provider_fee_ex_tax: 4000,
      items: [{ payment_id: 'p1', gross_amount: 115000 }],
    });
    expect(body).not.toHaveProperty('refunds');
    expect(body).not.toHaveProperty('adjustments');
    expect(body).not.toHaveProperty('provider_fee_tax');
    const taxed = buildSettlementBody(input({ feeTaxMinor: 600, feeTaxInvoiceRef: ' INV-9 ', date: '2026-10-23' }))!;
    expect(taxed).toMatchObject({ provider_fee_tax: 600, fee_tax_invoice_ref: 'INV-9', settlement_date: '2026-10-23' });
    expect(buildSettlementBody(input({ feeTaxMinor: 600 }))).not.toHaveProperty('fee_tax_invoice_ref');
  });

  it('refuses to preview without the basics or without any payment or adjustment', () => {
    expect(buildSettlementBody(input({ gatewayId: '' }))).toBeNull();
    expect(buildSettlementBody(input({ bankId: '' }))).toBeNull();
    expect(buildSettlementBody(input({ ref: '  ' }))).toBeNull();
    expect(buildSettlementBody(input({ netMinor: null }))).toBeNull();
    expect(buildSettlementBody(input({ items: [] }))).toBeNull();
    expect(buildSettlementBody(input({ items: [], adjustmentIds: ['a1'] }))).toMatchObject({ adjustments: [{ adjustment_id: 'a1' }] });
  });

  it('opens the fee-tax inputs only for input_vat with the recorded opinion', () => {
    expect(feeTaxOpen(undefined)).toBe(false);
    expect(feeTaxOpen({})).toBe(false);
    expect(feeTaxOpen({ fee_tax_policy: 'reject', fee_tax_opinion_recorded: true })).toBe(false);
    expect(feeTaxOpen({ fee_tax_policy: 'input_vat', fee_tax_opinion_recorded: false })).toBe(false);
    expect(feeTaxOpen({ fee_tax_policy: 'input_vat', fee_tax_opinion_recorded: true })).toBe(true);
  });

  it('enforces maker ≠ checker and the cancel rule for adjustments', () => {
    const row = { status: 'requested' as const, requested_by: { id: 'u1', name: 'a' }, settlement_id: null };
    expect(canApproveAdjustment(row, true, 'u2')).toBe(true);
    expect(canApproveAdjustment(row, true, 'u1')).toBe(false);
    expect(canApproveAdjustment(row, false, 'u2')).toBe(false);
    expect(canApproveAdjustment(row, true, null)).toBe(false);
    expect(canApproveAdjustment({ ...row, status: 'approved' }, true, 'u2')).toBe(false);
    expect(canCancelAdjustment(row, false, 'u1')).toBe(true);
    expect(canCancelAdjustment(row, false, 'u2')).toBe(false);
    expect(canCancelAdjustment(row, true, 'u2')).toBe(true);
    expect(canCancelAdjustment({ ...row, status: 'approved' }, true, 'u2')).toBe(true);
    expect(canCancelAdjustment({ ...row, status: 'consumed' }, true, 'u1')).toBe(false);
  });

  it('only approved, unconsumed adjustments can be attached to a settlement', () => {
    expect(selectableAdjustment({ status: 'approved', settlement_id: null })).toBe(true);
    expect(selectableAdjustment({ status: 'approved', settlement_id: 's1' })).toBe(false);
    expect(selectableAdjustment({ status: 'requested', settlement_id: null })).toBe(false);
  });

  it('maps tones, error codes and list queries', () => {
    expect(settlementTone('posted')).toBe('positive');
    expect(settlementTone('unreconciled')).toBe('warning');
    expect(differenceTone(0)).toBe('positive');
    expect(differenceTone(-5)).toBe('warning');
    expect(differenceTone(null)).toBe('muted');
    expect(adjustmentTone('rejected')).toBe('negative');
    expect(knownError('self_approval')).toBe('self_approval');
    expect(knownError('fee_tax_invoice_reused')).toBe('fee_tax_invoice_reused');
    expect(knownError('boom')).toBe('unknown');
    expect(knownError(null)).toBe('unknown');
    expect(buildListQuery({ page: 2, perPage: 25, gatewayId: 'g1', status: 'approved', kind: 'reserve_hold' })).toBe('page=2&per_page=25&payment_gateway_id=g1&status=approved&kind=reserve_hold');
    expect(buildListQuery({ page: 1, perPage: 10 })).toBe('page=1&per_page=10');
  });
});
