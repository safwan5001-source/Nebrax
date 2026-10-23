import { describe, expect, it } from 'vitest';
import {
  cashAccountIdPayload, cashSaleSelectorVisible, parseCashSaleSettings, toCashTreasuryOptions,
} from '../cash-sale-treasury';

describe('parseCashSaleSettings', () => {
  it('reads the effective policy and the default payment type', () => {
    expect(parseCashSaleSettings({ cash_sale_treasury_policy_effective: 'main', default_payment_type: 'cash' }))
      .toEqual({ effective: 'main', defaultPaymentType: 'cash' });
    expect(parseCashSaleSettings({ cash_sale_treasury_policy_effective: 'explicit_required' }).effective).toBe('explicit_required');
  });

  it('falls back to legacy on anything unexpected (safe by default)', () => {
    for (const bad of [undefined, null, [], 'x', 42, {}, { cash_sale_treasury_policy_effective: 'bogus' }, { cash_sale_treasury_policy_effective: null }]) {
      expect(parseCashSaleSettings(bad).effective).toBe('legacy');
    }
    expect(parseCashSaleSettings({}).defaultPaymentType).toBe('credit');
  });

  it('uses the effective policy, not the stored one', () => {
    expect(parseCashSaleSettings({ cash_sale_treasury_policy: 'main', cash_sale_treasury_policy_effective: 'legacy' }).effective).toBe('legacy');
  });
});

describe('cashSaleSelectorVisible', () => {
  const s = (effective: 'legacy' | 'main' | 'explicit_required', defaultPaymentType = 'cash') => ({ effective, defaultPaymentType });

  it('is never visible on legacy', () => {
    expect(cashSaleSelectorVisible({ settings: s('legacy'), isPaid: false })).toBe(false);
    expect(cashSaleSelectorVisible({ settings: s('legacy'), isPaid: false, documentPaymentType: 'cash' })).toBe(false);
  });

  it('is visible for a cash invoice under main / explicit_required', () => {
    expect(cashSaleSelectorVisible({ settings: s('main'), isPaid: false })).toBe(true);
    expect(cashSaleSelectorVisible({ settings: s('explicit_required'), isPaid: false, documentPaymentType: 'cash' })).toBe(true);
  });

  it('is hidden once paid (the receipt path has its own cashbox) and for credit invoices', () => {
    expect(cashSaleSelectorVisible({ settings: s('main'), isPaid: true })).toBe(false);
    expect(cashSaleSelectorVisible({ settings: s('main', 'credit'), isPaid: false })).toBe(false);
    expect(cashSaleSelectorVisible({ settings: s('main', 'cash'), isPaid: false, documentPaymentType: 'credit' })).toBe(false);
    expect(cashSaleSelectorVisible({ settings: s('main', 'credit'), isPaid: false, documentPaymentType: 'cash' })).toBe(true);
  });
});

describe('cashAccountIdPayload', () => {
  it('keeps the paid-invoice payload exactly as before', () => {
    expect(cashAccountIdPayload({ isPaid: true, receiptAccountId: 'r', selectorVisible: true, cashSaleAccountId: 'c' })).toBe('r');
    expect(cashAccountIdPayload({ isPaid: true, receiptAccountId: '', selectorVisible: false, cashSaleAccountId: 'c' })).toBeNull();
  });

  it('sends the cash-sale choice only when the selector is shown', () => {
    expect(cashAccountIdPayload({ isPaid: false, receiptAccountId: 'r', selectorVisible: true, cashSaleAccountId: 'c' })).toBe('c');
    expect(cashAccountIdPayload({ isPaid: false, receiptAccountId: 'r', selectorVisible: true, cashSaleAccountId: '' })).toBeNull();
    expect(cashAccountIdPayload({ isPaid: false, receiptAccountId: 'r', selectorVisible: false, cashSaleAccountId: 'c' })).toBeNull();
  });
});

describe('toCashTreasuryOptions', () => {
  it('keeps active cash cashboxes only and labels them with the ledger code', () => {
    const rows = [
      { account_id: 'a', type: 'cash', name: 'Main', account_code: '1110', is_active: true },
      { account_id: 'b', type: 'bank', name: 'Bank', account_code: '1120', is_active: true },
      { account_id: 'c', type: 'cash', name: 'Old', account_code: '1112', is_active: false },
      { type: 'cash', name: 'No id', is_active: true },
    ];
    expect(toCashTreasuryOptions(rows)).toEqual([{ accountId: 'a', label: 'Main — 1110' }]);
  });

  it('tolerates malformed input', () => {
    expect(toCashTreasuryOptions(undefined)).toEqual([]);
    expect(toCashTreasuryOptions({})).toEqual([]);
    expect(toCashTreasuryOptions([null, 1, 'x'])).toEqual([]);
  });
});
