import { describe, expect, it } from 'vitest';
import {
  bucketRanges, bucketTone, buildAgingQuery, buildDifferencesQuery, differenceTone, knownAccountSource, knownCheckKey, knownNotChecked, signedTone, statusTone,
} from './contract';

describe('payment-reports contract', () => {
  it('maps reconciliation status to tones', () => {
    expect(statusTone('reconciled')).toBe('positive');
    expect(statusTone('difference')).toBe('negative');
    expect(statusTone('unresolved')).toBe('warning');
  });

  it('flags any non-zero difference and keeps zero positive', () => {
    expect(differenceTone(0)).toBe('positive');
    expect(differenceTone(7000)).toBe('negative');
    expect(differenceTone(-1)).toBe('negative');
    expect(signedTone(0)).toBe('muted');
    expect(signedTone(-500)).toBe('warning');
    expect(signedTone(300)).toBe('warning');
  });

  it('derives the four age ranges from bucket_days', () => {
    expect(bucketRanges([7, 30, 60])).toEqual([
      { index: 0, from: 0, to: 7 }, { index: 1, from: 8, to: 30 }, { index: 2, from: 31, to: 60 }, { index: 3, from: 61, to: null },
    ]);
  });

  it('warns only on a non-zero oldest bucket', () => {
    expect(bucketTone(3, 3, 100)).toBe('warning');
    expect(bucketTone(3, 3, 0)).toBe('neutral');
    expect(bucketTone(1, 3, 100)).toBe('neutral');
  });

  it('builds query strings only when a filter is chosen', () => {
    expect(buildDifferencesQuery('')).toBe('');
    expect(buildDifferencesQuery('g1')).toBe('?payment_gateway_id=g1');
    expect(buildAgingQuery([])).toBe('');
    expect(decodeURIComponent(buildAgingQuery(['a', 'b']))).toBe('?branch_id[]=a&branch_id[]=b');
  });

  it('recognizes known keys and lets unknown ones through', () => {
    expect(knownCheckKey('captures')).toBe(true);
    expect(knownCheckKey('mystery')).toBe(false);
    expect(knownNotChecked('provider_statement')).toBe(true);
    expect(knownNotChecked('x')).toBe(false);
    expect(knownAccountSource('history')).toBe(true);
    expect(knownAccountSource('x')).toBe(false);
  });
});
