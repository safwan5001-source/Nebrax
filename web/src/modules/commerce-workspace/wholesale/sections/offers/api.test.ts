import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => ({ ...(await vi.importActual<object>('@/lib/api')), api: (...args: unknown[]) => apiMock(...args) }));

import { fromLocalInput, loadOffers, searchEligibleProducts, toLocalInput } from './api';

const offerRow = (over: Record<string, unknown> = {}) => ({
  id: 'o1', product_id: 'p1', position: 0, is_active: true, starts_at: null, ends_at: null,
  product: { name: 'Rice', name_en: null, thumbnail_url: null },
  evaluation: { is_live: false, reason: 'not_discounted' }, ...over,
});

describe('offers api', () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it('reads the store offers endpoint without a tenant and returns the server max', async () => {
    apiMock.mockResolvedValue({ data: [offerRow()], meta: { max_offers: 12 } });
    const result = await loadOffers('s1');
    expect(apiMock.mock.calls[0][0]).toBe('/commerce/workspace/storefronts/s1/offers');
    expect(String(apiMock.mock.calls[0][0])).not.toContain('tenant');
    expect(result.maxOffers).toBe(12);
    expect(result.offers[0]).toMatchObject({ id: 'o1', isLive: false, reason: 'not_discounted' });
  });

  it.each([[403], [404]])('turns a %i into a thrown status so useResource can classify it', async (status) => {
    apiMock.mockImplementation(() => Promise.reject(Object.assign(new Error('no'), { status })));
    await expect(loadOffers('s1')).rejects.toMatchObject({ status });
  });

  it('does not patch up a payload the resolver marked live without price proof', async () => {
    apiMock.mockResolvedValue({ data: [offerRow({ evaluation: { is_live: true } })] });
    await expect(loadOffers('s1')).rejects.toMatchObject({ status: 500 });
  });

  it('searches only the store’s eligible products', async () => {
    apiMock.mockResolvedValue({ data: [{ id: 'p1', name: 'Rice' }], meta: { pagination: { has_more: false } } });
    const rows = await searchEligibleProducts('s1', 'ri');
    expect(String(apiMock.mock.calls[0][0])).toBe('/commerce/workspace/storefronts/s1/products?search=ri&per_page=10');
    expect(rows).toHaveLength(1);
  });

  it('returns no choices when the product read fails', async () => {
    apiMock.mockImplementation(() => Promise.reject(new Error('x')));
    await expect(searchEligibleProducts('s1', 'ri')).resolves.toEqual([]);
  });

  it('round-trips the local datetime input through ISO', () => {
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('not a date')).toBeNull();
    const iso = fromLocalInput('2026-12-01T09:30')!;
    expect(iso.endsWith('Z')).toBe(true);
    expect(toLocalInput(iso)).toBe('2026-12-01T09:30');
    expect(toLocalInput(null)).toBe('');
  });
});
