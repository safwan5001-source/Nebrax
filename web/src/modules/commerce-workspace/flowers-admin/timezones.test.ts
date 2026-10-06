import { describe, expect, it } from 'vitest';
import { COMMON_TIMEZONES, currentTimeIn, timezoneGroups, zoneLabel } from './timezones';

describe('timezones', () => {
  it('lists common markets first and never duplicates them in the rest', () => {
    const { common, other } = timezoneGroups('Asia/Riyadh');
    expect(common[0]).toBe('Asia/Riyadh');
    expect(other.filter((z) => (COMMON_TIMEZONES as readonly string[]).includes(z))).toEqual([]);
  });

  it('keeps an unusual saved zone selectable instead of silently showing another one', () => {
    expect(timezoneGroups('Pacific/Honolulu').other).toContain('Pacific/Honolulu');
    expect(timezoneGroups('Not/AZone').other[0]).toBe('Not/AZone');
  });

  it('labels a zone with its city and UTC offset', () => {
    const at = new Date('2026-06-01T12:00:00Z');
    expect(zoneLabel('Asia/Riyadh', 'en', at)).toBe('Riyadh (GMT+3)');
    expect(zoneLabel('America/New_York', 'ar', at)).toBe('New York (GMT-4)');
  });

  it('shows the wall clock of the channel zone, not the browser zone', () => {
    const at = new Date('2026-06-01T21:30:00Z');
    expect(currentTimeIn('Asia/Riyadh', at)).toBe('00:30');
    expect(currentTimeIn('UTC', at)).toBe('21:30');
    expect(currentTimeIn('Not/AZone', at)).toBeNull();
  });
});
