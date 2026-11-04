import { describe, expect, it } from 'vitest';
import type { OperationsView } from './api';
import { addPeriod, draftFromView, isoToLocal, localToIso, minorToRiyalText, removePeriodAt, updatePeriodAt, validateDraft, validateHours, type Draft } from './form';

const view = (over: Partial<OperationsView> = {}): OperationsView => ({
  version: 3, acceptingOrders: true, pausedUntil: null, pauseMessage: null, outsideHoursPolicy: 'accept', openingHours: [], minOrderMinor: null, minOrderScope: 'all', deploymentEnabled: true, ...over,
});
const now = new Date('2026-11-09T07:00:00Z');
const run = (draft: Partial<Draft>, v = view()) => validateDraft({ ...draftFromView(v), ...draft }, v, now);
const changes = (draft: Partial<Draft>, v = view()) => {
  const r = run(draft, v);
  if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.errors)}`);
  return r.changes;
};
const errors = (draft: Partial<Draft>, v = view()) => {
  const r = run(draft, v);
  if (r.ok) throw new Error('expected errors');
  return r.errors;
};

describe('validateDraft (COPS-H4-3 UI)', () => {
  it('an untouched draft produces no changes', () => {
    expect(changes({})).toEqual({});
  });

  it('sends only what changed', () => {
    expect(changes({ accepting: false })).toEqual({ accepting_orders: false });
    expect(changes({ pauseMessage: '  نعود قريباً ' })).toEqual({ pause_message: 'نعود قريباً' });
    expect(changes({ policy: 'block' })).toEqual({ outside_hours_policy: 'block' });
    expect(changes({ minScope: 'delivery_only' })).toEqual({ min_order_scope: 'delivery_only' });
  });

  it.each([['150', 15000], ['0.5', 50], ['12.50', 1250], ['1,500', 150000], ['٢٠', 2000]])('minimum %s SAR → %i halalas (integer)', (text, minor) => {
    expect(changes({ minOrder: text })).toEqual({ min_order_minor: minor });
  });

  it.each(['abc', '0', '-5', '1.234', '1000000000.01'])('rejects the minimum %j', (text) => {
    expect(errors({ minOrder: text }).minOrder).toBe('minOrderInvalid');
  });

  it('clearing the minimum sends null; an already-empty one sends nothing', () => {
    expect(changes({ minOrder: '' }, view({ minOrderMinor: 5000 }))).toEqual({ min_order_minor: null });
    expect(changes({ minOrder: '' })).toEqual({});
    expect(minorToRiyalText(5000)).toBe('50');
    expect(minorToRiyalText(1250)).toBe('12.50');
    expect(minorToRiyalText(null)).toBe('');
  });

  it('pause message: plain text up to 200, empty clears, HTML rejected', () => {
    expect(errors({ pauseMessage: '<b>x</b>' }).pauseMessage).toBe('pauseMessageInvalid');
    expect(errors({ pauseMessage: 'ا'.repeat(201) }).pauseMessage).toBe('pauseMessageInvalid');
    expect(changes({ pauseMessage: 'ا'.repeat(200) }).pause_message).toHaveLength(200);
    expect(changes({ pauseMessage: '   ' }, view({ pauseMessage: 'old' }))).toEqual({ pause_message: null });
  });

  it('a resume time applies only while paused and must be in the future', () => {
    // والطلبات مقبولة يُتجاهل نص الموعد (الواجهة تعطّله وتمسحه عند الاستئناف).
    expect(changes({ accepting: true, pausedUntil: '2026-11-10T10:00' })).toEqual({});
    expect(errors({ accepting: false, pausedUntil: '2020-01-01T10:00' }).pausedUntil).toBe('pausedUntilPast');
    const c = changes({ accepting: false, pausedUntil: '2099-01-01T10:00' });
    expect(c.accepting_orders).toBe(false);
    expect(c.paused_until).toBe(new Date('2099-01-01T10:00').toISOString());
  });

  it('resuming clears the stale resume time in the same save', () => {
    const paused = view({ acceptingOrders: false, pausedUntil: '2099-01-01T07:00:00Z' });
    expect(changes({ accepting: true, pausedUntil: '' }, paused)).toEqual({ accepting_orders: true, paused_until: null });
    expect(changes({ accepting: true }, paused)).toEqual({ accepting_orders: true, paused_until: null });
  });

  it('a stored resume time that has passed does not block unrelated edits', () => {
    const paused = view({ acceptingOrders: false, pausedUntil: '2020-01-01T07:00:00Z' });
    expect(changes({ pauseMessage: 'x' }, paused)).toEqual({ pause_message: 'x' });
  });

  it('a closed deployment gate refuses entering a block, allows keeping/leaving one and non-blocking edits', () => {
    const gate = view({ deploymentEnabled: false });
    expect(errors({ accepting: false }, gate).gate).toBe('gateClosed');
    expect(errors({ policy: 'block' }, gate).gate).toBe('gateClosed');
    expect(errors({ minOrder: '50' }, gate).gate).toBe('gateClosed');
    expect(changes({ pauseMessage: 'hi', minScope: 'delivery_only', hours: [{ weekday: 1, opens_at: '09:00', closes_at: '17:00' }] }, gate)).toBeTruthy();
    const stored = view({ deploymentEnabled: false, acceptingOrders: false, outsideHoursPolicy: 'block', minOrderMinor: 5000 });
    expect(changes({ accepting: true, policy: 'accept', minOrder: '' }, stored)).toEqual({ accepting_orders: true, outside_hours_policy: 'accept', min_order_minor: null });
    expect(changes({ minOrder: '70' }, stored)).toEqual({ min_order_minor: 7000 });
  });

  it('opening hours are sorted when sent and an unchanged set sends nothing', () => {
    const base = view({ openingHours: [{ weekday: 0, opens_at: '09:00', closes_at: '17:00' }] });
    expect(changes({ hours: [...base.openingHours] }, base)).toEqual({});
    const c = changes({ hours: [{ weekday: 3, opens_at: '10:00', closes_at: '12:00' }, { weekday: 0, opens_at: '09:00', closes_at: '17:00' }] }, base);
    expect(c.opening_hours).toEqual([{ weekday: 0, opens_at: '09:00', closes_at: '17:00' }, { weekday: 3, opens_at: '10:00', closes_at: '12:00' }]);
    expect(changes({ hours: [] }, base)).toEqual({ opening_hours: [] });
  });
});

describe('validateHours', () => {
  const p = (o: Partial<{ weekday: number; opens_at: string; closes_at: string }> = {}) => ({ weekday: 1, opens_at: '09:00', closes_at: '17:00', ...o });

  it('accepts valid sets including 00:00 and 24:00', () => {
    expect(validateHours([])).toBeNull();
    expect(validateHours([p({ opens_at: '00:00', closes_at: '24:00' })])).toBeNull();
    expect(validateHours([p(), p({ opens_at: '17:00', closes_at: '20:00' })])).toBeNull();
  });

  it.each([
    ['weekday 7', [p({ weekday: 7 })], 'hoursInvalid'],
    ['opens 24:00', [p({ opens_at: '24:00' })], 'hoursInvalid'],
    ['closes 24:01', [p({ closes_at: '24:01' })], 'hoursInvalid'],
    ['9:00 format', [p({ opens_at: '9:00' })], 'hoursInvalid'],
    ['opens == closes', [p({ opens_at: '10:00', closes_at: '10:00' })], 'hoursInvalid'],
    ['overnight', [p({ opens_at: '22:00', closes_at: '02:00' })], 'hoursInvalid'],
    ['overlap', [p(), p({ opens_at: '16:00', closes_at: '20:00' })], 'hoursOverlap'],
    ['duplicate', [p(), p()], 'hoursOverlap'],
    ['four in a day', [1, 3, 5, 7].map((h) => p({ opens_at: `0${h}:00`, closes_at: `0${h}:30` })), 'hoursTooMany'],
  ])('rejects %s', (_label, hours, error) => {
    expect(validateHours(hours)).toBe(error);
  });

  it('rejects more than 21 periods', () => {
    const many = [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [1, 3, 5, 7].map((h) => p({ weekday, opens_at: `0${h}:00`, closes_at: `0${h}:30` })));
    expect(validateHours(many)).toBe('hoursTooMany');
  });
});

describe('period helpers and datetime conversion', () => {
  it('edits periods by index (stable while typing)', () => {
    let hours = addPeriod([], 2);
    hours = addPeriod(hours, 2);
    expect(hours).toHaveLength(2);
    hours = updatePeriodAt(hours, 1, { opens_at: '18:00', closes_at: '22:00' });
    expect(hours[1]).toEqual({ weekday: 2, opens_at: '18:00', closes_at: '22:00' });
    expect(removePeriodAt(hours, 0)).toEqual([hours[1]]);
  });

  it('round-trips a local datetime through ISO UTC', () => {
    const local = '2026-11-09T14:30';
    expect(isoToLocal(localToIso(local))).toBe(local);
    expect(localToIso('')).toBeNull();
    expect(localToIso('garbage')).toBeNull();
    expect(isoToLocal(null)).toBe('');
  });
});
