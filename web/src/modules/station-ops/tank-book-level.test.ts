import { describe, expect, it } from 'vitest';
import { API_UNAVAILABLE_REASONS, resolveTankBookLevel } from './tank-book-level';
import { evaluateTankLevel } from './tank-level';

const CAP = 34_000_000;
const tank = (over: Record<string, unknown> = {}) => ({ capacity_milliliters: CAP, book_level: undefined as unknown, book_level_unavailable_reason: undefined as unknown, ...over });
const good = (ml: unknown, over: Record<string, unknown> = {}) => ({ milliliters: ml, basis: 'warehouse_book', as_of: null, ...over });

describe('resolveTankBookLevel — the server contract is the only source', () => {
  it('a valid book_level becomes a book-sourced input over the tank capacity (never safe capacity)', () => {
    const view = resolveTankBookLevel(tank({ book_level: good(18_700_000), book_level_unavailable_reason: null }));
    expect(view).toEqual({ kind: 'level', input: { levelMilliliters: 18_700_000, capacityMilliliters: CAP, source: 'book', measuredAt: null } });
  });

  it('a real zero balance is a level, not "unavailable"', () => {
    expect(resolveTankBookLevel(tank({ book_level: good(0), book_level_unavailable_reason: null })).kind).toBe('level');
  });

  it('ignores as_of completely (no unreliable update time can reach the UI)', () => {
    const view = resolveTankBookLevel(tank({ book_level: good(1000, { as_of: '2026-11-06T10:00:00+03:00' }), book_level_unavailable_reason: null }));
    expect(view).toMatchObject({ kind: 'level', input: { measuredAt: null } });
  });

  it.each(API_UNAVAILABLE_REASONS)('null + %s ⇒ that reason, verbatim', (reason) => {
    expect(resolveTankBookLevel(tank({ book_level: null, book_level_unavailable_reason: reason }))).toEqual({ kind: 'unavailable', reason });
  });

  it('an older server (neither field) is "not_provided" — never zero, never computed', () => {
    expect(resolveTankBookLevel(tank())).toEqual({ kind: 'unavailable', reason: 'not_provided' });
  });

  it.each([
    ['null level with no reason', { book_level: null, book_level_unavailable_reason: null }],
    ['null level with an empty reason', { book_level: null, book_level_unavailable_reason: '' }],
    ['null level with a non-string reason', { book_level: null, book_level_unavailable_reason: 7 }],
    ['level and a reason together (contradiction)', { book_level: good(1000), book_level_unavailable_reason: 'multi_tank' }],
    ['a level that is not an object', { book_level: 18_700_000, book_level_unavailable_reason: null }],
    ['an array level', { book_level: [1000], book_level_unavailable_reason: null }],
    ['an unknown basis (cannot be called a book balance)', { book_level: good(1000, { basis: 'physical' }), book_level_unavailable_reason: null }],
    ['a missing basis', { book_level: { milliliters: 1000 }, book_level_unavailable_reason: null }],
    ['a string quantity', { book_level: good('1000'), book_level_unavailable_reason: null }],
    ['a fractional quantity', { book_level: good(10.5), book_level_unavailable_reason: null }],
    ['a negative quantity', { book_level: good(-1), book_level_unavailable_reason: null }],
    ['a non-finite quantity', { book_level: good(Number.POSITIVE_INFINITY), book_level_unavailable_reason: null }],
    ['an unsafe integer quantity', { book_level: good(2 ** 60), book_level_unavailable_reason: null }],
    ['a level only (reason field missing) with a bad shape', { book_level: {} }],
  ])('%s ⇒ invalid_data (explicit, per card)', (_name, over) => {
    expect(resolveTankBookLevel(tank(over))).toEqual({ kind: 'unavailable', reason: 'invalid_data' });
  });

  it('a level without the reason key at all (reason undefined) is accepted when well formed', () => {
    expect(resolveTankBookLevel(tank({ book_level: good(5) })).kind).toBe('level');
  });

  it('an unknown reason code is "unknown_reason" (never echoed to the user)', () => {
    expect(resolveTankBookLevel(tank({ book_level: null, book_level_unavailable_reason: 'brand_new_reason' }))).toEqual({ kind: 'unavailable', reason: 'unknown_reason' });
  });
});

describe('end to end with the evaluator: exact thresholds at real capacity (20% / 50%)', () => {
  const band = (ml: number) => {
    const view = resolveTankBookLevel(tank({ book_level: good(ml), book_level_unavailable_reason: null }));
    if (view.kind !== 'level') throw new Error('expected a level');
    const result = evaluateTankLevel(view.input);
    if (result.kind !== 'ok') throw new Error('expected ok');
    return { band: result.band, shown: result.displayPercent };
  };

  it.each([
    [0, 'low', 0],
    [6_799_999, 'low', 19.99],
    [6_800_000, 'monitor', 20],
    [17_000_000, 'monitor', 50],
    [17_000_001, 'healthy', 50.01],
    [34_000_000, 'healthy', 100],
  ])('%i mL ⇒ %s (%s%%)', (ml, expectedBand, shown) => {
    expect(band(ml)).toEqual({ band: expectedBand, shown });
  });

  it('a zero or invalid capacity never yields a plausible bar', () => {
    for (const capacity of [0, -5]) {
      const view = resolveTankBookLevel({ ...tank({ book_level: good(1000), book_level_unavailable_reason: null }), capacity_milliliters: capacity });
      expect(view.kind).toBe('level');
      if (view.kind === 'level') expect(evaluateTankLevel(view.input)).toMatchObject({ kind: 'unavailable', reason: 'invalid_capacity' });
    }
  });

  it('over capacity stays an anomaly (never clamped)', () => {
    const view = resolveTankBookLevel(tank({ book_level: good(CAP + 1), book_level_unavailable_reason: null }));
    expect(view.kind === 'level' && evaluateTankLevel(view.input).kind).toBe('over_capacity');
  });
});
