import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  formatMinor,
  mayUseOrganizationScope,
  minorToDecimal,
  partnerDisplayName,
  periodIssue,
  riyalToMinor,
  toLatinDigits,
  type ReconciliationRow,
} from './contract';

describe('money display (minor units → SAR at the display boundary)', () => {
  it('converts minor units with integer arithmetic', () => {
    expect(minorToDecimal(0)).toBe('0.00');
    expect(minorToDecimal(5)).toBe('0.05');
    expect(minorToDecimal(10050)).toBe('100.50');
    expect(minorToDecimal(-10050)).toBe('-100.50');
    expect(minorToDecimal(123456789012)).toBe('1234567890.12');
  });

  it('formats with two decimals, grouping and Latin digits only', () => {
    expect(formatMinor(115000)).toBe('1,150.00 ⃁');
    expect(formatMinor(-5)).toBe('-0.05 ⃁');
    expect(formatMinor(null)).toBe('—');
    expect(formatMinor(undefined)).toBe('—');
    expect(formatMinor(Number.NaN)).toBe('—');
    expect(formatMinor(987654321)).not.toMatch(/[٠-٩۰-۹]/);
  });
});

describe('riyalToMinor (tolerance input)', () => {
  it('accepts up to two decimals and Arabic-Indic digits', () => {
    expect(riyalToMinor('0')).toBe(0);
    expect(riyalToMinor('1.5')).toBe(150);
    expect(riyalToMinor('12.34')).toBe(1234);
    expect(riyalToMinor('١٢٫٥٠')).toBe(1250);
    expect(riyalToMinor('100')).toBe(10000);
  });

  it('rejects ambiguity, negatives, extra decimals and anything above the server cap', () => {
    expect(riyalToMinor('')).toBeNull();
    expect(riyalToMinor('abc')).toBeNull();
    expect(riyalToMinor('-1')).toBeNull();
    expect(riyalToMinor('1.234')).toBeNull();
    expect(riyalToMinor('100.01')).toBeNull();
    expect(riyalToMinor('5%')).toBeNull();
  });
});

describe('period rules mirror the server (≤ 1830 days, not inverted)', () => {
  it('computes whole days between valid dates only', () => {
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
    expect(daysBetween('2026-02-30', '2026-03-01')).toBeNull();
    expect(daysBetween('bad', '2026-03-01')).toBeNull();
  });

  it('classifies period problems', () => {
    expect(periodIssue('', '2026-01-01')).toBe('missing');
    expect(periodIssue('2026-13-01', '2026-01-01')).toBe('invalid');
    expect(periodIssue('2026-02-01', '2026-01-01')).toBe('inverted');
    expect(periodIssue('2020-01-01', '2026-01-01')).toBe('too_long');
    expect(periodIssue('2026-01-01', '2026-12-31')).toBeNull();
    expect(periodIssue('2021-01-01', '2025-12-31')).toBeNull();
  });
});

describe('small helpers', () => {
  it('normalizes digits to Latin', () => {
    expect(toLatinDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(toLatinDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
    expect(toLatinDigits('abc 12')).toBe('abc 12');
  });

  it('hides the organization-wide scope from branch-restricted actors', () => {
    expect(mayUseOrganizationScope([])).toBe(true);
    expect(mayUseOrganizationScope(null)).toBe(true);
    expect(mayUseOrganizationScope(['b1'])).toBe(false);
  });

  it('never throws on a row without partner detail', () => {
    expect(partnerDisplayName({ partner: null } as Pick<ReconciliationRow, 'partner'>)).toBe('—');
    expect(partnerDisplayName({ partner: { name: ' شركة النور ' } } as Pick<ReconciliationRow, 'partner'>)).toBe('شركة النور');
  });
});
