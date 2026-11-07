import { describe, expect, it } from 'vitest';
import { ageParts, evaluateLateTime, evaluateReading, evidenceBody, fillBasisPoints, methodsFor, percentText, readingIntent, zonedLocalToIso } from './logic';

const limits = { capacityMl: 200_000, safeCapacityMl: 190_000, minimumLevelMl: 20_000, deadStockMl: 5_000 };

describe('reading evaluation mirrors the server rules with the tank’s own approved values only', () => {
  it('never turns an empty or malformed entry into zero', () => {
    expect(evaluateReading('', limits, null)).toEqual({ kind: 'empty' });
    expect(evaluateReading('   ', limits, null)).toEqual({ kind: 'empty' });
    for (const bad of ['-1', '1,500', 'abc', '1.2345', '1e3', '--2', '1.5.5']) expect(evaluateReading(bad, limits, null).kind, bad).toBe('invalid');
  });

  it('accepts an explicit zero (an empty tank) and Arabic-Indic digits normalised to a safe integer', () => {
    const zero = evaluateReading('0', limits, null);
    expect(zero.kind).toBe('ok');
    expect(evaluateReading('١٥٠٫٥', limits, null)).toMatchObject({ kind: 'ok', ml: 150_500 });
  });

  it('blocks only what the server would refuse: above the approved capacity', () => {
    expect(evaluateReading('200.001', limits, null)).toEqual({ kind: 'over_capacity', ml: 200_001 });
    expect(evaluateReading('200', limits, null)).toMatchObject({ kind: 'ok', ml: 200_000, flags: ['above_safe_capacity'] });
  });

  it('flags review states from the configured values and invents no threshold', () => {
    expect(evaluateReading('150', limits, null)).toMatchObject({ kind: 'ok', flags: [] });
    expect(evaluateReading('195', limits, null)).toMatchObject({ flags: ['above_safe_capacity'] });
    expect(evaluateReading('4', limits, null)).toMatchObject({ flags: ['below_minimum_level', 'below_dead_stock'] });
    // قيم الخزان غير المضبوطة (0) لا تُنتج أعلاماً
    expect(evaluateReading('0.5', { capacityMl: 200_000, safeCapacityMl: 0, minimumLevelMl: 0, deadStockMl: 0 }, null)).toMatchObject({ flags: [] });
  });

  it('computes fill and headroom with integers and the delta from the previous reading of the same type', () => {
    expect(evaluateReading('150', limits, 100_000)).toMatchObject({ fillBasisPoints: 7500, availableMl: 50_000, deltaMl: 50_000 });
    expect(evaluateReading('50', limits, 100_000)).toMatchObject({ deltaMl: -50_000 });
    expect(evaluateReading('50', limits, null)).toMatchObject({ deltaMl: null });
    expect(fillBasisPoints(1, 3)).toBe(3333);
    expect(fillBasisPoints(1, 0)).toBeNull();
  });
});

describe('presentation helpers', () => {
  it('formats the percentage with Latin digits in both locales', () => {
    expect(percentText(7525, 'ar')).toBe('75.3');
    expect(percentText(7500, 'en')).toBe('75');
    expect(percentText(null, 'ar')).toBe('—');
  });

  it('splits the age without inventing a freshness verdict', () => {
    expect(ageParts(null)).toBeNull();
    expect(ageParts(30)).toEqual({ unit: 'minutes', value: 0 });
    expect(ageParts(3 * 3600 + 10)).toEqual({ unit: 'hours', value: 3 });
    expect(ageParts(2 * 86400)).toEqual({ unit: 'days', value: 2 });
  });

  it('changes the intent whenever any field changes, so a key is never reused for a different payload', () => {
    const base = { stationId: 's', tankId: 't', type: 'physical', ml: 1, method: 'dipstick', note: 'x' };
    const key = JSON.stringify(readingIntent(base));
    for (const changed of [{ ml: 2 }, { type: 'atg' }, { method: 'gauge' }, { note: 'y' }, { tankId: 't2' }]) expect(JSON.stringify(readingIntent({ ...base, ...changed }))).not.toBe(key);
    expect(JSON.stringify(readingIntent({ ...base, note: '  x  ' }))).toBe(key); // الفراغات الطرفية لا تصنع نية جديدة
  });

  it('offers only sensible sources per type and a bounded evidence body', () => {
    expect(methodsFor('physical')).toEqual(['dipstick', 'gauge', 'other']);
    expect(methodsFor('atg')).toEqual(['atg_console', 'other']);
    expect(evidenceBody('gauge', '   ')).toEqual({ method: 'gauge' });
    expect(evidenceBody('gauge', 'x'.repeat(900)).note).toHaveLength(500);
  });
});

