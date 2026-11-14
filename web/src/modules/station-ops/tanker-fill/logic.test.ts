import { describe, expect, it } from 'vitest';
import { buildStationCatalog } from '../catalog';
import { nozzle, product, pump, station, tank } from '../__fixtures__';
import {
  EMPTY_DRAFT, buildIntentPayload, capacityCheck, eligibleNozzleCount, firstInvalidStep, litersFromMl, normalizeDigits, normalizeVoucher, nozzleChoice, parseLiters, pumpChoices, stepProblem, toTankerPolicy,
  type FillDraft, type StepContext,
} from './logic';
import type { Tanker } from './schemas';

const tankerRow = (over: Partial<Tanker> = {}): Tanker => ({ id: 'tk1', fuel_tanker_owner_id: 'o1', plate_number: 'ABJ 1234', capacity_milliliters: 5_000_000, status: 'active', ...over });
const ctx = (over: Partial<StepContext> = {}): StepContext => ({ tankers: [tankerRow()], policy: { selectionRequired: false, overrun: 'allow_with_confirmation' }, eligibleNozzleIds: new Set(['n1']), ...over });
const draft = (over: Partial<FillDraft> = {}): FillDraft => ({ ...EMPTY_DRAFT, ownerId: 'o1', tankerId: 'tk1', nozzleId: 'n1', quantityInput: '2000', voucherInput: '04052', ...over });

describe('parseLiters', () => {
  it.each([
    ['2000', 2_000_000, '2000.000'], ['0.5', 500, '0.500'], ['12.345', 12_345, '12.345'], ['٢٠٠٠', 2_000_000, '2000.000'], ['۱۲٫٥', 12_500, '12.500'], ['007', 7_000, '7.000'], ['  15 ', 15_000, '15.000'], ['0.001', 1, '0.001'],
  ])('reads %s exactly as integer millilitres', (input, ml, liters) => {
    expect(parseLiters(input)).toEqual({ ok: true, milliliters: ml, liters });
  });

  it.each([
    ['', 'empty'], ['   ', 'empty'], ['0', 'zero'], ['0.000', 'zero'], ['-5', 'negative'], ['-0.001', 'negative'], ['abc', 'invalid'], ['1e3', 'invalid'], ['1,500', 'invalid'], ['1٬500', 'invalid'],
    ['1.2.3', 'invalid'], ['.5', 'invalid'], ['5.', 'invalid'], ['1.2345', 'too_many_decimals'], ['99999999', 'too_large'], ['+5', 'invalid'], ['١٢ ٣', 'invalid'],
  ])('rejects %j as %s (never rounds, guesses or accepts a sign)', (input, problem) => {
    expect(parseLiters(input)).toEqual({ ok: false, problem });
  });

  it('never produces a float: results are safe integers', () => {
    for (const input of ['0.1', '0.2', '0.3', '1.001', '999.999']) {
      const parsed = parseLiters(input);
      expect(parsed.ok && Number.isInteger(parsed.milliliters)).toBe(true);
    }
  });
});

describe('normalizeVoucher / normalizeDigits', () => {
  it('keeps leading zeros verbatim (04052 is not 4052) and converts Arabic digits', () => {
    expect(normalizeVoucher('04052')).toEqual({ ok: true, value: '04052' });
    expect(normalizeVoucher('٠٤٠٥٢')).toEqual({ ok: true, value: '04052' });
    expect(normalizeVoucher('۰۰۰۷۷')).toEqual({ ok: true, value: '00077' });
    expect(normalizeVoucher('4052')).not.toEqual(normalizeVoucher('04052'));
  });
  it('collapses inner whitespace and trims; rejects empty and over-long', () => {
    expect(normalizeVoucher('  AB   12  ')).toEqual({ ok: true, value: 'AB 12' });
    expect(normalizeVoucher('   ')).toEqual({ ok: false, problem: 'empty' });
    expect(normalizeVoucher('x'.repeat(65))).toEqual({ ok: false, problem: 'too_long' });
    expect(normalizeVoucher('x'.repeat(64)).ok).toBe(true);
  });
  it('normalizeDigits leaves other characters alone', () => {
    expect(normalizeDigits('ص٠١-A')).toBe('ص01-A');
  });
  it('litersFromMl pads to three decimals', () => {
    expect(litersFromMl(1_005)).toBe('1.005');
    expect(litersFromMl(2_000_000)).toBe('2000.000');
  });
});

