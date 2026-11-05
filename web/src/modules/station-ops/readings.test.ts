import { describe, expect, it } from 'vitest';
import { buildStationCatalog } from './catalog';
import { meter, nozzle, product, pump, shiftDetail, station, tank, tankReading } from './__fixtures__';
import { buildShiftReadings, buildTankRows, classifyRow, deriveProgress } from './readings';
import { elapsedBetween, formatLitersFixedFromMl, formatStampInZone, parseInstant } from './format';

/**
 * UI-1 — منطق قراءات الوردية النقي. الأرقام كلها mL صحيحة؛ الغياب حالة مسمّاة لا صفر.
 * المحطة: مضختان؛ ثلاث فوهات نشطة (n1,n2 على المضخة 1، n3 على المضخة 2) + فوهة معطّلة n4.
 */
const S = station('a');
const catalog = () =>
  buildStationCatalog({
    station: S,
    products: [product('p1', 'Alpha'), product('p2', 'Beta')],
    pumps: [pump('pump1', 'a'), pump('pump2', 'a')],
    tanks: [tank('t1', 'a', 'p1'), tank('t2', 'a', 'p2')],
    nozzles: [
      nozzle('n1', 'a', 'pump1', 't1', 'p1'),
      nozzle('n2', 'a', 'pump1', 't2', 'p2'),
      nozzle('n3', 'a', 'pump2', 't1', 'p1'),
      nozzle('n4', 'a', 'pump2', 't1', 'p1', { status: 'inactive' }),
    ],
  });

describe('classifyRow', () => {
  it('complete: closing − opening in whole mL, including a real zero', () => {
    expect(classifyRow(meter('o', 'n1', 'opening', 1_000), meter('c', 'n1', 'closing', 1_000))).toEqual({ status: 'complete', deltaMl: 0 });
    expect(classifyRow(meter('o', 'n1', 'opening', 0), meter('c', 'n1', 'closing', 690_500))).toEqual({ status: 'complete', deltaMl: 690_500 });
  });
  it('closing below opening is invalid and has no delta (never negative liters)', () => {
    expect(classifyRow(meter('o', 'n1', 'opening', 500), meter('c', 'n1', 'closing', 100))).toEqual({ status: 'invalid_order', deltaMl: null });
  });
  it('a missing side is a named state, not zero', () => {
    expect(classifyRow(meter('o', 'n1', 'opening', 5), null)).toEqual({ status: 'awaiting_closing', deltaMl: null });
    expect(classifyRow(null, meter('c', 'n1', 'closing', 5))).toEqual({ status: 'closing_without_opening', deltaMl: null });
    expect(classifyRow(null, null)).toEqual({ status: 'not_recorded', deltaMl: null });
  });
});

describe('buildShiftReadings — open shift', () => {
  const detail = shiftDetail('s', 'a', {
    status: 'open',
    operational_meter_milliliters: 0, // الخادم لا يحسبه إلا عند الإغلاق
    meter_readings: [meter('1', 'n1', 'opening', 1_000_000), meter('2', 'n1', 'closing', 1_500_000), meter('3', 'n2', 'opening', 2_000_000)],
  });

  it('expects exactly the currently active nozzles and lists every one of them (missing ones are visible)', () => {
    const view = buildShiftReadings(detail, catalog());
    expect(view.summary.expected).toBe(3); // n4 معطّلة لا تُتوقَّع
    const rows = view.groups.flatMap((group) => group.rows.map((row) => [row.nozzleId, row.status]));
    expect(rows).toEqual([['n1', 'complete'], ['n2', 'awaiting_closing'], ['n3', 'not_recorded']]);
  });

  it('computes liters from complete pairs only, flags the total as partial, and has no server total', () => {
    const { summary } = buildShiftReadings(detail, catalog());
    expect(summary).toMatchObject({ complete: 1, withOpening: 2, withClosing: 1, computedMl: 500_000, serverMl: null, mismatch: false, partial: true });
  });

  it('is not partial once every expected nozzle has both readings', () => {
    const full = shiftDetail('s', 'a', {
      meter_readings: ['n1', 'n2', 'n3'].flatMap((id, i) => [meter(`o${i}`, id, 'opening', 100), meter(`c${i}`, id, 'closing', 600)]),
    });
    expect(buildShiftReadings(full, catalog()).summary).toMatchObject({ complete: 3, computedMl: 1_500, partial: false });
  });

  it('with no readings at all nothing is computed (computedMl 0 but complete 0 — the UI must show "—")', () => {
    const { summary } = buildShiftReadings(shiftDetail('s', 'a'), catalog());
    expect(summary).toMatchObject({ complete: 0, computedMl: 0, partial: true });
  });

  it('groups by pump in natural order and sorts nozzles inside', () => {
    const view = buildShiftReadings(detail, catalog());
    expect(view.groups.map((group) => group.pump?.id)).toEqual(['pump1', 'pump2']);
    expect(view.groups[0].rows.map((row) => row.nozzleId)).toEqual(['n1', 'n2']);
  });
});

