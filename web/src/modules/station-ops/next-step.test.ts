import { describe, expect, it } from 'vitest';
import { buildStationCatalog } from './catalog';
import { meter, nozzle, product, pump, shiftDetail, station, tank, tankReading } from './__fixtures__';
import { pendingReadings } from './entry';
import { STRICT_POLICY } from './policy';
import { deriveNextStep } from './next-step';
import { buildShiftReadings } from './readings';
import type { ShiftDetail } from './schemas';

/** محطة بفوهتين نشطتين (n1,n2). الصلاحيات تُمرَّر صراحةً؛ لا دور مخزَّن. */
const catalog = buildStationCatalog({
  station: station('a'),
  products: [product('p1', 'Alpha')],
  pumps: [pump('pump1', 'a')],
  tanks: [tank('t1', 'a', 'p1')],
  nozzles: [nozzle('n1', 'a', 'pump1', 't1', 'p1'), nozzle('n2', 'a', 'pump1', 't1', 'p1')],
});
const can = (...granted: string[]) => (permission: string) => granted.includes(permission);
const step = (detail: ShiftDetail | null, ...granted: string[]) => deriveNextStep(detail, detail ? buildShiftReadings(detail, catalog).summary : null, can(...granted));

describe('deriveNextStep', () => {
  it('no open shift: only someone who may open one gets a step; others get no card (not an empty one)', () => {
    expect(step(null, 'fuel.shift.open')).toEqual({ kind: 'open_shift', mine: true, remaining: null, href: '/fuel-stations/ops/shifts/open' });
    expect(step(null, 'fuel_stations.view')).toBeNull();
  });

  it('open shift follows the real readings: openings → closings → close', () => {
    const none = shiftDetail('s', 'a');
    expect(step(none, 'fuel.shift.open')).toEqual({ kind: 'opening_readings', mine: true, remaining: 2, href: '/fuel-stations/ops/shifts/s/readings/opening' });
    const opened = shiftDetail('s', 'a', { meter_readings: [meter('1', 'n1', 'opening', 1), meter('2', 'n2', 'opening', 1)] });
    expect(step(opened, 'fuel.shift.open')).toEqual({ kind: 'closing_readings', mine: true, remaining: 2, href: '/fuel-stations/ops/shifts/s/readings/closing' });
    const half = shiftDetail('s', 'a', { meter_readings: [meter('1', 'n1', 'opening', 1), meter('2', 'n2', 'opening', 1), meter('3', 'n1', 'closing', 5)] });
    expect(step(half, 'fuel.shift.open')?.remaining).toBe(1);
    const all = shiftDetail('s', 'a', { meter_readings: ['n1', 'n2'].flatMap((id, i) => [meter(`o${i}`, id, 'opening', 1), meter(`c${i}`, id, 'closing', 5)]) });
    expect(step(all, 'fuel.shift.close', 'fuel.shift.cash_count')).toEqual({ kind: 'close_shift', mine: true, remaining: null, href: '/fuel-stations/ops/shifts/s/handover' });
    // التسليم يحتاج الصلاحيتين معاً (الخادم: close + cash_count)
    expect(step(all, 'fuel.shift.close')?.mine).toBe(false);
  });

  it('"mine" follows the permission of THAT step (closing needs fuel.shift.close, not open)', () => {
    const all = shiftDetail('s', 'a', { meter_readings: ['n1', 'n2'].flatMap((id, i) => [meter(`o${i}`, id, 'opening', 1), meter(`c${i}`, id, 'closing', 5)]) });
    expect(step(all, 'fuel.shift.open')?.mine).toBe(false);
    expect(step(shiftDetail('s', 'a'), 'fuel.shift.close')?.mine).toBe(false);
  });

  it('closed shift waits for approval — mine only for an approver; approved is complete and nobody\'s task', () => {
    expect(step(shiftDetail('s', 'a', { status: 'closed' }), 'fuel.shift.approve')).toEqual({ kind: 'approve_shift', mine: true, remaining: null, href: null });
    expect(step(shiftDetail('s', 'a', { status: 'closed' }), 'fuel.shift.open')).toEqual({ kind: 'approve_shift', mine: false, remaining: null, href: null });
    expect(step(shiftDetail('s', 'a', { status: 'approved' }), 'fuel.shift.approve')).toEqual({ kind: 'complete', mine: false, remaining: null, href: null });
  });

  it('UI-2: required TANK readings keep the step on readings even when every meter is recorded (the server refuses to close without them)', () => {
    const metersOnly = shiftDetail('s', 'a', { meter_readings: ['n1', 'n2'].flatMap((id, i) => [meter(`o${i}`, id, 'opening', 1), meter(`c${i}`, id, 'closing', 5)]) });
    const summary = buildShiftReadings(metersOnly, catalog).summary;
    const extra = pendingReadings(metersOnly, catalog, STRICT_POLICY);
    expect(extra).toEqual({ openingRemaining: 1, closingRemaining: 1 });
    expect(deriveNextStep(metersOnly, summary, can('fuel.shift.open', 'fuel.shift.close', 'fuel.shift.cash_count'), extra)).toEqual({ kind: 'opening_readings', mine: true, remaining: 1, href: '/fuel-stations/ops/shifts/s/readings/opening' });
    // سياسة معلومة لا تشترط الخزانات ⇒ الإغلاق هو الخطوة
    const lax = { ...STRICT_POLICY, known: true, openingTankRequired: false, closingTankRequired: false };
    const none = pendingReadings(metersOnly, catalog, lax);
    expect(deriveNextStep(metersOnly, summary, can('fuel.shift.close', 'fuel.shift.cash_count'), none)?.kind).toBe('close_shift');
    // الفتح فقط ثم الإغلاق
    const withTankOpening = shiftDetail('s', 'a', { meter_readings: metersOnly.meter_readings, tank_readings: [tankReading('t1o', 't1', 'opening', 100)] });
    const e2 = pendingReadings(withTankOpening, catalog, STRICT_POLICY);
    expect(e2).toEqual({ openingRemaining: 0, closingRemaining: 1 });
    expect(deriveNextStep(withTankOpening, buildShiftReadings(withTankOpening, catalog).summary, can('fuel.shift.open'), e2)).toMatchObject({ kind: 'closing_readings', remaining: 1 });
  });

  it('UI-2: when the policy makes meter readings optional and every required tank reading is saved, the stage is complete and handover is exposed', () => {
    const tanksOnly = shiftDetail('s', 'a', { tank_readings: [tankReading('to', 't1', 'opening', 100), tankReading('tc', 't1', 'closing', 90)] });
    const policy = { ...STRICT_POLICY, known: true, openingMeterRequired: false, closingMeterRequired: false };
    const extra = pendingReadings(tanksOnly, catalog, policy);
    expect(extra).toEqual({ openingRemaining: 0, closingRemaining: 0 });
    expect(deriveNextStep(tanksOnly, buildShiftReadings(tanksOnly, catalog).summary, can('fuel.shift.close', 'fuel.shift.cash_count'), extra)).toMatchObject({ kind: 'close_shift', href: '/fuel-stations/ops/shifts/s/handover' });
  });

  it('never invents a step for a status the server does not have (no "returned"/"submitted")', () => {
    expect(step(shiftDetail('s', 'a', { status: 'returned' }), 'fuel.shift.approve')).toBeNull();
  });

  it('a station with no active nozzle gives no misleading "0 remaining" count', () => {
    const empty = buildStationCatalog({ station: station('a'), products: [], pumps: [], tanks: [], nozzles: [] });
    const detail = shiftDetail('s', 'a');
    expect(deriveNextStep(detail, buildShiftReadings(detail, empty).summary, can('fuel.shift.open'))?.remaining).toBeNull();
  });
});
