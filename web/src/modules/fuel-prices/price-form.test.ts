import { describe, expect, it } from 'vitest';
import { effective, suggestionOk } from './__fixtures__';
import { buildPayload, currentInScope, MAX_PRICE_MINOR, newIdempotencyKey, parsePriceInput, parseScheduled, rejectionKey } from './price-form';

describe('parsePriceInput — riyal per liter to exact minor units', () => {
  it.each([
    ['2.18', 218], ['2', 200], ['2.1', 210], ['0.05', 5], ['٢٫١٨', 218], ['2,18', 218], ['10000', MAX_PRICE_MINOR], ['10000.00', MAX_PRICE_MINOR],
  ])('%s → %i minor units (integer math, no float drift)', (raw, minor) => {
    expect(parsePriceInput(raw)).toEqual({ ok: true, minor });
  });

  it('never produces a binary-float artifact for classic float traps', () => {
    for (const [raw, minor] of [['1.15', 115], ['4.35', 435], ['8.2', 820], ['0.29', 29]] as const) expect(parsePriceInput(raw)).toEqual({ ok: true, minor });
  });

  it.each([
    ['', 'empty'], ['   ', 'empty'], ['abc', 'format'], ['2.185', 'format'], ['-1', 'format'], ['1e3', 'format'], ['2..1', 'format'],
    ['0', 'zero'], ['0.00', 'zero'], ['10000.01', 'too_large'], ['999999', 'too_large'],
  ])('rejects %j as %s — never silently 0 or a guess', (raw, error) => {
    expect(parsePriceInput(raw)).toEqual({ ok: false, error });
  });
});

describe('parseScheduled', () => {
  const NOW = Date.parse('2026-11-05T10:00:00Z');
  it('accepts a start at least a minute ahead and returns an absolute ISO instant', () => {
    const r = parseScheduled('2026-11-06T09:00', NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Date.parse(r.iso)).toBe(new Date('2026-11-06T09:00').getTime());
  });
  it('rejects empty, invalid and past/too-soon values', () => {
    expect(parseScheduled('', NOW)).toEqual({ ok: false, error: 'empty' });
    expect(parseScheduled('nope', NOW)).toEqual({ ok: false, error: 'format' });
    expect(parseScheduled('2020-01-01T00:00', NOW)).toEqual({ ok: false, error: 'past' });
    expect(parseScheduled(new Date(NOW + 30_000).toISOString().slice(0, 16), NOW)).toEqual({ ok: false, error: 'past' });
  });
});

describe('newIdempotencyKey', () => {
  it('matches the server format and is unique per attempt', () => {
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(50);
    for (const key of keys) expect(key).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });
});

describe('currentInScope — only the price that can actually conflict', () => {
  it('station scope ignores the inherited organization price; organization scope ignores station prices', () => {
    expect(currentInScope(effective('s1', 'p1', 218), { kind: 'station', stationId: 's1' })).not.toBeNull();
    expect(currentInScope(effective(null, 'p1', 205), { kind: 'station', stationId: 's1' })).toBeNull();
    expect(currentInScope(effective(null, 'p1', 205), { kind: 'tenant' })).not.toBeNull();
    expect(currentInScope(effective('s1', 'p1', 218), { kind: 'tenant' })).toBeNull();
    expect(currentInScope(undefined, { kind: 'tenant' })).toBeNull();
  });
});

describe('buildPayload', () => {
  const base = { scope: { kind: 'station', stationId: 's1' } as const, fuelProductId: 'p1', minor: 218, note: '  ', supersede: false, idempotencyKey: 'fp-key-12345' };

  it('"now" sends start_now and no client clock; blank notes are dropped; nothing optional leaks', () => {
    const payload = buildPayload({ ...base, start: { kind: 'now' } });
    expect(payload).toEqual({ fuel_station_id: 's1', fuel_product_id: 'p1', price_per_liter_minor: 218, idempotency_key: 'fp-key-12345', start_now: true });
    expect(payload).not.toHaveProperty('effective_from');
    expect(payload).not.toHaveProperty('supersede');
    expect(payload).not.toHaveProperty('source');
  });

  it('organization scope sends a null station; a scheduled start sends the absolute instant; supersede only when asked', () => {
    const payload = buildPayload({ ...base, scope: { kind: 'tenant' }, start: { kind: 'scheduled', localValue: 'x' }, scheduledIso: '2026-11-06T06:00:00.000Z', supersede: true, note: ' note ' });
    expect(payload).toMatchObject({ fuel_station_id: null, effective_from: '2026-11-06T06:00:00.000Z', supersede: true, reason: 'note' });
    expect(payload).not.toHaveProperty('start_now');
  });

  it('a suggestion carries the explicit unit and VAT-basis confirmation the user saw', () => {
    const payload = buildPayload({ ...base, start: { kind: 'now' }, suggestion: suggestionOk('s1', 'p1', 218, { tax_mode: 'tax_exclusive' }) });
    expect(payload.source).toEqual({ type: 'product_card', confirm_tax_mode: 'tax_exclusive', confirm_unit: 'L' });
  });
});

describe('rejectionKey', () => {
  it('maps every server reason and falls back to a generic message for unknown ones', () => {
    expect(rejectionKey('price_overlap')).toBe('overlap');
    expect(rejectionKey('suggestion_stale')).toBe('suggestionStale');
    expect(rejectionKey('something_new')).toBe('generic');
    expect(rejectionKey(undefined)).toBe('generic');
  });
});
