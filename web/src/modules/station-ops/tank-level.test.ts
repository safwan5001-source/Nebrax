import { describe, expect, it } from 'vitest';
import { classifyTankLevel, displayPercent, evaluateTankLevel, TANK_LEVEL_THRESHOLDS, type TankLevelInput } from './tank-level';

const CAP = 10_000; // 10 L: 1 mL = 0.01% ⇒ كل نسبة مطلوبة تُمثَّل بعدد صحيح من mL
const input = (levelMilliliters: number | null | undefined, over: Partial<TankLevelInput> = {}): TankLevelInput => ({ levelMilliliters, capacityMilliliters: CAP, ...over });

describe('thresholds are explicit, visual-only config', () => {
  it('exposes 20 / 50', () => {
    expect(TANK_LEVEL_THRESHOLDS).toEqual({ lowBelowPercent: 20, healthyAbovePercent: 50 });
  });
});

describe('band boundaries (exact, integer comparison)', () => {
  it.each([
    [0, 'low'],
    [1_999, 'low'], // 19.99%
    [2_000, 'monitor'], // 20% شاملة للمتابعة
    [3_500, 'monitor'],
    [5_000, 'monitor'], // 50% شاملة للمتابعة
    [5_001, 'healthy'], // 50.01%
    [5_500, 'healthy'],
    [10_000, 'healthy'], // 100%
  ] as const)('level %i of 10000 mL ⇒ %s', (level, band) => {
    const result = evaluateTankLevel(input(level));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.band).toBe(band);
  });

  it('classification does not depend on rounding of the displayed percent', () => {
    // 19.999…% يُقرَّب عرضاً إلى 20 لكنه منخفض فعلاً.
    expect(classifyTankLevel(19_999, 100_000)).toBe('low');
    expect(classifyTankLevel(50_001, 100_000)).toBe('healthy');
    expect(classifyTankLevel(50_000, 100_000)).toBe('monitor');
  });

  it('works for large real-world capacities (34,000 L)', () => {
    expect(evaluateTankLevel({ levelMilliliters: 18_700_000, capacityMilliliters: 34_000_000 })).toMatchObject({ kind: 'ok', band: 'healthy', displayPercent: 55 });
    expect(evaluateTankLevel({ levelMilliliters: 4_760_000, capacityMilliliters: 34_000_000 })).toMatchObject({ kind: 'ok', band: 'low', displayPercent: 14 });
  });
});

describe('percent value and display', () => {
  it('computes level / capacity × 100, with decimals kept in the exact value', () => {
    const result = evaluateTankLevel(input(3_333));
    expect(result).toMatchObject({ kind: 'ok', percent: expect.closeTo(33.33, 10), displayPercent: 33 });
  });

  it('never shows a boundary value that the real value does not equal', () => {
    expect(displayPercent(19.99)).toBe(19.99); // لا «20» بجانب «منخفض»
    expect(displayPercent(20)).toBe(20);
    expect(displayPercent(20.004)).toBe(20.01);
    expect(displayPercent(49.996)).toBe(49.99);
    expect(displayPercent(50)).toBe(50);
    expect(displayPercent(50.004)).toBe(50.01); // لا «50» بجانب «جيد»
    expect(displayPercent(99.996)).toBe(99.99); // لا «100» لخزان غير ممتلئ
    expect(displayPercent(100)).toBe(100);
    expect(displayPercent(14.4)).toBe(14);
    expect(displayPercent(54.6)).toBe(55);
  });

  it('0% and 100% are real values only when the data says so', () => {
    expect(evaluateTankLevel(input(0))).toMatchObject({ kind: 'ok', percent: 0, displayPercent: 0, band: 'low' });
    expect(evaluateTankLevel(input(CAP))).toMatchObject({ kind: 'ok', percent: 100, displayPercent: 100, band: 'healthy' });
  });
});

describe('invalid / missing data is never turned into a plausible bar', () => {
  it.each([
    ['null level', input(null), 'missing_level'],
    ['undefined level', input(undefined), 'missing_level'],
    ['negative level', input(-1), 'invalid_level'],
    ['NaN level', input(Number.NaN), 'invalid_level'],
    ['Infinity level', input(Number.POSITIVE_INFINITY), 'invalid_level'],
    ['string level', input('5000' as unknown as number), 'invalid_level'],
  ] as const)('%s ⇒ unavailable/%s keeps the known capacity', (_name, value, reason) => {
    expect(evaluateTankLevel(value)).toEqual({ kind: 'unavailable', reason, capacityMilliliters: CAP });
  });

  it.each([0, -5, Number.NaN, null, undefined])('capacity %s ⇒ unavailable/invalid_capacity with no capacity claimed', (capacity) => {
    expect(evaluateTankLevel({ levelMilliliters: 1_000, capacityMilliliters: capacity })).toEqual({ kind: 'unavailable', reason: 'invalid_capacity', capacityMilliliters: null });
  });

  it('conflicting units are refused, not converted', () => {
    expect(evaluateTankLevel(input(5_000, { levelUnit: 'L' }))).toMatchObject({ kind: 'unavailable', reason: 'conflicting_unit' });
    expect(evaluateTankLevel(input(5_000, { capacityUnit: 'gal' }))).toMatchObject({ kind: 'unavailable', reason: 'conflicting_unit' });
    // الوحدة الصريحة بالمليلتر مقبولة، والغياب = مليلتر.
    expect(evaluateTankLevel(input(5_000, { levelUnit: 'ml', capacityUnit: 'milliliters' }))).toMatchObject({ kind: 'ok' });
  });

  it('over capacity is an anomaly, never clamped to 100%', () => {
    const result = evaluateTankLevel(input(CAP + 1));
    expect(result).toMatchObject({ kind: 'over_capacity', levelMilliliters: CAP + 1, capacityMilliliters: CAP });
    expect(result).not.toHaveProperty('percent');
    expect(result).not.toHaveProperty('band');
  });
});

describe('metadata is optional and never invented', () => {
  it('missing source / timestamp ⇒ null (no "actual"/"live" implied)', () => {
    expect(evaluateTankLevel(input(5_000))).toMatchObject({ kind: 'ok', source: null, measuredAt: null });
  });

  it('keeps declared source and timestamp as sent', () => {
    expect(evaluateTankLevel(input(5_000, { source: 'physical', measuredAt: '2026-11-06T08:00:00Z' }))).toMatchObject({ source: 'physical', measuredAt: '2026-11-06T08:00:00Z' });
  });

  it('an unknown source string is dropped rather than shown', () => {
    expect(evaluateTankLevel(input(5_000, { source: 'live' as never }))).toMatchObject({ source: null });
  });
});
