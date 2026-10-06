import { describe, expect, it } from 'vitest';
import { COMMON_TIMEZONES, WORLD_TIMEZONES, currentDateIn, currentTimeIn, isKnownZone, timezoneGroups, zoneLabel } from './timezones';

describe('timezones', () => {
  it('offers only canonical identifiers, never the browser ICU list or legacy aliases the server may reject', () => {
    const aliases = ['Asia/Calcutta', 'Asia/Saigon', 'Asia/Katmandu', 'Asia/Rangoon', 'Asia/Istanbul', 'Europe/Kiev', 'America/Buenos_Aires', 'Pacific/Samoa', 'US/Eastern', 'GMT'];
    for (const zone of [...COMMON_TIMEZONES, ...WORLD_TIMEZONES]) {
      expect(aliases, zone).not.toContain(zone);
      expect(zone, zone).toMatch(/^([A-Za-z_]+\/[A-Za-z_]+|UTC)$/);
    }
    expect(new Set(WORLD_TIMEZONES).size).toBe(WORLD_TIMEZONES.length);
    expect(WORLD_TIMEZONES).toContain('Asia/Kolkata');
  });

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
    expect(zoneLabel('Asia/Riyadh')).toBe('Riyadh (GMT+03:00)');
    expect(zoneLabel('America/New_York')).toMatch(/^New York \(GMT-0[45]:00\)$/);
  });

  it('shows the wall clock and calendar day of the channel zone, not the device zone', () => {
    const at = new Date('2026-06-01T22:30:00Z'); // 01:30 on Jun 2 in Riyadh, still Jun 1 in UTC
    expect(currentTimeIn('Asia/Riyadh', at)).toBe('01:30');
    expect(currentTimeIn('UTC', at)).toBe('22:30');
    expect(currentDateIn('Asia/Riyadh', at)).toBe('2026-06-02');
    expect(currentDateIn('UTC', at)).toBe('2026-06-01');
    expect(currentDateIn('America/Los_Angeles', at)).toBe('2026-06-01');
  });

  it('never silently substitutes another zone for an unknown one', () => {
    expect(isKnownZone('Asia/Riyadh')).toBe(true);
    expect(isKnownZone('Not/AZone')).toBe(false);
    expect(currentTimeIn('Not/AZone')).toBeNull();
    expect(currentDateIn('Not/AZone')).toBeNull();
  });
});
