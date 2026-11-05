import { describe, expect, it, vi } from 'vitest';
import { price } from './__fixtures__';
import { MAX_PRICE_PAGES, pickEffectivePrice, resolveProductPrice, type PriceFetcher } from './prices';
import { StationOpsError } from './read-client';

const NOW = Date.parse('2026-11-04T12:00:00+00:00');

describe('pickEffectivePrice', () => {
  it('prefers the station override over the tenant default, regardless of dates', () => {
    const rows = [price('t', null, 'p1', 900, { effective_from: '2026-10-01T00:00:00+00:00' }), price('s', 'a', 'p1', 950, { effective_from: '2026-01-01T00:00:00+00:00' })];
    expect(pickEffectivePrice(rows, 'a', 'p1', NOW)).toMatchObject({ kind: 'known', minor: 950, scope: 'station' });
  });

  it('falls back to the tenant default', () => {
    expect(pickEffectivePrice([price('t', null, 'p1', 900)], 'a', 'p1', NOW)).toMatchObject({ kind: 'known', minor: 900, scope: 'tenant' });
  });

  it('never uses another station\'s price', () => {
    expect(pickEffectivePrice([price('o', 'b', 'p1', 777)], 'a', 'p1', NOW)).toEqual({ kind: 'not_configured' });
  });

  it('distinguishes "not configured" from a real value, and a zero price from missing', () => {
    expect(pickEffectivePrice([], 'a', 'p1', NOW)).toEqual({ kind: 'not_configured' });
    expect(pickEffectivePrice([price('z', 'a', 'p1', 0)], 'a', 'p1', NOW)).toMatchObject({ kind: 'known', minor: 0 });
  });

  it.each([
    ['future price', { effective_from: '2026-12-01T00:00:00+00:00' }],
    ['expired price', { effective_until: '2026-06-01T00:00:00+00:00' }],
    ['non-active status', { status: 'superseded' }],
    ['unparseable date', { effective_from: 'not-a-date' }],
  ])('ignores a %s', (_label, over) => {
    expect(pickEffectivePrice([price('x', 'a', 'p1', 800, over)], 'a', 'p1', NOW)).toEqual({ kind: 'not_configured' });
  });

  it('uses the price whose window contains now when several exist', () => {
    const rows = [
      price('old', 'a', 'p1', 800, { effective_from: '2026-01-01T00:00:00+00:00', effective_until: '2026-10-01T00:00:00+00:00' }),
      price('cur', 'a', 'p1', 820, { effective_from: '2026-10-01T00:00:00+00:00' }),
    ];
    expect(pickEffectivePrice(rows, 'a', 'p1', NOW)).toMatchObject({ minor: 820 });
  });
});

const page = (data: ReturnType<typeof price>[], current = 1, last = 1) => ({ data, meta: { current_page: current, last_page: last } });

describe('resolveProductPrice', () => {
  it('stops at the station-scoped query when a station price exists (no tenant-wide read)', async () => {
    const fetcher = vi.fn<PriceFetcher>(async (q) => (q.station_id ? page([price('s', 'a', 'p1', 950)]) : page([])));
    const result = await resolveProductPrice(fetcher, 'a', 'p1', NOW);
    expect(result).toMatchObject({ kind: 'known', minor: 950, scope: 'station' });
    expect(fetcher.mock.calls.every(([q]) => q.station_id === 'a')).toBe(true);
  });

  it('drops other stations\' rows from the unfiltered fallback query', async () => {
    const fetcher: PriceFetcher = async (q) => (q.station_id ? page([]) : page([price('o', 'b', 'p1', 111), price('t', null, 'p1', 900)]));
    expect(await resolveProductPrice(fetcher, 'a', 'p1', NOW)).toMatchObject({ kind: 'known', minor: 900, scope: 'tenant' });
  });

  it('reports not_configured only when every page was read', async () => {
    const fetcher: PriceFetcher = async (q) => page([], q.page, 1);
    expect(await resolveProductPrice(fetcher, 'a', 'p1', NOW)).toEqual({ kind: 'not_configured' });
  });

  it('reports incomplete (not "no price") when the page cap is reached', async () => {
    const fetcher = vi.fn<PriceFetcher>(async (q) => page([], q.page, 99));
    expect(await resolveProductPrice(fetcher, 'a', 'p1', NOW)).toEqual({ kind: 'incomplete' });
    expect(fetcher).toHaveBeenCalledTimes(MAX_PRICE_PAGES);
  });

  it('maps a 403 to forbidden, other failures to error, and rethrows aborts', async () => {
    expect(await resolveProductPrice(async () => { throw new StationOpsError('forbidden', 403); }, 'a', 'p1', NOW)).toEqual({ kind: 'forbidden' });
    expect(await resolveProductPrice(async () => { throw new StationOpsError('server', 500); }, 'a', 'p1', NOW)).toEqual({ kind: 'error' });
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    await expect(resolveProductPrice(async () => { throw abort; }, 'a', 'p1', NOW)).rejects.toBe(abort);
  });
});
