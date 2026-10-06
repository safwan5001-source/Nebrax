import { describe, expect, it } from 'vitest';
import type { BlockedDate } from './delivery-schedule';
import { blockedSignature, groupBlocked, isRealIsoDate, todayInZone, validateBlockedInput, weekdayOfIso } from './blocked-dates';

const row = (date: string, method: BlockedDate['method'] = 'all', reason: string | null = null): BlockedDate => ({ date, method, reason });

describe('blocked dates', () => {
  it('accepts only real calendar dates', () => {
    expect(isRealIsoDate('2026-12-25')).toBe(true);
    expect(isRealIsoDate('2028-02-29')).toBe(true);
    expect(isRealIsoDate('2026-02-29')).toBe(false);
    expect(isRealIsoDate('2026-13-01')).toBe(false);
    expect(isRealIsoDate('25/12/2026')).toBe(false);
    expect(isRealIsoDate('')).toBe(false);
  });

  it('derives the channel calendar day from its zone, not the device zone', () => {
    const at = new Date('2026-06-01T22:30:00Z'); // 01:30 on Jun 2 in Riyadh, still Jun 1 in UTC
    expect(todayInZone('Asia/Riyadh', at)).toBe('2026-06-02');
    expect(todayInZone('UTC', at)).toBe('2026-06-01');
    expect(todayInZone('America/Los_Angeles', at)).toBe('2026-06-01');
    expect(todayInZone('Not/AZone', at)).toBeNull();
  });

  it('names the weekday from the date parts without zone shifting', () => {
    expect(weekdayOfIso('2026-10-06')).toBe(2); // Tuesday
    expect(weekdayOfIso('2026-10-04')).toBe(0); // Sunday
    expect(weekdayOfIso('2026-10-10')).toBe(6); // Saturday
  });

  it('splits upcoming from past with today counted as upcoming, sorted ascending', () => {
    const groups = groupBlocked([row('2026-12-25'), row('2026-10-01'), row('2026-10-06', 'pickup'), row('2026-10-06')], '2026-10-06');
    expect(groups.past.map((r) => r.date)).toEqual(['2026-10-01']);
    expect(groups.upcoming.map((r) => `${r.date}:${r.method}`)).toEqual(['2026-10-06:all', '2026-10-06:pickup', '2026-12-25:all']);
    expect(groupBlocked([row('2020-01-01')], null).upcoming).toHaveLength(1);
  });

  it('validates a new block against the existing list', () => {
    const existing = [row('2026-12-25', 'all'), row('2026-12-26', 'pickup')];
    const ok = { date: '2026-12-27', method: 'delivery' as const, reason: '' };
    expect(validateBlockedInput(ok, existing)).toBeNull();
    expect(validateBlockedInput({ ...ok, date: '' }, existing)).toBe('date_required');
    expect(validateBlockedInput({ ...ok, date: '2026-02-30' }, existing)).toBe('date_invalid');
    expect(validateBlockedInput({ ...ok, reason: 'x'.repeat(121) }, existing)).toBe('reason_too_long');
    expect(validateBlockedInput({ date: '2026-12-26', method: 'pickup', reason: '' }, existing)).toBe('duplicate');
    expect(validateBlockedInput({ date: '2026-12-25', method: 'delivery', reason: '' }, existing)).toBe('overlaps_all');
    expect(validateBlockedInput({ date: '2026-12-26', method: 'delivery', reason: '' }, existing)).toBeNull();
    expect(validateBlockedInput(ok, Array.from({ length: 400 }, (_, i) => row(`2027-01-${String((i % 28) + 1).padStart(2, '0')}`, 'all', String(i))))).toBe('limit');
  });

  it('builds an order-independent signature', () => {
    expect(blockedSignature([row('2026-01-01'), row('2026-01-02')])).toBe(blockedSignature([row('2026-01-02'), row('2026-01-01')]));
    expect(blockedSignature([row('2026-01-01')])).not.toBe(blockedSignature([row('2026-01-01', 'pickup')]));
  });
});
