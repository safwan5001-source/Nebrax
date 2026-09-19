import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import {
  loadAvailableProductStores,
  loadProductPublication,
  loadProductPublicationList,
  productPublicationListPath,
  productPublicationPath,
  replaceProductPublication,
} from './publication';

afterEach(() => apiMock.mockReset());

describe('product store publication API', () => {
  it('loads authorized stores before a new product has an id', async () => {
    apiMock.mockResolvedValue({ data: { stores: [{ id: 'store-a', name: 'Store A' }] } });

    await expect(loadAvailableProductStores()).resolves.toEqual([
      { id: 'store-a', name: 'Store A', isPublished: false },
    ]);
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts');
  });

  it('maps CommerceListing is_published for an existing product', async () => {
    apiMock.mockResolvedValue({ data: { stores: [{ id: 'store-a', name: 'Store A', is_published: true }] } });

    await expect(loadProductPublication('product-a')).resolves.toEqual([
      { id: 'store-a', name: 'Store A', isPublished: true },
    ]);
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/products/product-a/publication');
  });

  it('replaces publication using storefront ids and no tenant authority from the client', async () => {
    apiMock.mockResolvedValue({ data: { stores: [] } });

    await replaceProductPublication('product/a', ['store-a']);

    expect(productPublicationPath('product/a')).toBe('/commerce/workspace/products/product%2Fa/publication');
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/products/product%2Fa/publication', {
      method: 'PUT',
      body: { storefront_ids: ['store-a'] },
    });
    expect(JSON.stringify(apiMock.mock.calls[0])).not.toContain('tenant');
    expect(JSON.stringify(apiMock.mock.calls[0])).not.toContain('is_online');
  });
});

describe('product publication workspace list API (COM-CATALOG-1)', () => {
  it('builds the server-side query without any client-supplied tenant authority', async () => {
    apiMock.mockResolvedValue({
      data: [
        {
          id: 'p1',
          sku: 'SKU-1',
          name: 'منتج',
          name_en: 'Product',
          is_active: true,
          is_published: true,
          stores: [{ id: 's1', name: 'Store', is_published: true }],
        },
      ],
      meta: { current_page: 2, last_page: 4, per_page: 25, total: 90 },
    });

    const page = await loadProductPublicationList({
      search: '  قهوة  ',
      status: 'published',
      storefrontId: 's1',
      page: 2,
      perPage: 25,
    });

    const url = String(apiMock.mock.calls[0][0]);
    expect(url.startsWith(`${productPublicationListPath()}?`)).toBe(true);
    expect(url).toContain('search=%D9%82%D9%87%D9%88%D8%A9');
    expect(url).toContain('status=published');
    expect(url).toContain('storefront_id=s1');
    expect(url).toContain('page=2');
    expect(url).toContain('per_page=25');
    expect(url).not.toContain('tenant');
    expect(url).not.toContain('is_online');

    expect(page.meta).toEqual({ currentPage: 2, lastPage: 4, perPage: 25, total: 90 });
    expect(page.items[0]).toMatchObject({
      id: 'p1',
      sku: 'SKU-1',
      name: 'منتج',
      nameEn: 'Product',
      isActive: true,
      isPublished: true,
      stores: [{ id: 's1', name: 'Store', isPublished: true }],
    });
  });

  it('omits the all-status filter and empty search from the query', async () => {
    apiMock.mockResolvedValue({
      data: [],
      meta: { current_page: 1, last_page: 1, per_page: 25, total: 0 },
    });

    await loadProductPublicationList({ search: '   ', status: 'all' });

    const url = String(apiMock.mock.calls[0][0]);
    expect(url).not.toContain('status=');
    expect(url).not.toContain('search=');
    expect(url).toContain('page=1');
  });
});
