import { describe, expect, it, vi } from 'vitest';
import { effectivePrice, unpriced } from './__fixtures__';
import { resolveStationPrices, toPriceResult } from './prices';
import { StationOpsError } from './read-client';

describe('toPriceResult — the server decides, the client only presents', () => {
  it('maps a station override with its tax mode, validity and sellability', () => {
    expect(toPriceResult(effectivePrice('a', 'p1', 950, { effective_from: '2026-10-01T00:00:00+00:00' }))).toEqual({
      kind: 'known', minor: 950, scope: 'station', effectiveFrom: '2026-10-01T00:00:00+00:00', effectiveUntil: null, taxMode: 'tax_inclusive', sellable: true, blockers: [],
    });
  });

  it('maps the organization default as the tenant scope', () => {
    expect(toPriceResult(effectivePrice('a', 'p1', 900, { source: 'tenant_default', tax_mode: 'tax_exclusive' }))).toMatchObject({ kind: 'known', scope: 'tenant', taxMode: 'tax_exclusive' });
  });

  it('keeps an unset tax mode and the server sale blockers visible instead of hiding the price', () => {
    expect(toPriceResult(effectivePrice('a', 'p1', 950, { tax_mode: null, sellable: false, blockers: ['tax_mode_unset'] }))).toMatchObject({
      kind: 'known', minor: 950, taxMode: null, sellable: false, blockers: ['tax_mode_unset'],
    });
  });

  it('keeps "not configured" and "inactive product" apart from a real price, and a genuine zero apart from missing', () => {
    expect(toPriceResult(unpriced('a', 'p1'))).toEqual({ kind: 'not_configured' });
    expect(toPriceResult(unpriced('a', 'p1', { status: 'product_inactive' }))).toEqual({ kind: 'product_inactive' });
    expect(toPriceResult(effectivePrice('a', 'p1', 0))).toMatchObject({ kind: 'known', minor: 0 });
  });

  it.each([
    ['a unit that is not the liter', effectivePrice('a', 'p1', 950, { unit: 'pcs' })],
    ['an unknown status', effectivePrice('a', 'p1', 950, { status: 'superseded' })],
    ['an effective row without a price', effectivePrice('a', 'p1', 950, { price_per_liter_minor: null })],
    ['an effective row without a source', effectivePrice('a', 'p1', 950, { source: null })],
    ['an unknown source', effectivePrice('a', 'p1', 950, { source: 'product_card' })],
    ['an unknown tax mode', effectivePrice('a', 'p1', 950, { tax_mode: 'maybe' })],
  ])('refuses to show %s as a price', (_label, row) => {
    expect(toPriceResult(row)).toEqual({ kind: 'error' });
  });
});

describe('resolveStationPrices', () => {
  it('reads every product with one station-scoped request', async () => {
    const fetchRows = vi.fn(async () => [effectivePrice('a', 'p1', 950), unpriced('a', 'p2')]);
    const result = await resolveStationPrices(fetchRows, 'a', ['p1', 'p2']);
    expect(fetchRows).toHaveBeenCalledTimes(1);
    expect(result.p1).toMatchObject({ kind: 'known', minor: 950 });
    expect(result.p2).toEqual({ kind: 'not_configured' });
  });

  it("ignores another station's rows and reports a product the server did not answer for as an error (never as a price)", async () => {
    const result = await resolveStationPrices(async () => [effectivePrice('b', 'p1', 777)], 'a', ['p1']);
    expect(result.p1).toEqual({ kind: 'error' });
  });

  it('reports a permission failure for every product, not zero', async () => {
    const result = await resolveStationPrices(async () => { throw new StationOpsError('forbidden'); }, 'a', ['p1', 'p2']);
    expect(result).toEqual({ p1: { kind: 'forbidden' }, p2: { kind: 'forbidden' } });
  });

  it('reports a connection failure as an error state, never as an empty or zero price', async () => {
    const result = await resolveStationPrices(async () => { throw new StationOpsError('offline'); }, 'a', ['p1']);
    expect(result).toEqual({ p1: { kind: 'error' } });
  });

  it('rethrows an abort so a superseded request is discarded, not rendered', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    await expect(resolveStationPrices(async () => { throw abort; }, 'a', ['p1'])).rejects.toBe(abort);
  });
});
