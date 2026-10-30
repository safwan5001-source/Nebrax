import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import { loadStoreCatalogCounts, loadStoreCatalogPage, setStorePublication } from './api';

const list = (total: number) => ({ data: [], meta: { current_page: 1, last_page: 1, per_page: 10, total } });

describe('catalog api', () => {
  beforeEach(() => apiMock.mockReset());

  it('scopes the publication list to the store and never sends a tenant', async () => {
    apiMock.mockResolvedValue(list(0));
    await loadStoreCatalogPage('s1', { search: ' x ', status: 'published', page: 2, perPage: 25 });
    const url = String(apiMock.mock.calls[0][0]);
    expect(url).toContain('/commerce/workspace/products/publication?');
    expect(url).toContain('storefront_id=s1');
    expect(url).toContain('status=published');
    expect(url).toContain('page=2');
    expect(url).not.toContain('tenant');
  });

  it('takes totals from the server meta of three scoped reads', async () => {
    apiMock.mockImplementation((path: string) =>
      Promise.resolve(list(String(path).includes('status=unpublished') ? 4 : String(path).includes('status=published') ? 6 : 10)),
    );
    await expect(loadStoreCatalogCounts('s1')).resolves.toEqual({ all: 10, published: 6, unpublished: 4 });
  });

  it('publishes on one store while preserving publication on the others (full-replace contract)', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { stores: [{ id: 'a', name: 'A', is_published: true }, { id: 'b', name: 'B', is_published: false }] } })
      .mockResolvedValueOnce({ data: { stores: [] } });
    await setStorePublication('p1', 'b', true);
    expect(apiMock.mock.calls[0][0]).toBe('/commerce/workspace/products/p1/publication');
    expect(apiMock.mock.calls[1]).toEqual(['/commerce/workspace/products/p1/publication', { method: 'PUT', body: { storefront_ids: ['a', 'b'] } }]);
  });

  it('unpublishes only the target store', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { stores: [{ id: 'a', name: 'A', is_published: true }, { id: 'b', name: 'B', is_published: true }] } })
      .mockResolvedValueOnce({ data: { stores: [] } });
    await setStorePublication('p1', 'a', false);
    expect(apiMock.mock.calls[1][1]).toEqual({ method: 'PUT', body: { storefront_ids: ['b'] } });
  });

  it('writes nothing when the current state cannot be read', async () => {
    apiMock.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 500 }));
    await expect(setStorePublication('p1', 'a', true)).rejects.toBeTruthy();
    expect(apiMock).toHaveBeenCalledTimes(1);
  });
});
