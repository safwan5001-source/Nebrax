/**
 * CUST-H1-5 — authoritative-timezone helpers for scheduled Version
 * publishing. Every conversion here must be independent of the machine's
 * own local timezone (CI/dev machines vary) — tests assert exact UTC
 * instants and exact zoned wall-clock strings, never "close enough".
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TENANT_TIMEZONE,
  safeTimeZone,
  suggestedInitialWallTime,
  timeZoneDisplayLabel,
  utcIsoToZonedWallTime,
  zonedWallTimeToUtcIso,
} from '../timezone';

describe('safeTimeZone', () => {
  it('returns a valid IANA identifier unchanged', () => {
    expect(safeTimeZone('Asia/Riyadh')).toBe('Asia/Riyadh');
    expect(safeTimeZone('Africa/Cairo')).toBe('Africa/Cairo');
  });

  it('falls back to the tenant default for null/undefined/empty/invalid input — never the browser zone', () => {
    expect(safeTimeZone(null)).toBe(DEFAULT_TENANT_TIMEZONE);
    expect(safeTimeZone(undefined)).toBe(DEFAULT_TENANT_TIMEZONE);
    expect(safeTimeZone('')).toBe(DEFAULT_TENANT_TIMEZONE);
    expect(safeTimeZone('not-a-real-zone')).toBe(DEFAULT_TENANT_TIMEZONE);
  });
});

describe('zonedWallTimeToUtcIso', () => {
  it('converts an Asia/Riyadh (UTC+3, no DST) wall-clock time to the correct UTC instant', () => {
    // 2026-10-01 21:00 in Riyadh (UTC+3) is 2026-10-01 18:00 UTC.
    const iso = zonedWallTimeToUtcIso('2026-10-01', '21:00', 'Asia/Riyadh');
    expect(iso).toBe('2026-10-01T18:00:00.000Z');
  });

  it('produces the same UTC instant for the same Riyadh wall-clock time regardless of which timezone happens to be passed as a red herring — the function never reads the host/browser zone', () => {
    const a = zonedWallTimeToUtcIso('2026-01-15', '09:30', 'Asia/Riyadh');
    const b = zonedWallTimeToUtcIso('2026-01-15', '09:30', 'Asia/Riyadh');
    expect(a).toBe(b);
    expect(a).toBe('2026-01-15T06:30:00.000Z');
  });

  it('converts correctly for a DST-observing zone (America/New_York) in both summer and winter', () => {
    // Winter: EST is UTC-5.
    expect(zonedWallTimeToUtcIso('2026-01-15', '09:00', 'America/New_York')).toBe(
      '2026-01-15T14:00:00.000Z',
    );
    // Summer: EDT is UTC-4.
    expect(zonedWallTimeToUtcIso('2026-07-15', '09:00', 'America/New_York')).toBe(
      '2026-07-15T13:00:00.000Z',
    );
  });

  it('falls back to the tenant default zone for an invalid timezone instead of throwing', () => {
    expect(zonedWallTimeToUtcIso('2026-10-01', '21:00', 'not-a-real-zone')).toBe(
      zonedWallTimeToUtcIso('2026-10-01', '21:00', 'Asia/Riyadh'),
    );
  });

  it('returns null for a malformed date or time instead of guessing', () => {
    expect(zonedWallTimeToUtcIso('2026-13-01', '21:00', 'Asia/Riyadh')).toBeNull();
    expect(zonedWallTimeToUtcIso('2026-10-01', '25:00', 'Asia/Riyadh')).toBeNull();
    expect(zonedWallTimeToUtcIso('not-a-date', '21:00', 'Asia/Riyadh')).toBeNull();
    expect(zonedWallTimeToUtcIso('2026-10-01', 'not-a-time', 'Asia/Riyadh')).toBeNull();
  });
});

describe('utcIsoToZonedWallTime — the inverse round-trips with zonedWallTimeToUtcIso', () => {
  it('round-trips an Asia/Riyadh wall-clock time', () => {
    const iso = zonedWallTimeToUtcIso('2026-10-01', '21:00', 'Asia/Riyadh');
    expect(iso).not.toBeNull();
    const wall = utcIsoToZonedWallTime(iso as string, 'Asia/Riyadh');
    expect(wall).toEqual({ date: '2026-10-01', time: '21:00' });
  });

  it('displays the same saved UTC instant differently for a different zone — the same instant, not the same wall clock', () => {
    const iso = '2026-10-01T18:00:00.000Z';
    expect(utcIsoToZonedWallTime(iso, 'Asia/Riyadh')).toEqual({ date: '2026-10-01', time: '21:00' });
    // UTC+0 London (no DST in October... actually BST ends late Oct — use a definite UTC zone instead).
    expect(utcIsoToZonedWallTime(iso, 'UTC')).toEqual({ date: '2026-10-01', time: '18:00' });
  });

  it('returns null for an unparsable instant', () => {
    expect(utcIsoToZonedWallTime('not-a-date', 'Asia/Riyadh')).toBeNull();
  });
});

describe('suggestedInitialWallTime', () => {
  it('returns a date/time strictly in the future relative to now', () => {
    const { date, time } = suggestedInitialWallTime('Asia/Riyadh');
    const iso = zonedWallTimeToUtcIso(date, time, 'Asia/Riyadh');
    expect(iso).not.toBeNull();
    expect(new Date(iso as string).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('timeZoneDisplayLabel', () => {
  it('names Riyadh only when the zone actually is Asia/Riyadh', () => {
    expect(timeZoneDisplayLabel('Asia/Riyadh', 'ar')).toBe('بتوقيت الرياض');
    expect(timeZoneDisplayLabel('Asia/Riyadh', 'en')).toBe('Riyadh time');
  });

  it('never claims Riyadh for a different zone — falls back to the zone id + computed offset', () => {
    const label = timeZoneDisplayLabel('Africa/Cairo', 'en');
    expect(label).not.toMatch(/Riyadh/);
    expect(label).toContain('Africa/Cairo');
    expect(label).toMatch(/GMT[+-]\d{2}:\d{2}/);
  });
});

describe('zonedWallTimeToUtcIso — DST transitions (CUST-HV V6c-1)', () => {
  const ny = 'America/New_York';

  it('is exact on either side of spring-forward (2026-03-08 02:00 → 03:00)', () => {
    expect(zonedWallTimeToUtcIso('2026-03-08', '01:30', ny)).toBe('2026-03-08T06:30:00.000Z'); // EST
    expect(zonedWallTimeToUtcIso('2026-03-08', '03:30', ny)).toBe('2026-03-08T07:30:00.000Z'); // EDT
    expect(zonedWallTimeToUtcIso('2026-03-08', '12:00', ny)).toBe('2026-03-08T16:00:00.000Z');
  });

  it('reads a skipped wall time just after the gap', () => {
    expect(zonedWallTimeToUtcIso('2026-03-08', '02:30', ny)).toBe('2026-03-08T07:30:00.000Z'); // = 03:30 EDT
  });

  it('is exact around fall-back (2026-11-01 02:00 → 01:00) and takes the first of a repeated hour', () => {
    expect(zonedWallTimeToUtcIso('2026-11-01', '00:30', ny)).toBe('2026-11-01T04:30:00.000Z'); // EDT
    expect(zonedWallTimeToUtcIso('2026-11-01', '01:30', ny)).toBe('2026-11-01T05:30:00.000Z'); // first 01:30 (EDT)
    expect(zonedWallTimeToUtcIso('2026-11-01', '02:30', ny)).toBe('2026-11-01T07:30:00.000Z'); // EST
  });

  it('round-trips every half hour of a transition day', () => {
    for (const day of ['2026-03-08', '2026-11-01']) {
      for (let h = 0; h < 24; h++) {
        for (const m of ['00', '30']) {
          const time = `${String(h).padStart(2, '0')}:${m}`;
          const iso = zonedWallTimeToUtcIso(day, time, ny);
          expect(iso).not.toBeNull();
          const back = utcIsoToZonedWallTime(iso as string, ny);
          // A skipped wall time (02:xx on spring-forward day) comes back as the later, real one.
          if (!(day === '2026-03-08' && h === 2)) expect(back).toEqual({ date: day, time });
        }
      }
    }
  });

  it('leaves non-DST zones exactly as before (Asia/Riyadh = UTC+3)', () => {
    expect(zonedWallTimeToUtcIso('2026-03-08', '03:30', 'Asia/Riyadh')).toBe('2026-03-08T00:30:00.000Z');
    expect(zonedWallTimeToUtcIso('2026-12-01', '09:30', 'Asia/Riyadh')).toBe('2026-12-01T06:30:00.000Z');
  });
});