describe('late-time handling uses the station time zone and only guides (the server decides)', () => {
  it('converts a local picker value in the station zone to the exact instant', () => {
    expect(zonedLocalToIso('2026-11-06T09:00', 'Asia/Riyadh')).toBe('2026-11-06T06:00:00.000Z'); // UTC+3 بلا توقيت صيفي
    expect(zonedLocalToIso('2026-07-01T09:00', 'America/New_York')).toBe('2026-07-01T13:00:00.000Z'); // صيفي UTC−4
    expect(zonedLocalToIso('2026-01-01T09:00', 'America/New_York')).toBe('2026-01-01T14:00:00.000Z'); // شتوي UTC−5
    expect(zonedLocalToIso('2026-11-06T00:00', 'UTC')).toBe('2026-11-06T00:00:00.000Z');
  });

  it('rejects malformed values and impossible dates instead of guessing', () => {
    for (const bad of ['', '2026-11-06', '2026-11-06 09:00', '2026-13-01T09:00', '2026-02-31T09:00', 'abc']) expect(zonedLocalToIso(bad, 'Asia/Riyadh'), bad).toBeNull();
  });

  it('falls back to the device zone for an invalid or missing station zone', () => {
    expect(zonedLocalToIso('2026-11-06T09:00', 'Not/AZone')).toBe(new Date(2026, 10, 6, 9, 0).toISOString());
    expect(zonedLocalToIso('2026-11-06T09:00', null)).toBe(new Date(2026, 10, 6, 9, 0).toISOString());
  });

  it('classifies the chosen time against the policy window with exact boundaries', () => {
    const now = Date.parse('2026-11-06T12:00:00Z');
    const at = (iso: string) => evaluateLateTime(iso, 'UTC', 24, now);
    expect(at('')).toEqual({ kind: 'empty' });
    expect(at('garbage')).toEqual({ kind: 'invalid' });
    expect(at('2026-11-06T13:00')).toEqual({ kind: 'future' });
    expect(at('2026-11-06T11:58')).toEqual({ kind: 'not_late' }); // ضمن سماحية 5 دقائق
    expect(at('2026-11-06T11:00')).toMatchObject({ kind: 'ok', hoursAgo: 1, iso: '2026-11-06T11:00:00.000Z' });
    expect(at('2026-11-05T12:00')).toMatchObject({ kind: 'ok', hoursAgo: 24 }); // الحد نفسه مسموح
    expect(at('2026-11-05T11:59')).toEqual({ kind: 'too_old', hours: 24 });
  });

  it('keeps the reading intent stable per time/reason and distinct when either changes', () => {
    const base = { stationId: 's', tankId: 't', type: 'physical', ml: 1, method: 'dipstick', note: '', at: '2026-11-06T06:00:00.000Z', reason: 'سبب' };
    const key = JSON.stringify(readingIntent(base));
    expect(JSON.stringify(readingIntent({ ...base, at: '2026-11-06T07:00:00.000Z' }))).not.toBe(key);
    expect(JSON.stringify(readingIntent({ ...base, reason: 'آخر' }))).not.toBe(key);
    expect(JSON.stringify(readingIntent({ ...base, reason: ' سبب ' }))).toBe(key);
    expect(JSON.stringify(readingIntent({ ...base, at: null }))).not.toBe(key);
  });
});