describe('buildShiftReadings — coverage is measured against the ACTIVE nozzles (Codex P2)', () => {
  // n4 معطّلة وفي مضختها قراءات مكتملة؛ n1..n3 نشطة بلا قراءات.
  const detail = shiftDetail('s', 'a', { status: 'open', meter_readings: [meter('1', 'n4', 'opening', 0), meter('2', 'n4', 'closing', 800_000)] });

  it('a complete pair on a disabled nozzle does not make the active nozzles look covered', () => {
    const { summary } = buildShiftReadings(detail, catalog());
    expect(summary).toMatchObject({ expected: 3, complete: 0, withOpening: 0, withClosing: 0, partial: true });
  });

  it('…yet its liters are still counted (nothing recorded is dropped)', () => {
    const { summary } = buildShiftReadings(detail, catalog());
    expect(summary).toMatchObject({ recordedComplete: 1, computedMl: 800_000 });
  });

  it('progress and next step still ask for the missing active nozzles', () => {
    const view = buildShiftReadings(detail, catalog());
    expect(deriveProgress(detail, view.summary).find((step) => step.state === 'current')?.key).toBe('opening_readings');
  });

  it('only recorded pairs on active nozzles reduce the remaining count', () => {
    const mixed = shiftDetail('s', 'a', { status: 'open', meter_readings: [meter('1', 'n4', 'opening', 0), meter('2', 'n4', 'closing', 5), meter('3', 'n1', 'opening', 0), meter('4', 'n1', 'closing', 9)] });
    expect(buildShiftReadings(mixed, catalog()).summary).toMatchObject({ complete: 1, recordedComplete: 2, computedMl: 14, partial: true });
  });
});

describe('buildShiftReadings — closed / approved', () => {
  it('shows only what was recorded (the current setup is not assumed to match the past) and uses the server total', () => {
    const detail = shiftDetail('s', 'a', {
      status: 'closed',
      operational_meter_milliliters: 500_000,
      meter_readings: [meter('1', 'n1', 'opening', 1_000_000), meter('2', 'n1', 'closing', 1_500_000)],
    });
    const view = buildShiftReadings(detail, catalog());
    expect(view.groups.flatMap((group) => group.rows.map((row) => row.nozzleId))).toEqual(['n1']);
    expect(view.summary).toMatchObject({ expected: null, serverMl: 500_000, computedMl: 500_000, mismatch: false, partial: false });
  });

  it('flags a mismatch between the server total and the displayed nozzle differences', () => {
    const detail = shiftDetail('s', 'a', {
      status: 'approved',
      operational_meter_milliliters: 900_000,
      meter_readings: [meter('1', 'n1', 'opening', 0), meter('2', 'n1', 'closing', 500_000)],
    });
    expect(buildShiftReadings(detail, catalog()).summary.mismatch).toBe(true);
  });

  it('a closed shift with a real zero total is zero, not "unknown" (server total 0 and equal computed 0)', () => {
    const detail = shiftDetail('s', 'a', { status: 'closed', operational_meter_milliliters: 0, meter_readings: [meter('1', 'n1', 'opening', 7), meter('2', 'n1', 'closing', 7)] });
    expect(buildShiftReadings(detail, catalog()).summary).toMatchObject({ serverMl: 0, computedMl: 0, mismatch: false, complete: 1 });
  });

  it('excludes invalid pairs from the total and counts them', () => {
    const detail = shiftDetail('s', 'a', {
      status: 'closed',
      operational_meter_milliliters: 0,
      meter_readings: [meter('1', 'n1', 'opening', 900), meter('2', 'n1', 'closing', 100)],
    });
    expect(buildShiftReadings(detail, catalog()).summary).toMatchObject({ invalid: 1, complete: 0, computedMl: 0 });
  });
});

