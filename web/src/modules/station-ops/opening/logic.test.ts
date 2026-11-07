import { describe, expect, it } from 'vitest';
import {
  EMPTY_FORM, accountSource, bodyFingerprint, buildDraftBody, costState, draftMatchesBody, eligibleAccounts, evaluateCosts, evaluateTanks, formFromDraft, isValidDate, planAccount,
  productTotals, quantityState, todayLocal, type TankInfo,
} from './logic';
import type { OpeningAccount, OpeningDoc } from './schemas';

/** كميات المرجع من المهمة (اختبارات فقط — لا تُحفظ ولا تُعبَّأ تلقائياً في أي بيئة). */
const CAP = 34_000_000;
const tank = (id: string, productId: string, over: Partial<TankInfo> = {}): TankInfo => ({ id, name: `T-${id}`, productId, capacityMl: CAP, active: true, ...over });
const T91 = tank('t91', 'p91');
const T95 = tank('t95', 'p95');
const TD = tank('td', 'pd');

describe('quantityState', () => {
  it('treats blank as no line (never zero)', () => expect(quantityState(T91, '   ')).toEqual({ kind: 'empty' }));
  it('accepts the reference quantities as exact milliliters', () => {
    expect(quantityState(T91, '30000')).toEqual({ kind: 'ok', ml: 30_000_000 });
    expect(quantityState(T95, '15555')).toEqual({ kind: 'ok', ml: 15_555_000 });
    expect(quantityState(TD, '31000')).toEqual({ kind: 'ok', ml: 31_000_000 });
  });
  it('accepts up to 3 decimals and Arabic-Indic digits', () => {
    expect(quantityState(T91, '0.001')).toEqual({ kind: 'ok', ml: 1 });
    expect(quantityState(T91, '١٥٥٥٥٫٥')).toEqual({ kind: 'ok', ml: 15_555_500 });
  });
  it('rejects 4 decimals, negatives, text and ambiguous separators', () => {
    for (const raw of ['1.2345', '-5', 'abc', '1,500', '1e3']) expect(quantityState(T91, raw), raw).toEqual({ kind: 'issue', issue: 'invalid' });
  });
  it('rejects zero with its own message (an empty tank is left blank)', () => expect(quantityState(T91, '0')).toEqual({ kind: 'issue', issue: 'zero' }));
  it('rejects above capacity but accepts exactly the capacity', () => {
    expect(quantityState(T91, '34000.001')).toEqual({ kind: 'issue', issue: 'exceeds_capacity' });
    expect(quantityState(T91, '34000')).toEqual({ kind: 'ok', ml: CAP });
  });
  it('rejects a quantity on an inactive tank', () => expect(quantityState(tank('x', 'p', { active: false }), '5')).toEqual({ kind: 'issue', issue: 'tank_inactive' }));
  it('does not enforce capacity when the capacity is unknown (server decides)', () => expect(quantityState(tank('x', 'p', { capacityMl: 0 }), '99999')).toEqual({ kind: 'ok', ml: 99_999_000 }));
});

describe('evaluateTanks', () => {
  it('needs at least one line and no issue', () => {
    expect(evaluateTanks([T91, T95], { quantities: {} }).canContinue).toBe(false);
    expect(evaluateTanks([T91, T95], { quantities: { t91: '10' } }).canContinue).toBe(true);
    expect(evaluateTanks([T91, T95], { quantities: { t91: '10', t95: 'x' } }).canContinue).toBe(false);
  });
  it('sums the reference station and supports several tanks of one product', () => {
    const second91 = tank('t91b', 'p91');
    const evaluation = evaluateTanks([T91, second91, T95, TD], { quantities: { t91: '20000', t91b: '10000', t95: '15555', td: '31000' } });
    expect(evaluation.totalMl).toBe(76_555_000);
    const totals = productTotals(evaluation.lines);
    expect(totals.find((p) => p.productId === 'p91')).toEqual({ productId: 'p91', ml: 30_000_000, tankCount: 2 });
    expect(totals).toHaveLength(3);
  });
});

