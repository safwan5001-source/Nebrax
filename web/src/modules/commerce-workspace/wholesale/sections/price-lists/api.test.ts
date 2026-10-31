import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import {
  addPriceListItem,
  assignChannelPriceList,
  collectPublishedProducts,
  computeCoverage,
  fetchCustomerDefaults,
  removePriceListItem,
  searchProducts,
} from './api';

const pubPage = (page: number, lastPage: number, ids: string[], total = ids.length) => ({
  data: ids.map((id) => ({ id, sku: null, name: id, name_en: null, is_active: !id.startsWith('off'), is_published: true, stores: [] })),
  meta: { current_page: page, last_page: lastPage, per_page: 100, total },
});

describe('price list api', () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it('assigns / clears the channel list sending ONLY default_price_list_id', async () => {
    apiMock.mockResolvedValue({ data: { id: 'c1' } });
    await assignChannelPriceList('c1', 'pl1');
    await assignChannelPriceList('c1', null);
    expect(apiMock.mock.calls[0]).toEqual(['/commerce/channels/c1/pricing-settings', { method: 'PUT', body: { default_price_list_id: 'pl1' } }]);
    expect(apiMock.mock.calls[1][1].body).toEqual({ default_price_list_id: null });
    expect(JSON.stringify(apiMock.mock.calls)).not.toContain('tenant');
  });

  it('writes item prices in integer minor units and removes by item id', async () => {
    apiMock.mockResolvedValue({ data: {} });
    await addPriceListItem('pl1', { product_id: 'p1', unit_name: null, price: 1250 });
    await removePriceListItem('pl1', 'i1');
    expect(apiMock.mock.calls[0]).toEqual(['/price-lists/pl1/items', { method: 'POST', body: { product_id: 'p1', unit_name: null, price: 1250 } }]);
    expect(apiMock.mock.calls[1]).toEqual(['/price-lists/pl1/items/i1', { method: 'DELETE' }]);
  });

  it('searches products with a bounded page and reads customer defaults from partners', async () => {
    apiMock.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [{ id: 'a', name: 'A', default_price_list_id: 'pl1', extra: 1 }, { id: 'b', name: 'B' }] });
    await searchProducts('rice');
    expect(apiMock.mock.calls[0][0]).toBe('/products?search=rice&per_page=10');
    await expect(fetchCustomerDefaults()).resolves.toEqual([
      { id: 'a', name: 'A', default_price_list_id: 'pl1' },
      { id: 'b', name: 'B', default_price_list_id: null },
    ]);
  });
});

describe('computeCoverage', () => {
  const published = [{ id: 'a', name: 'A', sku: null }, { id: 'b', name: 'B', sku: null }, { id: 'c', name: 'C', sku: null }];

  it('counts a product as covered when any list item references it', () => {
    const result = computeCoverage(published, ['a', 'a', 'c', 'zzz']);
    expect(result.total).toBe(3);
    expect(result.covered).toBe(2);
    expect(result.uncovered.map((p) => p.id)).toEqual(['b']);
    expect(result.itemsOutsideCatalog).toBe(1);
  });

  it('handles an empty list and an empty catalog', () => {
    expect(computeCoverage(published, []).covered).toBe(0);
    expect(computeCoverage([], ['x'])).toMatchObject({ total: 0, covered: 0, itemsOutsideCatalog: 1 });
  });
});

describe('collectPublishedProducts', () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it('pages through the server, keeps active products only and is not partial when complete', async () => {
    apiMock.mockResolvedValueOnce(pubPage(1, 2, ['a', 'off1'], 3)).mockResolvedValueOnce(pubPage(2, 2, ['b'], 3));
    const result = await collectPublishedProducts('s1');
    expect(result.products.map((p) => p.id)).toEqual(['a', 'b']);
    expect(result.partial).toBe(false);
    expect(result.serverTotal).toBe(3);
    expect(String(apiMock.mock.calls[0][0])).toContain('storefront_id=s1');
    expect(String(apiMock.mock.calls[0][0])).toContain('status=published');
  });

  it('stops at the page cap and reports a partial scan instead of a total', async () => {
    apiMock.mockImplementation((path: string) => {
      const page = Number(new URL(`http://x${path}`).searchParams.get('page'));
      return Promise.resolve(pubPage(page, 5, [`p${page}`], 500));
    });
    const result = await collectPublishedProducts('s1', { maxPages: 2 });
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(result.products.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(result.partial).toBe(true);
    expect(result.serverTotal).toBe(500);
  });
});
