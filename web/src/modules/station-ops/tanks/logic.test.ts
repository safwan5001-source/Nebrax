import { describe, expect, it } from 'vitest';
import { ageParts, evaluateReading, evidenceBody, fillBasisPoints, methodsFor, percentText, readingIntent } from './logic';

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