describe('costState', () => {
  it('converts riyals to whole halalas', () => {
    expect(costState('2.18', false)).toEqual({ kind: 'ok', minor: 218 });
    expect(costState('2,5', false)).toEqual({ kind: 'ok', minor: 250 });
    expect(costState('٢٫٣٣', false)).toEqual({ kind: 'ok', minor: 233 });
  });
  it('rejects sub-halala precision instead of rounding silently', () => expect(costState('2.185', false)).toEqual({ kind: 'issue', issue: 'invalid' }));
  it('rejects negatives and text; blank is empty not zero', () => {
    expect(costState('-1', false)).toEqual({ kind: 'issue', issue: 'invalid' });
    expect(costState('abc', false)).toEqual({ kind: 'issue', issue: 'invalid' });
    expect(costState('', false)).toEqual({ kind: 'empty' });
  });
  it('zero needs the explicit zero-cost approval', () => {
    expect(costState('0', false)).toEqual({ kind: 'issue', issue: 'zero_needs_approval' });
    expect(costState('0', true)).toEqual({ kind: 'ok', minor: 0 });
  });
});

describe('evaluateCosts', () => {
  const products = [{ productId: 'p91', ml: 1, tankCount: 1 }, { productId: 'p95', ml: 1, tankCount: 1 }];
  it('is incomplete until every product has a valid cost (when the user can record costs)', () => {
    expect(evaluateCosts(products, { costs: { p91: '2.18' }, allowZeroCost: false }, true).complete).toBe(false);
    expect(evaluateCosts(products, { costs: { p91: '2.18', p95: '2.33' }, allowZeroCost: false }, true).complete).toBe(true);
  });
  it('does not demand costs from a user without cost authority', () => expect(evaluateCosts(products, { costs: {}, allowZeroCost: false }, false).complete).toBe(true));
  it('still flags a typed-invalid cost for a user without authority', () => expect(evaluateCosts(products, { costs: { p91: 'x' }, allowZeroCost: false }, false).complete).toBe(false));
});

describe('accounts', () => {
  const account = (over: Partial<OpeningAccount>): OpeningAccount => ({ id: 'a', code: '3130', name: 'Opening', type: 'equity', is_group: false, is_active: true, ...over });
  it('lists only active, non-group equity accounts, sorted by code', () => {
    const rows = [account({ id: '1', code: '3200' }), account({ id: '2', code: '1140', type: 'asset' }), account({ id: '3', code: '3130' }), account({ id: '4', code: '3000', is_group: true }), account({ id: '5', code: '3300', is_active: false })];
    expect(eligibleAccounts(rows).map((a) => a.id)).toEqual(['3', '1']);
  });
  it('derives the source of the configured account', () => {
    expect(accountSource(null, 'x')).toBe('none');
    expect(accountSource('x', 'x')).toBe('org');
    expect(accountSource('y', 'x')).toBe('station');
  });
  it('plans a write only when the chosen account differs from the configured one', () => {
    expect(planAccount({ accountId: null, accountScope: 'station' }, 'a', 'org')).toEqual({ accountId: 'a', needsWrite: false, scope: 'station' });
    expect(planAccount({ accountId: 'b', accountScope: 'station' }, 'a', 'org')).toEqual({ accountId: 'b', needsWrite: true, scope: 'station' });
    expect(planAccount({ accountId: 'b', accountScope: 'org' }, 'a', 'org').scope).toBe('org');
  });
  it('never writes the organization default over a station-specific override', () => {
    expect(planAccount({ accountId: 'b', accountScope: 'org' }, 'a', 'station').scope).toBe('station');
  });
  it('does not invent an account when none is configured or chosen', () => expect(planAccount({ accountId: null, accountScope: 'station' }, null, 'none')).toEqual({ accountId: null, needsWrite: false, scope: 'station' }));
});

