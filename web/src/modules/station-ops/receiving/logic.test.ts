import { describe, expect, it } from 'vitest';
import { EMPTY_FORM, buildDeliveryBody, buildReadingBody, evaluate, matchesIntent, readingEvidenceKey, stepIssues, type FormValues } from './logic';

const ok: FormValues = { ...EMPTY_FORM, supplierId: 's1', tankId: 't1', deliveryNote: 'DN-1', dispatched: '10000', received: '9995.5', before: '1000', after: '10995.5' };
const ctx = { hasWarehouse: true };

describe('receiving form evaluation', () => {
  it('a complete form has no issues; variance and tank gain are exact integers', () => {
    const e = evaluate(ok, ctx);
    expect(e.issues).toEqual([]);
    expect(e.receivedMl).toBe(9_995_500);
    expect(e.dispatchedMl).toBe(10_000_000);
    expect(e.transitVarianceMl).toBe(-4_500);
    expect(e.tankGainMl).toBe(9_995_500);
    expect(e.tankGainDiffMl).toBe(0);
    expect(e.warnings).toContain('received_below_dispatched');
    expect(e.warnings).not.toContain('tank_gain_differs');
  });

  it('empty is never zero: every required field is reported separately', () => {
    const e = evaluate(EMPTY_FORM, ctx);
    expect(e.issues).toEqual(expect.arrayContaining(['supplier_required', 'tank_required', 'dispatched_required', 'received_required']));
    expect(e.receivedMl).toBeNull();
  });

  it('rejects zero received quantity, malformed numbers and more than three decimals', () => {
    expect(evaluate({ ...ok, received: '0' }, ctx).issues).toContain('received_not_positive');
    expect(evaluate({ ...ok, received: '1.2345' }, ctx).issues).toContain('received_invalid');
    expect(evaluate({ ...ok, dispatched: '1,500' }, ctx).issues).toContain('dispatched_invalid'); // ملتبس: لا تخمين
  });

  it('accepts Arabic-Indic digits, and the form has no cost at all (B5.1: cost is a separate finance action)', () => {
    const e = evaluate({ ...ok, received: '٩٩٩٥٫٥' }, ctx);
    expect(e.receivedMl).toBe(9_995_500);
    expect(e.issues).toEqual([]);
    expect('costMinor' in e).toBe(false);
    expect(Object.keys(EMPTY_FORM)).not.toContain('cost');
  });

  it('blocks an impossible after-reading below the before-reading, and warns when only one reading is given', () => {
    expect(evaluate({ ...ok, before: '500', after: '400' }, ctx).issues).toContain('after_below_before');
    expect(evaluate({ ...ok, after: '' }, ctx).warnings).toContain('readings_incomplete');
    expect(evaluate({ ...ok, before: '', after: '' }, ctx).warnings).toContain('no_readings');
  });

  it('reports tank-gain differences with sign, without inventing a threshold', () => {
    expect(evaluate({ ...ok, after: '10900' }, ctx).tankGainDiffMl).toBe(-95_500);
    expect(evaluate({ ...ok, after: '11000' }, ctx).tankGainDiffMl).toBe(4_500);
    expect(evaluate({ ...ok, after: '11000' }, ctx).warnings).toContain('tank_gain_differs');
  });

  it('a station without a warehouse blocks, and the supplier delivery note number is REQUIRED for a new receiving (an attachment never replaces it)', () => {
    expect(evaluate(ok, { hasWarehouse: false }).issues).toContain('warehouse_required');
    for (const blank of ['', '   ', '\t\n']) {
      const e = evaluate({ ...ok, deliveryNote: blank }, ctx);
      expect(e.issues).toContain('delivery_note_required');
      expect(stepIssues('who', e)).toContain('delivery_note_required');
      expect(stepIssues('review', e)).toContain('delivery_note_required');
    }
    expect(evaluate(ok, ctx).issues).toEqual([]);
    expect(evaluate({ ...ok, deliveryNote: ' DN-2 ' }, ctx).issues).toEqual([]);
  });

  it('splits issues by step', () => {
    const e = evaluate({ ...ok, supplierId: '', received: '', before: '9', after: '1' }, ctx);
    expect(stepIssues('who', e)).toEqual(['supplier_required']);
    expect(stepIssues('quantities', e)).toEqual(['received_required']);
    expect(stepIssues('readings', e)).toEqual(['after_below_before']);
    expect(stepIssues('review', e)).toHaveLength(3);
  });
});

describe('request building', () => {
  const build = { stationId: 'st', tankId: 't1', fuelProductId: 'fp', warehouseId: 'wh', idempotencyKey: 'awj-ops-k1', readingIds: {} as { before?: string; after?: string } };

  it('sends liters as ≤3-decimal strings, NO cost key (NULL until finance records it), trimmed optionals only, and no client clock', () => {
    const body = buildDeliveryBody({ ...ok, tanker: ' TNK ', driver: '', notes: '' }, evaluate(ok, ctx), build);
    expect(body).toEqual({
      fuel_station_id: 'st', fuel_tank_id: 't1', fuel_product_id: 'fp', warehouse_id: 'wh', supplier_id: 's1',
      dispatched_liters: '10000', received_liters: '9995.5', idempotency_key: 'awj-ops-k1',
      delivery_note_number: 'DN-1', tanker_identifier: 'TNK',
    });
    expect(body).not.toHaveProperty('received_at');
    expect(body).not.toHaveProperty('received_total_cost_minor');
  });

  it('links readings under the chosen type only', () => {
    const physical = buildDeliveryBody(ok, evaluate(ok, ctx), { ...build, readingIds: { before: 'r1', after: 'r2' } });
    expect(physical).toMatchObject({ before_physical_reading_id: 'r1', after_physical_reading_id: 'r2' });
    expect(physical).not.toHaveProperty('before_atg_reading_id');
    const atg = buildDeliveryBody({ ...ok, readingType: 'atg' }, evaluate(ok, ctx), { ...build, readingIds: { before: 'r1' } });
    expect(atg).toMatchObject({ before_atg_reading_id: 'r1' });
    expect(atg).not.toHaveProperty('after_atg_reading_id');
  });

  it('refuses to build from an invalid form', () => {
    expect(() => buildDeliveryBody(EMPTY_FORM, evaluate(EMPTY_FORM, ctx), build)).toThrow();
  });

  it('evidence keys are deterministic per intent, stage and type', () => {
    expect(readingEvidenceKey('k', 'before', 'physical')).toBe('awj-ops:rcv:k:before:physical');
    expect(readingEvidenceKey('k', 'after', 'atg')).toBe('awj-ops:rcv:k:after:atg');
    expect(buildReadingBody('st', 't1', 'physical', 1_000_500, 'x')).toEqual({ fuel_station_id: 'st', fuel_tank_id: 't1', reading_type: 'physical', quantity_liters: '1000.5', evidence_key: 'x' });
  });

  it('recognises its own record after an uncertain write', () => {
    const e = evaluate(ok, ctx);
    const row = { supplier_id: 's1', tank_id: 't1', dispatched_milliliters: 10_000_000, received_milliliters: 9_995_500, delivery_note_number: 'DN-1' };
    expect(matchesIntent(row, ok, e)).toBe(true);
    expect(matchesIntent({ ...row, received_milliliters: 1 }, ok, e)).toBe(false);
    expect(matchesIntent({ ...row, delivery_note_number: 'DN-2' }, ok, e)).toBe(false);
  });
});
