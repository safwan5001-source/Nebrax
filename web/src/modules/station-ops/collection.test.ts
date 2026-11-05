import { describe, expect, it } from 'vitest';
import {
  closeGate, collectionResponse, directionOf, intentPayload, isDirty, parseInputs, previewDifference, previewDrawer, savedMatches, seedInputs,
  type CollectionView,
} from './collection';

const method = (id: string, type: 'cash' | 'bank', saved: number | null = null) => ({ id, name: `M-${id}`, name_en: null, settlement_type: type, saved_amount_minor: saved });

function view(over: Partial<CollectionView> = {}): CollectionView {
  return {
    enabled: true, state: 'none', revision: 0,
    methods: [method('m-cash', 'cash'), method('m-bank', 'bank')],
    methods_changed: false, declaration: null,
    close_readiness: { ready: false, blockers: ['required'], reason_required: false },
    review: { visible: false },
    sales: { visible: true, complete: true, milliliters: 100_000, milliliters_complete: true, amount_minor: 23_000, tax_mode: 'tax_inclusive', evaluated_at: null, products: [], nozzles: [], gaps: [] },
    reconciliation: { visible: true, final: false, reason: 'not_declared', collected_total_minor: null, difference_minor: null, direction: null },
    drawer: { frozen: false, opening_float_minor: 20_000, counted_cash_minor: null, treasury_handover_minor: 10_000, cash_in_minor: 500, cash_out_minor: 10_000, expenses_minor: 0, implied_sales_cash: { visible: true, amount_minor: null, declared_difference_minor: null } },
    disclaimers: ['operational_not_financial_proof', 'credit_sales_excluded', 'unrecorded_settlements_excluded'],
    ...over,
  };
}

describe('parseInputs', () => {
  const methods = view().methods;

  it('turns each method amount into integer halalas keyed by payment method id (never by name)', () => {
    const parsed = parseInputs(methods, { 'm-cash': '200.50', 'm-bank': '29.5' });
    expect(parsed.lines).toEqual([{ payment_method_id: 'm-cash', amount_minor: 20_050 }, { payment_method_id: 'm-bank', amount_minor: 2_950 }]);
    expect(parsed.total).toBe(23_000);
    expect(parsed.cashTotal).toBe(20_050);
  });

  it('empty is NOT zero: every enabled method needs an explicit amount before saving', () => {
    const parsed = parseInputs(methods, { 'm-cash': '10' });
    expect(parsed.lines).toBeNull();
    expect(parsed.total).toBeNull();
    expect(parsed.issues).toEqual({ 'm-bank': 'empty' });
    expect(parseInputs(methods, { 'm-cash': '0', 'm-bank': '0' }).total).toBe(0);
  });

  it('rejects malformed and negative amounts', () => {
    expect(parseInputs(methods, { 'm-cash': '1.2.3', 'm-bank': '-3' }).issues).toEqual({ 'm-cash': 'invalid', 'm-bank': 'invalid' });
    expect(parseInputs(methods, { 'm-cash': 'abc', 'm-bank': '1' }).lines).toBeNull();
  });

  it('accepts Arabic-Indic digits (same halalas) and ignores inputs for methods that are no longer enabled', () => {
    const parsed = parseInputs([methods[0]], { 'm-cash': '١٢٣', 'gone': '999' });
    expect(parsed.lines).toEqual([{ payment_method_id: 'm-cash', amount_minor: 12_300 }]);
  });

  it('no enabled methods ⇒ nothing to save', () => {
    expect(parseInputs([], {}).lines).toBeNull();
  });
});

describe('previewDifference', () => {
  it('collected − meter sales: positive overage, negative shortage, zero none', () => {
    expect(previewDifference(view(), 23_000)).toEqual({ final: true, differenceMinor: 0, direction: 'none' });
    expect(previewDifference(view(), 22_000)).toEqual({ final: true, differenceMinor: -1_000, direction: 'shortage' });
    expect(previewDifference(view(), 25_000)).toEqual({ final: true, differenceMinor: 2_000, direction: 'overage' });
    expect(directionOf(-1)).toBe('shortage');
  });

  it('never produces a difference from unreliable or hidden sales', () => {
    const incomplete = view({ sales: { ...view().sales, complete: false, amount_minor: null } });
    expect(previewDifference(incomplete, 23_000)).toEqual({ final: false, differenceMinor: null, direction: null });
    const hidden = view({ sales: { ...view().sales, visible: false, amount_minor: null } });
    expect(previewDifference(hidden, 23_000).final).toBe(false);
    expect(previewDifference(view(), null).final).toBe(false);
  });
});

describe('previewDrawer — drawer cash separated from the float and the treasury handover', () => {
  it('implied sales cash = counted − float − cash added + cash taken out (incl. handover) + expenses', () => {
    // 30500 − 20000 − 500 + 10000 + 0 = 20000
    const preview = previewDrawer(view(), 30_500, 20_000);
    expect(preview).toEqual({ impliedSalesCashMinor: 20_000, crossDifferenceMinor: 0 });
    expect(previewDrawer(view(), 30_500, 19_000)?.crossDifferenceMinor).toBe(-1_000);
  });

  it('needs a counted amount and sales visibility; a frozen drawer is never recomputed locally', () => {
    expect(previewDrawer(view(), null, 1)).toBeNull();
    const hidden = view({ drawer: { ...view().drawer, implied_sales_cash: { visible: false } } });
    expect(previewDrawer(hidden, 30_500, 1)).toBeNull();
    expect(previewDrawer(view({ drawer: { ...view().drawer, frozen: true } }), 30_500, 1)).toBeNull();
  });
});

