import { describe, expect, it } from 'vitest';
import { cashTotals, closePreview, isValidReason, movementBlocker, parseMoney } from './cash';

describe('parseMoney', () => {
  it('an empty field is NOT zero; zero must be typed', () => {
    expect(parseMoney('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseMoney('0')).toEqual({ ok: true, minor: 0 });
    expect(parseMoney('500')).toEqual({ ok: true, minor: 50_000 });
    expect(parseMoney('12.5')).toEqual({ ok: true, minor: 1_250 });
    expect(parseMoney('٥٠٠٫٢٥')).toEqual({ ok: true, minor: 50_025 });
  });
  it('rejects negatives, more than 2 decimals and junk; honours min', () => {
    for (const bad of ['-1', '1.234', 'abc', '1,5,5']) expect(parseMoney(bad), bad).toMatchObject({ ok: false });
    expect(parseMoney('0', { min: 1 })).toEqual({ ok: false, reason: 'invalid' });
    expect(parseMoney('0.01', { min: 1 })).toEqual({ ok: true, minor: 1 });
  });
});

describe('cashTotals — the server formula verbatim (float + in − out − expense, NO fuel sales)', () => {
  const movements = [
    { id: '1', type: 'cash_in', amount_minor: 20_000, reason: 'a', recorded_at: null },
    { id: '2', type: 'cash_out', amount_minor: 5_000, reason: 'b', recorded_at: null },
    { id: '3', type: 'expense', amount_minor: 2_500, reason: 'c', recorded_at: null },
  ];
  it('computes expected cash', () => {
    expect(cashTotals({ opening_float_minor: 50_000, cash_movements: movements })).toEqual({ cashIn: 20_000, cashOut: 5_000, expenses: 2_500, expected: 62_500 });
    expect(cashTotals({ opening_float_minor: 50_000, cash_movements: [] })).toMatchObject({ expected: 50_000 });
  });
  it('is unavailable (null) when movements are unknown or contain an unknown type — never a guessed number', () => {
    expect(cashTotals({ opening_float_minor: 1 })).toBeNull();
    expect(cashTotals({ opening_float_minor: 1, cash_movements: [{ id: 'x', type: 'refund', amount_minor: 1, reason: null, recorded_at: null }] })).toBeNull();
  });
  it('#2021: defers to the server when its basis includes sale receipts; unchanged for movements_only / older servers', () => {
    const base = { opening_float_minor: 50_000, cash_movements: movements };
    const withBasis = (basis: 'movements_only' | 'receiving_shift_receipts' | 'declared_collection') => ({ ...base, cash_summary: { basis } as never });
    expect(cashTotals(withBasis('receiving_shift_receipts'))).toBeNull();
    expect(cashTotals(withBasis('declared_collection'))).toBeNull();
    expect(cashTotals(withBasis('movements_only'))).toMatchObject({ expected: 62_500 });
    expect(cashTotals({ ...base, cash_summary: null })).toMatchObject({ expected: 62_500 });
  });
});

describe('closePreview / movementBlocker', () => {
  const totals = { cashIn: 0, cashOut: 0, expenses: 0, expected: 100_000 };
  it('classifies the difference', () => {
    expect(closePreview(totals, 100_000)).toMatchObject({ variance: 0, direction: 'none' });
    expect(closePreview(totals, 100_500)).toMatchObject({ variance: 500, direction: 'overage' });
    expect(closePreview(totals, 99_000)).toMatchObject({ variance: -1_000, direction: 'shortage' });
  });
  it('blocks a withdrawal/expense above the expected cash (server rule); deposits are never blocked', () => {
    expect(movementBlocker(totals, 'cash_out', 100_001)).toBe('exceeds_balance');
    expect(movementBlocker(totals, 'expense', 100_000)).toBeNull();
    expect(movementBlocker(totals, 'cash_in', 9_999_999)).toBeNull();
    expect(movementBlocker(null, 'cash_out', 5)).toBeNull(); // لا نعرف ⇒ يحكم الخادم
  });
  it('a reason needs real content', () => {
    expect(isValidReason('  ab ')).toBe(false);
    expect(isValidReason('فكة للصندوق')).toBe(true);
  });
});