describe('buildShiftReadings — assets outside the current setup', () => {
  it('keeps readings of nozzles that are not in this station\'s setup (never silently dropped) and includes them in the total', () => {
    const detail = shiftDetail('s', 'a', {
      status: 'closed',
      operational_meter_milliliters: 300,
      meter_readings: [meter('1', 'ghost', 'opening', 0), meter('2', 'ghost', 'closing', 300)],
    });
    const view = buildShiftReadings(detail, catalog());
    expect(view.groups).toEqual([]);
    expect(view.outsideSetup.map((row) => row.nozzleId)).toEqual(['ghost']);
    expect(view.summary).toMatchObject({ computedMl: 300, mismatch: false });
  });

  it('a currently disabled nozzle that has readings is shown with its block reason, not hidden', () => {
    const detail = shiftDetail('s', 'a', { status: 'closed', operational_meter_milliliters: 10, meter_readings: [meter('1', 'n4', 'opening', 0), meter('2', 'n4', 'closing', 10)] });
    const row = buildShiftReadings(detail, catalog()).groups.flatMap((group) => group.rows)[0];
    expect(row.view?.blockedBy).toBe('nozzle_inactive');
  });
});

describe('deriveProgress', () => {
  const view = (status: 'open' | 'closed' | 'approved', readings: Parameters<typeof shiftDetail>[2] = {}) => {
    const detail = shiftDetail('s', 'a', { status, opened_at: '2026-11-03T05:00:00+00:00', closed_at: status === 'open' ? null : '2026-11-03T13:00:00+00:00', approved_at: status === 'approved' ? '2026-11-03T14:00:00+00:00' : null, ...readings });
    return deriveProgress(detail, buildShiftReadings(detail, catalog()).summary);
  };
  const states = (steps: ReturnType<typeof view>) => steps.map((step) => `${step.key}:${step.state}`);

  it('open, nothing recorded: opening readings are the next step', () => {
    expect(states(view('open'))).toEqual(['opened:done', 'opening_readings:current', 'closing_readings:pending', 'closed:pending', 'approved:pending']);
  });

  it('open, all openings in: closing readings are next, with counts against the expected nozzles', () => {
    const steps = view('open', { meter_readings: ['n1', 'n2', 'n3'].map((id, i) => meter(`o${i}`, id, 'opening', 1)) });
    expect(states(steps)).toEqual(['opened:done', 'opening_readings:done', 'closing_readings:current', 'closed:pending', 'approved:pending']);
    expect(steps[1].count).toEqual({ done: 3, total: 3 });
    expect(steps[2].count).toEqual({ done: 0, total: 3 });
  });

  it('open, everything recorded: closing the shift is next', () => {
    const steps = view('open', { meter_readings: ['n1', 'n2', 'n3'].flatMap((id, i) => [meter(`o${i}`, id, 'opening', 1), meter(`c${i}`, id, 'closing', 2)]) });
    expect(states(steps)).toEqual(['opened:done', 'opening_readings:done', 'closing_readings:done', 'closed:current', 'approved:pending']);
  });

  it('closed: approval is next; there is no invented "returned/submitted" step', () => {
    const steps = view('closed', { meter_readings: [meter('o', 'n1', 'opening', 1), meter('c', 'n1', 'closing', 2)] });
    expect(states(steps)).toEqual(['opened:done', 'opening_readings:done', 'closing_readings:done', 'closed:done', 'approved:current']);
    expect(steps[1].count).toEqual({ done: 1, total: null }); // لا مقام مخترع لوردية سابقة
  });

  it('approved: nothing is "current"; a closed shift with no readings says so instead of pretending', () => {
    const steps = view('approved');
    expect(states(steps)).toEqual(['opened:done', 'opening_readings:none', 'closing_readings:none', 'closed:done', 'approved:done']);
    expect(steps.some((step) => step.state === 'current')).toBe(false);
  });
});

