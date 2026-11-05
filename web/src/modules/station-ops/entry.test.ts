import { describe, expect, it } from 'vitest';
import { buildStationCatalog } from './catalog';
import { closeBlockers, evaluateMeterRow, evaluateTankRow, meterSaveItem, parseLiters, previousClosingMap, readingsCoverage, requiredNozzles, tankSaveItem } from './entry';
import { meter, nozzle, product, pump, shiftDetail, station, tank, tankReading } from './__fixtures__';
import { STRICT_POLICY, toShiftPolicy, type ShiftPolicy } from './policy';

const catalog = buildStationCatalog({
  station: station('a'),
  products: [product('p1', 'Alpha')],
  pumps: [pump('pump1', 'a'), pump('pump2', 'a', { status: 'inactive' })],
  tanks: [tank('t1', 'a', 'p1'), tank('t2', 'a', 'p1', { status: 'inactive' })],
  nozzles: [nozzle('n1', 'a', 'pump1', 't1', 'p1'), nozzle('n2', 'a', 'pump1', 't1', 'p1'), nozzle('n3', 'a', 'pump2', 't1', 'p1')],
});
const known: ShiftPolicy = { ...STRICT_POLICY, known: true, staffMandatory: false, allowCloseWithCashVariance: true };

describe('parseLiters', () => {
  it('turns user liters into integer mL and never invents zero from an empty field', () => {
    expect(parseLiters('125430.5')).toEqual({ ok: true, ml: 125_430_500 });
    expect(parseLiters('0')).toEqual({ ok: true, ml: 0 });
    expect(parseLiters('٦٩٠٫٥')).toEqual({ ok: true, ml: 690_500 }); // أرقام عربية
    expect(parseLiters('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseLiters('   ')).toEqual({ ok: false, reason: 'empty' });
  });
  it('rejects negatives, ambiguous separators, >3 decimals and non-numbers', () => {
    for (const bad of ['-1', '1,500', '1.2345', 'abc', '1e3', '12 34x']) expect(parseLiters(bad), bad).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('evaluateMeterRow', () => {
  const opening = meter('o', 'n1', 'opening', 100_000);
  it('a saved reading is final (the server has no edit)', () => {
    expect(evaluateMeterRow({ stage: 'opening', raw: '999', saved: opening, opening: null, previousClosingMl: null })).toEqual({ kind: 'saved', ml: 100_000 });
  });
  it('HARD-BLOCKS a closing reading below the opening one (it would make the shift impossible to close)', () => {
    expect(evaluateMeterRow({ stage: 'closing', raw: '99.999', saved: null, opening, previousClosingMl: null })).toEqual({ kind: 'invalid', issue: 'closing_below_opening' });
    expect(evaluateMeterRow({ stage: 'closing', raw: '100', saved: null, opening, previousClosingMl: null })).toMatchObject({ kind: 'ready', deltaMl: 0, warnings: ['zero_delta'] });
    expect(evaluateMeterRow({ stage: 'closing', raw: '150.5', saved: null, opening, previousClosingMl: null })).toEqual({ kind: 'ready', ml: 150_500, deltaMl: 50_500, warnings: [] });
  });
  it('a closing reading needs the opening one first', () => {
    expect(evaluateMeterRow({ stage: 'closing', raw: '5', saved: null, opening: null, previousClosingMl: null })).toEqual({ kind: 'blocked', issue: 'needs_opening' });
  });
  it('with a KNOWN policy that makes opening readings optional, an unpaired ending reading is allowed (no invented delta, no ordering check)', () => {
    const base = { stage: 'closing' as const, saved: null, opening: null, previousClosingMl: null };
    expect(evaluateMeterRow({ ...base, raw: '5', openingRequired: false })).toEqual({ kind: 'ready', ml: 5000, deltaMl: null, warnings: [] });
    expect(evaluateMeterRow({ ...base, raw: '5', openingRequired: true })).toEqual({ kind: 'blocked', issue: 'needs_opening' });
    expect(evaluateMeterRow({ ...base, raw: '5' })).toEqual({ kind: 'blocked', issue: 'needs_opening' }); // غير معلومة ⇒ صارمة
    expect(evaluateMeterRow({ ...base, raw: '', openingRequired: false })).toEqual({ kind: 'empty' });
  });
    it('an opening reading above an ALREADY-SAVED ending reading is hard-blocked (the server would accept it, then refuse to close the shift)', () => {
    const closing = meter('c', 'n1', 'closing', 100_000);
    const base = { stage: 'opening' as const, saved: null, opening: null, previousClosingMl: null, closing };
    expect(evaluateMeterRow({ ...base, raw: '100.001', openingRequired: false })).toEqual({ kind: 'invalid', issue: 'opening_above_closing' });
    expect(evaluateMeterRow({ ...base, raw: '100', openingRequired: false })).toMatchObject({ kind: 'ready', ml: 100_000 });
    expect(evaluateMeterRow({ ...base, raw: '50' })).toMatchObject({ kind: 'ready', ml: 50_000 });
  });
    it('opening vs the previous closing is a WARNING only (rollover/reset has no server policy)', () => {
    const base = { stage: 'opening' as const, saved: null, opening: null };
    expect(evaluateMeterRow({ ...base, raw: '10', previousClosingMl: 10_000 })).toEqual({ kind: 'ready', ml: 10_000, deltaMl: null, warnings: [] });
    expect(evaluateMeterRow({ ...base, raw: '9', previousClosingMl: 10_000 })).toMatchObject({ kind: 'ready', warnings: ['below_previous_closing'] });
    expect(evaluateMeterRow({ ...base, raw: '11', previousClosingMl: 10_000 })).toMatchObject({ kind: 'ready', warnings: ['differs_from_previous_closing'] });
    expect(evaluateMeterRow({ ...base, raw: '11', previousClosingMl: null })).toMatchObject({ kind: 'ready', warnings: [] });
  });
  it('empty and invalid input are distinct', () => {
    expect(evaluateMeterRow({ stage: 'opening', raw: '', saved: null, opening: null, previousClosingMl: null })).toEqual({ kind: 'empty' });
    expect(evaluateMeterRow({ stage: 'opening', raw: 'x', saved: null, opening: null, previousClosingMl: null })).toEqual({ kind: 'invalid', issue: 'invalid_number' });
  });
});

describe('evaluateTankRow', () => {
  it('has no ordering rule (deliveries can raise a tank) but needs a real number', () => {
    expect(evaluateTankRow('21480.5', null)).toEqual({ kind: 'ready', ml: 21_480_500, deltaMl: null, warnings: [] });
    expect(evaluateTankRow('', null)).toEqual({ kind: 'empty' });
    expect(evaluateTankRow('-2', null)).toEqual({ kind: 'invalid', issue: 'invalid_number' });
    expect(evaluateTankRow('1', tankReading('x', 't1', 'opening', 5))).toEqual({ kind: 'saved', ml: 5 });
  });
});

describe('save items', () => {
  it('build deterministic evidence keys and integer mL bodies', () => {
    const a = meterSaveItem('s1', 'opening', 'n1', 125_430_000);
    expect(a.body).toEqual({ fuel_nozzle_id: 'n1', reading_stage: 'opening', meter_milliliters: 125_430_000, evidence_key: 'awj-ops:m:s1:n1:opening' });
    expect(meterSaveItem('s1', 'opening', 'n1', 125_430_000)).toEqual(a);
    expect(meterSaveItem('s1', 'closing', 'n1', 1).body.evidence_key).not.toBe(a.body.evidence_key);
  });
  it('a closing tank reading inherits the opening type (the server fails the close on a mismatch)', () => {
    expect(tankSaveItem('s1', 'opening', 't1', 5, null).body).toMatchObject({ reading_type: 'physical', evidence_key: 'awj-ops:t:s1:t1:opening' });
    expect(tankSaveItem('s1', 'closing', 't1', 5, 'atg').body).toMatchObject({ reading_type: 'atg' });
    expect(tankSaveItem('s1', 'closing', 't1', 5, 'physical').body).toMatchObject({ reading_type: 'physical' });
    expect(tankSaveItem('s1', 'opening', 't1', 5, 'atg').body).toMatchObject({ reading_type: 'atg' }); // البداية ترث نوع نهاية محفوظة
  });
});

describe('required assets follow the SERVER rule (status=active), not the stricter display rule', () => {
  it('includes an active nozzle on an inactive pump (the server still demands its reading)', () => {
    expect(requiredNozzles(catalog).map((v) => v.nozzle.id).sort()).toEqual(['n1', 'n2', 'n3']);
  });
  it('coverage counts active nozzles/tanks only', () => {
    const detail = shiftDetail('s1', 'a', {
      meter_readings: [meter('1', 'n1', 'opening', 10), meter('2', 'n2', 'opening', 10), meter('3', 'n1', 'closing', 5)],
      tank_readings: [tankReading('4', 't1', 'opening', 100)],
    });
    expect(readingsCoverage(detail, catalog)).toEqual({
      meterOpening: { done: 2, total: 3 }, meterClosing: { done: 1, total: 3 }, tankOpening: { done: 1, total: 1 }, tankClosing: { done: 0, total: 1 }, invalidOrder: 1,
    });
  });
});

describe('closeBlockers', () => {
  const full = shiftDetail('s1', 'a', {
    meter_readings: ['n1', 'n2', 'n3'].flatMap((id, i) => [meter(`o${i}`, id, 'opening', 100), meter(`c${i}`, id, 'closing', 200)]),
    tank_readings: [tankReading('to', 't1', 'opening', 500), tankReading('tc', 't1', 'closing', 400)],
  });
  it('is clear when everything required is recorded', () => {
    expect(closeBlockers(full, catalog, known)).toEqual({ blockers: [], hardBlock: false });
  });
  it('lists exactly what the policy requires and is missing', () => {
    const partial = { ...full, tank_readings: [], meter_readings: full.meter_readings.filter((r) => !(r.reading_stage === 'closing' && r.nozzle_id === 'n3')) };
    const { blockers, hardBlock } = closeBlockers(partial, catalog, known);
    expect(blockers).toEqual([{ kind: 'meter_closing', remaining: 1 }, { kind: 'tank_opening', remaining: 1 }, { kind: 'tank_closing', remaining: 1 }]);
    expect(hardBlock).toBe(true);
  });
  it('does not require what the policy does not require', () => {
    const lax = { ...known, openingTankRequired: false, closingTankRequired: false };
    expect(closeBlockers({ ...full, tank_readings: [] }, catalog, lax).blockers).toEqual([]);
  });
  it('with an UNKNOWN policy it still shows the gaps but does not hard-block on a guess', () => {
    const { blockers, hardBlock } = closeBlockers({ ...full, tank_readings: [] }, catalog, STRICT_POLICY);
    expect(blockers.length).toBe(2);
    expect(hardBlock).toBe(false);
  });
  it('a closing<opening pair always hard-blocks (the server refuses to close)', () => {
    const bad = { ...full, meter_readings: full.meter_readings.map((r) => (r.id === 'c0' ? { ...r, meter_milliliters: 1 } : r)) };
    const result = closeBlockers(bad, catalog, STRICT_POLICY);
    expect(result.blockers).toContainEqual({ kind: 'invalid_order', remaining: 1 });
    expect(result.hardBlock).toBe(true);
  });
  it('flags a tank type mismatch between opening and closing', () => {
    const mismatch = { ...full, tank_readings: [tankReading('to', 't1', 'opening', 500), tankReading('tc', 't1', 'closing', 400, { reading_type: 'atg' })] };
    expect(closeBlockers(mismatch, catalog, known).blockers).toContainEqual({ kind: 'tank_type_mismatch', remaining: 1 });
  });
});

describe('previousClosingMap / policy', () => {
  it('keeps closing readings only', () => {
    const d = shiftDetail('p', 'a', { meter_readings: [meter('1', 'n1', 'opening', 1), meter('2', 'n1', 'closing', 9)] });
    expect(previousClosingMap(d)).toEqual({ n1: 9 });
    expect(previousClosingMap(null)).toEqual({});
  });
  it('toShiftPolicy reads server flags and marks an incomplete answer as not known', () => {
    expect(toShiftPolicy({ shift_opening_cash_float_required: false, shift_opening_meter_reading_required: true, shift_closing_meter_reading_required: true, shift_opening_tank_reading_required: false, shift_closing_tank_reading_required: false, shift_mandatory_staff_assignment: false })).toMatchObject({ known: true, openingFloatRequired: false, openingTankRequired: false, staffMandatory: false });
    expect(toShiftPolicy({}).known).toBe(false);
    expect(toShiftPolicy({}).openingFloatRequired).toBe(true);
  });
});
