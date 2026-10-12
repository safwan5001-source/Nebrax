import { describe, expect, it } from 'vitest';
import { classifyPriceVersions, msUntilNextUtcMidnight, nextScheduled, previewOutcome, todayIsoDate } from './price-status';

const v = (id: string, plan: string, effective_on: string | null, currency = 'SAR') => ({ id, plan, currency, effective_on });

describe('price version status (derived from effective_on and today only)', () => {
  const today = '2026-10-12';

  it('marks the latest started version current, older ones superseded and future ones scheduled', () => {
    const map = classifyPriceVersions(
      [v('old', 'pro', '2026-01-01'), v('now', 'pro', '2026-09-01'), v('soon', 'pro', '2026-11-01'), v('later', 'pro', '2027-01-01')],
      today
    );
    expect(map.get('old')).toEqual({ status: 'superseded', tied: false });
    expect(map.get('now')).toEqual({ status: 'current', tied: false });
    expect(map.get('soon')).toEqual({ status: 'scheduled', tied: false });
    expect(map.get('later')).toEqual({ status: 'scheduled', tied: false });
  });

  it('a version dated today is in effect; one dated tomorrow is not', () => {
    const map = classifyPriceVersions([v('a', 'basic', '2026-10-12'), v('b', 'basic', '2026-10-13')], today);
    expect(map.get('a')?.status).toBe('current');
    expect(map.get('b')?.status).toBe('scheduled');
  });

  it('never treats a scheduled version as in effect, even when it is the only one', () => {
    const map = classifyPriceVersions([v('only', 'pro', '2026-12-01')], today);
    expect(map.get('only')).toEqual({ status: 'scheduled', tied: false });
  });

  it('groups by plan and currency independently', () => {
    const map = classifyPriceVersions(
      [v('p1', 'pro', '2026-01-01'), v('b1', 'basic', '2026-02-01'), v('b2', 'basic', '2026-03-01'), v('u1', 'pro', '2026-01-01', 'USD')],
      today
    );
    expect(map.get('p1')?.status).toBe('current');
    expect(map.get('b1')?.status).toBe('superseded');
    expect(map.get('b2')?.status).toBe('current');
    expect(map.get('u1')?.status).toBe('current');
  });

  it('does not pick between versions that share the latest effective date', () => {
    const map = classifyPriceVersions([v('x', 'pro', '2026-09-01'), v('y', 'pro', '2026-09-01'), v('z', 'pro', '2026-01-01')], today);
    expect(map.get('x')).toEqual({ status: 'current', tied: true });
    expect(map.get('y')).toEqual({ status: 'current', tied: true });
    expect(map.get('z')?.status).toBe('superseded');
  });

  it('leaves a version without an effective date unknown', () => {
    const map = classifyPriceVersions([v('n', 'pro', null), v('k', 'pro', '2026-01-01')], today);
    expect(map.get('n')).toEqual({ status: 'unknown', tied: false });
    expect(map.get('k')?.status).toBe('current');
  });

  it('finds the earliest upcoming version of a plan', () => {
    const list = [v('a', 'pro', '2026-09-01'), v('b', 'pro', '2027-01-01'), v('c', 'pro', '2026-11-01')];
    expect(nextScheduled(list, today)?.id).toBe('c');
    expect(nextScheduled([v('a', 'pro', '2026-09-01')], today)).toBeNull();
  });

  it('previews an unsaved version with the same rule as the saved ones', () => {
    const list = [v('a', 'pro', '2026-06-01'), v('b', 'basic', '2026-09-01'), v('c', 'pro', '2027-01-01'), v('d', 'pro', '2026-06-01', 'USD')];
    const cand = (plan: string, effective_on: string, currency = 'SAR') => ({ plan, currency, effective_on });
    expect(previewOutcome(list, cand('pro', '2026-12-01'), today)).toBe('scheduled');
    expect(previewOutcome(list, cand('pro', '2026-01-01'), today)).toBe('superseded'); // an older date behind June
    expect(previewOutcome(list, cand('pro', '2026-07-01'), today)).toBe('effective'); // newer than June
    expect(previewOutcome(list, cand('pro', '2026-06-01'), today)).toBe('effective'); // equal date is not "later"
    expect(previewOutcome(list, cand('basic', '2026-01-01'), today)).toBe('superseded');
    expect(previewOutcome(list, cand('enterprise', '2026-01-01'), today)).toBe('effective'); // no other version
    expect(previewOutcome(list, cand('pro', '2026-07-01', 'USD'), today)).toBe('effective'); // other currency group
    expect(previewOutcome(list, cand('pro', '2026-01-01'), today)).not.toBe('scheduled');
  });

  it('todayIsoDate is the UTC calendar date', () => {
    expect(todayIsoDate(new Date('2026-10-12T23:30:00Z'))).toBe('2026-10-12');
  });

  it('computes the time to the next UTC midnight', () => {
    expect(msUntilNextUtcMidnight(new Date('2026-10-12T23:59:30Z'))).toBe(30_000);
    expect(msUntilNextUtcMidnight(new Date('2026-10-12T00:00:00Z'))).toBe(86_400_000);
    expect(msUntilNextUtcMidnight(new Date('2026-12-31T12:00:00Z'))).toBe(12 * 3_600_000);
  });
});