describe('draft body', () => {
  const evaluation = evaluateTanks([T91, T95], { quantities: { t91: '30000', t95: '15555' } });
  const products = productTotals(evaluation.lines);
  const costs = evaluateCosts(products, { costs: { p91: '2.18', p95: '2.33' }, allowZeroCost: false }, true);

  it('sends canonical liters text and integer halalas', () => {
    const body = buildDraftBody({ date: '2026-11-01', notes: '', allowZeroCost: false, lines: evaluation.lines, costs, canRecordCost: true, products });
    expect(body).toEqual({
      opening_date: '2026-11-01',
      lines: [{ fuel_tank_id: 't91', quantity_liters: '30000' }, { fuel_tank_id: 't95', quantity_liters: '15555' }],
      costs: [{ fuel_product_id: 'p91', unit_cost_per_liter_minor: 218 }, { fuel_product_id: 'p95', unit_cost_per_liter_minor: 233 }],
    });
  });
  it('omits costs entirely without cost authority (server keeps any existing cost)', () => {
    const body = buildDraftBody({ date: '2026-11-01', notes: '  ', allowZeroCost: false, lines: evaluation.lines, costs, canRecordCost: false, products });
    expect('costs' in body).toBe(false);
    expect('notes' in body).toBe(false);
  });
  it('includes notes and the zero-cost approval only when set', () => {
    const body = buildDraftBody({ date: '2026-11-01', notes: ' hi ', allowZeroCost: true, lines: evaluation.lines, costs, canRecordCost: true, products });
    expect(body.notes).toBe('hi');
    expect(body.allow_zero_cost).toBe(true);
  });
  it('fingerprints change with any field', () => {
    const base = buildDraftBody({ date: '2026-11-01', notes: '', allowZeroCost: false, lines: evaluation.lines, costs, canRecordCost: true, products });
    expect(bodyFingerprint('s', base)).toBe(bodyFingerprint('s', structuredClone(base)));
    expect(bodyFingerprint('s', base)).not.toBe(bodyFingerprint('s2', base));
    expect(bodyFingerprint('s', base)).not.toBe(bodyFingerprint('s', { ...base, opening_date: '2026-11-02' }));
  });
});

describe('resume + status check', () => {
  const doc: OpeningDoc = {
    id: 'd', number: 'FOB-1', status: 'draft', station_id: 's', opening_date: '2026-11-01', notes: 'n', allow_zero_cost: false, total_milliliters: 45_555_000,
    lines: [
      { id: 'l1', tank_id: 't91', fuel_product_id: 'p91', quantity_milliliters: 30_000_000, quantity_liters: '30000', unit_cost_per_liter_minor: 218, value_minor: 6_540_000 },
      { id: 'l2', tank_id: 't95', fuel_product_id: 'p95', quantity_milliliters: 15_555_000, quantity_liters: '15555', unit_cost_per_liter_minor: 233, value_minor: 3_624_315 },
    ],
  };
  it('prefills quantities, costs, date and notes from the draft', () => {
    const form = formFromDraft(doc);
    expect(form.quantities).toEqual({ t91: '30000', t95: '15555' });
    expect(form.costs).toEqual({ p91: '2.18', p95: '2.33' });
    expect(form.date).toBe('2026-11-01');
    expect(form.notes).toBe('n');
    expect(form.accountId).toBeNull();
  });
  it('does not invent costs a viewer without cost access never received', () => {
    const hidden = { ...doc, lines: doc.lines!.map(({ unit_cost_per_liter_minor, value_minor, ...rest }) => { void unit_cost_per_liter_minor; void value_minor; return rest; }) } as OpeningDoc;
    expect(formFromDraft(hidden).costs).toEqual({});
  });
  const body = { opening_date: '2026-11-01', lines: [{ fuel_tank_id: 't91', quantity_liters: '30000' }, { fuel_tank_id: 't95', quantity_liters: '15555' }], costs: [{ fuel_product_id: 'p91', unit_cost_per_liter_minor: 218 }] };
  it('recognises a draft that matches what was sent', () => expect(draftMatchesBody(doc, body)).toBe(true));
  it('rejects a different quantity, tank set, date or cost', () => {
    expect(draftMatchesBody(doc, { ...body, lines: [{ fuel_tank_id: 't91', quantity_liters: '30001' }, body.lines[1]] })).toBe(false);
    expect(draftMatchesBody(doc, { ...body, lines: [body.lines[0]] })).toBe(false);
    expect(draftMatchesBody(doc, { ...body, opening_date: '2026-11-02' })).toBe(false);
    expect(draftMatchesBody(doc, { ...body, costs: [{ fuel_product_id: 'p91', unit_cost_per_liter_minor: 219 }] })).toBe(false);
  });
});

describe('dates', () => {
  it('validates real calendar dates only', () => {
    expect(isValidDate('2026-11-07')).toBe(true);
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('07/11/2026')).toBe(false);
    expect(isValidDate('')).toBe(false);
  });
  it('formats the local day with ASCII digits', () => expect(todayLocal(new Date(2026, 10, 7, 23, 59))).toBe('2026-11-07'));
  it('the empty form carries no defaults for quantity, cost or account', () => {
    expect(EMPTY_FORM.quantities).toEqual({});
    expect(EMPTY_FORM.costs).toEqual({});
    expect(EMPTY_FORM.accountId).toBeNull();
  });
});
