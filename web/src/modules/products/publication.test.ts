import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import {
  loadAvailableProductStores,
  loadProductPublication,
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