describe('capacityCheck', () => {
  it('no check without a tanker or a known capacity', () => {
    expect(capacityCheck(9_000_000, null, 'block').mode).toBe('none');
    expect(capacityCheck(9_000_000, undefined, 'block').mode).toBe('none');
    expect(capacityCheck(9_000_000, 0, 'block').mode).toBe('none');
    expect(capacityCheck(null, 5_000_000, 'block').mode).toBe('none');
  });
  it('within capacity (equal included) never asks for anything', () => {
    expect(capacityCheck(5_000_000, 5_000_000, 'allow_with_confirmation')).toEqual({ mode: 'none', overrunMilliliters: 0 });
  });
  it('exceeding capacity follows the policy; unknown policy is treated as needing confirmation', () => {
    expect(capacityCheck(6_000_000, 5_000_000, 'allow_with_confirmation')).toEqual({ mode: 'confirm', overrunMilliliters: 1_000_000 });
    expect(capacityCheck(6_000_000, 5_000_000, 'block').mode).toBe('block');
    expect(capacityCheck(6_000_000, 5_000_000, 'allow').mode).toBe('allow');
    expect(capacityCheck(6_000_000, 5_000_000, null).mode).toBe('confirm');
  });
});

describe('toTankerPolicy', () => {
  it('reads known values and treats everything else as unknown (no guessing)', () => {
    expect(toTankerPolicy({ tanker_selection_required: true, tanker_capacity_overrun_policy: 'block' })).toEqual({ selectionRequired: true, overrun: 'block' });
    expect(toTankerPolicy({ tanker_capacity_overrun_policy: 'supervisor_approval' })).toEqual({ selectionRequired: null, overrun: null });
    expect(toTankerPolicy(null)).toEqual({ selectionRequired: null, overrun: null });
  });
});

describe('nozzle eligibility', () => {
  const st = station('s1');
  const build = (nozzleOver: Record<string, unknown> = {}, tankStatus = 'active') => buildStationCatalog({
    station: st, products: [product('p1', 'Diesel')], pumps: [pump('pu1', 's1')], tanks: [tank('tk1', 's1', 'p1', { status: tankStatus })],
    nozzles: [nozzle('n1', 's1', 'pu1', 'tk1', 'p1', nozzleOver as never)],
  });

  it('null / absent operations = all operations (eligible); the server still decides', () => {
    expect(pumpChoices(build({ allowed_operations: null }))[0].nozzles[0].eligible).toBe(true);
    expect(pumpChoices(build({}))[0].nozzles[0].eligible).toBe(true);
  });
  it('a stored restriction without tanker_fill is ineligible with a reason, and effective_operations wins', () => {
    const restricted = pumpChoices(build({ allowed_operations: ['direct_sale'] }))[0].nozzles[0];
    expect(restricted).toMatchObject({ eligible: false, reason: 'operation_not_allowed' });
    expect(pumpChoices(build({ allowed_operations: ['direct_sale'], effective_operations: ['direct_sale', 'tanker_fill'] }))[0].nozzles[0].eligible).toBe(true);
    expect(pumpChoices(build({ allowed_operations: null, effective_operations: ['internal_issue'] }))[0].nozzles[0].eligible).toBe(false);
  });
  it('an inactive nozzle or tank is ineligible with the catalog reason', () => {
    expect(nozzleChoice(pumpChoices(build({ status: 'inactive' }))[0].nozzles[0].view)).toMatchObject({ eligible: false, reason: 'nozzle_inactive' });
    expect(pumpChoices(build({}, 'inactive'))[0].nozzles[0]).toMatchObject({ eligible: false, reason: 'tank_inactive' });
  });
  it('counts only eligible nozzles', () => {
    expect(eligibleNozzleCount(pumpChoices(build({ allowed_operations: ['direct_sale'] })))).toBe(0);
    expect(eligibleNozzleCount(pumpChoices(build({})))).toBe(1);
  });
});