describe('saved state helpers', () => {
  const declared = view({
    state: 'declared', revision: 2,
    declaration: { id: 'd1', revision: 2, status: 'declared', lines: [{ payment_method_id: 'm-cash', name: 'x', settlement_type: 'cash', amount_minor: 100 }, { payment_method_id: 'm-bank', name: 'y', settlement_type: 'bank', amount_minor: 50 }], collected_total_minor: 150, cash_declared_minor: 100, network_declared_minor: 50 },
  });

  it('isDirty compares the inputs with the saved declaration', () => {
    expect(isDirty(view(), parseInputs(view().methods, { 'm-cash': '1', 'm-bank': '1' }))).toBe(true); // لا إقرار بعد
    expect(isDirty(declared, parseInputs(declared.methods, { 'm-cash': '1', 'm-bank': '0.5' }))).toBe(false);
    expect(isDirty(declared, parseInputs(declared.methods, { 'm-cash': '2', 'm-bank': '0.5' }))).toBe(true);
    expect(isDirty(declared, parseInputs(declared.methods, { 'm-cash': '1' }))).toBe(true); // ناقص
  });

  it('seeds only the methods that have a saved amount', () => {
    expect(seedInputs([method('a', 'cash', 12_345), method('b', 'bank', null)])).toEqual({ a: '123.45' });
  });

  it('success is confirmed only when the server echo equals what was sent', () => {
    const sent = [{ payment_method_id: 'm-bank', amount_minor: 50 }, { payment_method_id: 'm-cash', amount_minor: 100 }];
    expect(savedMatches(declared, sent)).toBe(true);
    expect(savedMatches(declared, [{ payment_method_id: 'm-cash', amount_minor: 101 }, sent[0]])).toBe(false);
    expect(savedMatches(view(), sent)).toBe(false);
  });

  it('the intent fingerprint is stable under ordering and changes with any amount or base revision', () => {
    const a = intentPayload('s1', 0, [{ payment_method_id: 'b', amount_minor: 1 }, { payment_method_id: 'a', amount_minor: 2 }]);
    const b = intentPayload('s1', 0, [{ payment_method_id: 'a', amount_minor: 2 }, { payment_method_id: 'b', amount_minor: 1 }]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(intentPayload('s1', 1, [{ payment_method_id: 'a', amount_minor: 2 }]))).not.toBe(JSON.stringify(intentPayload('s1', 0, [{ payment_method_id: 'a', amount_minor: 2 }])));
  });
});

describe('collectionResponse schema', () => {
  it('rejects a response with a missing required field instead of guessing', () => {
    expect(collectionResponse.safeParse({ data: { ...view(), sales: undefined } }).success).toBe(false);
    expect(collectionResponse.safeParse({ data: view() }).success).toBe(true);
  });

  it('accepts the hidden-reconciliation shape for viewers without sales visibility', () => {
    const hidden = view({ reconciliation: { visible: false }, sales: { ...view().sales, visible: false, amount_minor: null } });
    expect(collectionResponse.safeParse({ data: hidden }).success).toBe(true);
  });
});

describe('closeGate — Q1: a saved, complete declaration is required to hand the shift over', () => {
  const ready = (over: Partial<CollectionView['close_readiness']> = {}) => view({ close_readiness: { ready: true, blockers: [], reason_required: false, ...over } });

  it('blocks with the server reason: required / incomplete / no methods', () => {
    expect(closeGate(view(), true)).toEqual({ blocked: true, reason: 'required', reasonRequired: false });
    expect(closeGate(view({ close_readiness: { ready: false, blockers: ['incomplete'], reason_required: false } }), false).reason).toBe('incomplete');
    expect(closeGate(view({ close_readiness: { ready: false, blockers: ['no_methods'], reason_required: false } }), false).reason).toBe('no_methods');
    expect(closeGate(view({ methods: [], close_readiness: { ready: true, blockers: [], reason_required: false } }), false).reason).toBe('no_methods');
  });

  it('an unknown server blocker fails closed as "required"', () => {
    expect(closeGate(view({ close_readiness: { ready: false, blockers: ['something_new'], reason_required: false } }), false).reason).toBe('required');
  });

  it('ready on the server but edited locally ⇒ unsaved (save first)', () => {
    expect(closeGate(ready(), true)).toEqual({ blocked: true, reason: 'unsaved', reasonRequired: false });
  });

  it('open only when saved, complete and unchanged; the difference reason is required only if the server says so', () => {
    expect(closeGate(ready(), false)).toEqual({ blocked: false, reason: null, reasonRequired: false });
    expect(closeGate(ready({ reason_required: true }), false)).toEqual({ blocked: false, reason: null, reasonRequired: true });
    // لا يُعلَن إلزام السبب أثناء حجب الإغلاق لسبب آخر
    expect(closeGate(ready({ reason_required: true }), true).reasonRequired).toBe(false);
  });
});

describe('review visibility (Q2/Q3)', () => {
  it('accepts both the hidden and the visible review shapes', () => {
    expect(collectionResponse.safeParse({ data: view({ review: { visible: false } }) }).success).toBe(true);
    expect(collectionResponse.safeParse({ data: view({ review: { visible: true, state: 'pending', reason: 'r', note: null, reviewed_by: null, reviewed_at: null } }) }).success).toBe(true);
    expect(collectionResponse.safeParse({ data: { ...view(), close_readiness: undefined } }).success).toBe(false);
  });
});
