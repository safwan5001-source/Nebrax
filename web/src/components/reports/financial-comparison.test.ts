import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  balanceComparisonAsOf,
  compareAmounts,
  comparisonPeriod,
  previousEqualLengthPeriod,
  previousYearPeriod,
  unionAccountRows,
} from './financial-comparison';

describe('financial comparison calendar ranges', () => {
  it('derives a full previous month and an arbitrary equal-length preceding period with calendar dates', () => {
    expect(previousEqualLengthPeriod({ from: '2026-08-01', to: '2026-08-31' })).toEqual({ from: '2026-07-01', to: '2026-07-31' });
    expect(previousEqualLengthPeriod({ from: '2026-08-12', to: '2026-08-23' })).toEqual({ from: '2026-07-31', to: '2026-08-11' });
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('derives the prior calendar year safely around leap dates', () => {
    expect(previousYearPeriod({ from: '2024-02-29', to: '2024-03-31' })).toEqual({ from: '2023-02-28', to: '2023-03-31' });
    expect(comparisonPeriod('previous-year', { from: '2026-08-01', to: '2026-08-31' })).toEqual({ from: '2025-08-01', to: '2025-08-31' });
  });

  it('uses balance-sheet snapshot semantics and refuses an invented previous period without from', () => {
    expect(balanceComparisonAsOf('previous-period', { from: '2026-08-01', to: '2026-08-31' })).toBe('2026-07-31');
    expect(balanceComparisonAsOf('previous-year', { from: '', to: '2024-02-29' })).toBe('2023-02-28');
    expect(balanceComparisonAsOf('previous-period', { from: '', to: '2026-08-31' })).toBeNull();
  });
});

describe('financial comparison values', () => {
  it('subtracts official display values without changing either source amount and suppresses zero-baseline percentages', () => {
    expect(compareAmounts('125.00', '100.00')).toEqual({ current: '125.00', comparison: '100.00', variance: '25.00', variancePercent: '25.00%' });
    expect(compareAmounts('5.00', '0.00')).toEqual({ current: '5.00', comparison: '0.00', variance: '5.00', variancePercent: null });
    expect(compareAmounts('-25.00', '100.00')).toEqual({ current: '-25.00', comparison: '100.00', variance: '-125.00', variancePercent: '-125.00%' });
  });

  it('matches accounts by code, keeps current ordering, and exposes comparison-only accounts after current rows', () => {
    expect(unionAccountRows(
      [{ code: '4110', name: 'Sales', amount: '120.00' }, { code: '4130', name: 'Shipping', amount: '10.00' }],
      [{ code: '4130', name: 'Shipping previous', amount: '8.00' }, { code: '4150', name: 'Legacy', amount: '4.00' }],
    )).toEqual([
      { code: '4110', name: 'Sales', current: '120.00', comparison: '0.00' },
      { code: '4130', name: 'Shipping', current: '10.00', comparison: '8.00' },
      { code: '4150', name: 'Legacy', current: '0.00', comparison: '4.00' },
    ]);
  });
});