describe('buildTankRows', () => {
  it('pairs opening/closing per tank and keeps the measurement type of each reading', () => {
    const detail = shiftDetail('s', 'a', {
      tank_readings: [tankReading('1', 't1', 'opening', 9_000_000), tankReading('2', 't1', 'closing', 8_000_000, { reading_type: 'atg' }), tankReading('3', 't2', 'opening', 5_000_000)],
    });
    const rows = buildTankRows(detail);
    expect(rows.map((row) => [row.tankId, row.opening?.quantity_milliliters ?? null, row.closing?.quantity_milliliters ?? null])).toEqual([
      ['t1', 9_000_000, 8_000_000],
      ['t2', 5_000_000, null],
    ]);
    expect(rows[0].closing?.reading_type).toBe('atg');
  });
});

describe('formatting helpers', () => {
  it('keeps three fixed decimals with Latin digits in both locales', () => {
    expect(formatLitersFixedFromMl(690_500, 'en')).toBe('690.500');
    expect(formatLitersFixedFromMl(125_430_000, 'ar')).toBe('125,430.000');
    expect(formatLitersFixedFromMl(0, 'ar')).toBe('0.000');
    expect(formatLitersFixedFromMl(Number.NaN, 'en')).toBe('—');
  });

  it('elapsedBetween rejects garbage and negative spans instead of inventing a duration', () => {
    expect(elapsedBetween('2026-11-03T05:00:00Z', '2026-11-03T13:20:00Z')).toEqual({ hours: 8, minutes: 20 });
    expect(elapsedBetween('2026-11-03T05:00:00Z', Date.parse('2026-11-03T05:00:59Z'))).toEqual({ hours: 0, minutes: 0 });
    expect(elapsedBetween('not a date', '2026-11-03T13:20:00Z')).toBeNull();
    expect(elapsedBetween('2026-11-03T13:20:00Z', '2026-11-03T05:00:00Z')).toBeNull();
    expect(elapsedBetween(null, '2026-11-03T05:00:00Z')).toBeNull();
    expect(parseInstant('')).toBeNull();
  });

  it('formats a stamp in the STATION zone (date flips across midnight), tolerates a bad zone, and shows — for a bad instant', () => {
    // 21:30 UTC = 00:30 (+3) في اليوم التالي بتوقيت الرياض.
    expect(formatStampInZone('2026-11-03T21:30:00+00:00', 'en', 'Asia/Riyadh')).toMatch(/4 Nov 2026.*12:30/);
    expect(formatStampInZone('2026-11-03T21:30:00+00:00', 'en', 'UTC')).toMatch(/3 Nov 2026.*9:30/);
    expect(formatStampInZone('2026-11-03T21:30:00+00:00', 'en', 'Not/AZone')).toMatch(/2026/);
    expect(formatStampInZone('garbage', 'en', 'Asia/Riyadh')).toBe('—');
    expect(formatStampInZone(null, 'ar', 'Asia/Riyadh')).toBe('—');
  });
});
