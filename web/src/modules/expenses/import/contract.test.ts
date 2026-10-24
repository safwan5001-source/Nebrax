import { describe, expect, it } from 'vitest';
import {
  parseTaxRate,
  expenseImportFormData,
  expenseJobOptions,
  expenseMappingGaps,
  spreadsheetSafe,
  suggestedExpenseMapping,
  toggleRepeatRow,
  type ExpenseImportField,
  type ExpenseImportOptions,
} from './contract';

const field = (key: string, required = false): ExpenseImportField => ({ key, label_ar: key, label_en: key, type: 'text', required });
const fields = [field('expense_date', true), field('amount', true), field('account_code'), field('reference')];
const base: ExpenseImportOptions = { referencePolicy: 'optional', defaultAccountId: '', defaultPaymentMethod: 'cash', defaultTaxRate: 15, confirmedRepeatRows: [] };

describe('expense import contract (IMP-H5-S2b)', () => {
  it('needs date and amount, an account source (column or default), and a reference column only when required', () => {
    expect(expenseMappingGaps({ 0: 'amount' }, fields, base).missingRequired.map((f) => f.key)).toEqual(['expense_date']);
    expect(expenseMappingGaps({ 0: 'expense_date', 1: 'amount' }, fields, base).missingAccount).toBe(true);
    expect(expenseMappingGaps({ 0: 'expense_date', 1: 'amount' }, fields, { ...base, defaultAccountId: 'acc-1' }).missingAccount).toBe(false);
    expect(expenseMappingGaps({ 0: 'expense_date', 1: 'amount', 2: 'account_code' }, fields, base)).toEqual({ missingRequired: [], missingAccount: false, missingReference: false, duplicate: false });
    expect(expenseMappingGaps({ 0: 'expense_date', 1: 'amount', 2: 'account_code' }, fields, { ...base, referencePolicy: 'required' }).missingReference).toBe(true);
    expect(expenseMappingGaps({ 0: 'amount', 1: 'amount' }, fields, base).duplicate).toBe(true);
  });

  it('sends the policies, sorted unique confirmed rows and an explicit "ignore" for unmatched columns', () => {
    const form = expenseImportFormData(new File(['x'], 'e.csv'), { ...base, defaultAccountId: 'acc-1', defaultTaxRate: 5, confirmedRepeatRows: [5, 3, 5], mapping: { 0: 'amount', 1: null } });
    expect(form.get('reference_policy')).toBe('optional');
    expect(form.get('default_account_id')).toBe('acc-1');
    expect(form.get('default_tax_rate')).toBe('5');
    expect(form.getAll('confirmed_repeat_rows[]')).toEqual(['3', '5']);
    expect(form.get('mapping[0]')).toBe('amount');
    expect(form.get('mapping[1]')).toBe('ignore');
    expect(expenseImportFormData(new File(['x'], 'e.csv'), base).has('default_account_id')).toBe(false);
  });

  it('builds job options identical to the preview ones and omits empty lists/accounts', () => {
    expect(expenseJobOptions(base)).toEqual({ reference_policy: 'optional', default_payment_method: 'cash', default_tax_rate: 15 });
    expect(expenseJobOptions({ ...base, defaultAccountId: 'acc-1', confirmedRepeatRows: [4, 3], mapping: { 0: 'amount' } })).toEqual({
      reference_policy: 'optional', default_account_id: 'acc-1', default_payment_method: 'cash', default_tax_rate: 15, confirmed_repeat_rows: [3, 4], mapping: { 0: 'amount' },
    });
  });

  it('toggles a confirmed row without duplicates and keeps the list sorted', () => {
    expect(toggleRepeatRow([5], 3, true)).toEqual([3, 5]);
    expect(toggleRepeatRow([3, 5], 3, true)).toEqual([3, 5]);
    expect(toggleRepeatRow([3, 5], 5, false)).toEqual([3]);
  });

  it('adopts the server suggestion and neutralises spreadsheet formulas', () => {
    expect(suggestedExpenseMapping([{ index: 0, header: 'h', samples: [], suggested_field: 'amount' }, { index: 1, header: 'x', samples: [], suggested_field: null }])).toEqual({ 0: 'amount', 1: null });
    expect(spreadsheetSafe('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(spreadsheetSafe('عادي')).toBe('عادي');
  });

  it('accepts only whole Latin-digit tax rates between 0 and 100', () => {
    for (const ok of ['0', '5', '15', '100']) expect(parseTaxRate(ok)).toBe(Number(ok));
    for (const bad of ['', '101', '1e1', '0x10', '5.0', '5.', ' 5', '-1', '١٥', '1000']) expect(parseTaxRate(bad), bad).toBeNull();
  });
});