describe('stepProblem', () => {
  it('owner step: owner required; tanker required only when policy says so AND the owner has active tankers', () => {
    expect(stepProblem('owner', draft({ ownerId: null }), ctx())).toBe('owner_required');
    expect(stepProblem('owner', draft({ tankerId: null }), ctx())).toBeNull();
    expect(stepProblem('owner', draft({ tankerId: null }), ctx({ policy: { selectionRequired: true, overrun: null } }))).toBe('tanker_required');
    // صاحب بلا صهاريج نشطة لا يُمنع أبداً حتى مع «إلزامي».
    expect(stepProblem('owner', draft({ tankerId: null }), ctx({ tankers: [], policy: { selectionRequired: true, overrun: null } }))).toBeNull();
    expect(stepProblem('owner', draft({ tankerId: null }), ctx({ policy: { selectionRequired: null, overrun: null } }))).toBeNull();
  });
  it('nozzle step needs an eligible nozzle', () => {
    expect(stepProblem('nozzle', draft({ nozzleId: null }), ctx())).toBe('nozzle_required');
    expect(stepProblem('nozzle', draft({ nozzleId: 'n9' }), ctx())).toBe('nozzle_not_eligible');
    expect(stepProblem('nozzle', draft(), ctx())).toBeNull();
  });
  it('quantity step: blocks empty/zero/negative quantity, empty voucher, blocked and unconfirmed overrun', () => {
    expect(stepProblem('quantity', draft({ quantityInput: '' }), ctx())).toBe('quantity_empty');
    expect(stepProblem('quantity', draft({ quantityInput: '0' }), ctx())).toBe('quantity_zero');
    expect(stepProblem('quantity', draft({ quantityInput: '-3' }), ctx())).toBe('quantity_negative');
    expect(stepProblem('quantity', draft({ voucherInput: '  ' }), ctx())).toBe('voucher_empty');
    expect(stepProblem('quantity', draft({ quantityInput: '6000' }), ctx())).toBe('capacity_confirmation_required');
    expect(stepProblem('quantity', draft({ quantityInput: '6000', confirmOverrun: true }), ctx())).toBeNull();
    expect(stepProblem('quantity', draft({ quantityInput: '6000', confirmOverrun: true }), ctx({ policy: { selectionRequired: false, overrun: 'block' } }))).toBe('capacity_blocked');
    expect(stepProblem('quantity', draft({ quantityInput: '6000' }), ctx({ policy: { selectionRequired: false, overrun: 'allow' } }))).toBeNull();
  });
  it('firstInvalidStep points at the earliest broken step', () => {
    expect(firstInvalidStep(draft(), ctx())).toBeNull();
    expect(firstInvalidStep(draft({ quantityInput: '0' }), ctx())).toBe('quantity');
    expect(firstInvalidStep(draft({ nozzleId: null, quantityInput: '0' }), ctx())).toBe('nozzle');
  });
});

describe('buildIntentPayload', () => {
  const base = { stationId: 's1', shiftId: 'sh1', draft: draft(), tankers: [tankerRow()], policy: { selectionRequired: false, overrun: 'allow_with_confirmation' as const } };

  it('sends only server-accepted fields: no tenant, branch, product, tank, pump, price or client clock', () => {
    const payload = buildIntentPayload(base)!;
    expect(Object.keys(payload).sort()).toEqual(['fuel_nozzle_id', 'fuel_shift_id', 'fuel_station_id', 'fuel_tanker_id', 'fuel_tanker_owner_id', 'quantity_milliliters', 'voucher_number']);
    expect(payload).toMatchObject({ quantity_milliliters: 2_000_000, voucher_number: '04052', fuel_shift_id: 'sh1', fuel_station_id: 's1' });
    expect(JSON.stringify(payload)).not.toMatch(/tenant|branch|product|tank_id|pump|price|recorded_at|measured_at/);
  });
  it('omits the tanker when none is selected and never sends a quantity_liters string', () => {
    const payload = buildIntentPayload({ ...base, draft: draft({ tankerId: null }) })!;
    expect('fuel_tanker_id' in payload).toBe(false);
    expect('quantity_liters' in payload).toBe(false);
  });
  it('sends confirm_capacity_overrun only when confirmation is needed AND given', () => {
    const over = { ...base, draft: draft({ quantityInput: '6000' }) };
    expect('confirm_capacity_overrun' in buildIntentPayload(over)!).toBe(false);
    expect(buildIntentPayload({ ...over, draft: draft({ quantityInput: '6000', confirmOverrun: true }) })!.confirm_capacity_overrun).toBe(true);
    // تأكيد قديم لكمية لم تعد تتجاوز: لا يُرسل.
    expect('confirm_capacity_overrun' in buildIntentPayload({ ...base, draft: draft({ quantityInput: '10', confirmOverrun: true }) })!).toBe(false);
  });
  it('is null while the draft is incomplete or invalid', () => {
    expect(buildIntentPayload({ ...base, draft: draft({ ownerId: null }) })).toBeNull();
    expect(buildIntentPayload({ ...base, draft: draft({ quantityInput: '0' }) })).toBeNull();
    expect(buildIntentPayload({ ...base, draft: draft({ voucherInput: '' }) })).toBeNull();
  });
  it('is stable for the same intent and changes with any field (new intent = new key)', () => {
    const a = JSON.stringify(buildIntentPayload(base));
    expect(JSON.stringify(buildIntentPayload(base))).toBe(a);
    expect(JSON.stringify(buildIntentPayload({ ...base, draft: draft({ voucherInput: '04053' }) }))).not.toBe(a);
    expect(JSON.stringify(buildIntentPayload({ ...base, draft: draft({ quantityInput: '2000.001' }) }))).not.toBe(a);
  });
});
