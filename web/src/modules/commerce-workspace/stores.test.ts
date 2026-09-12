import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import {
  COMMERCE_STORE_ADMIN_LIST_PATH,
  loadCommerceStoreCatalog,
  mapCommerceStoreAdminList,
  resolveViewStoreUrl,
  selectStoreId,
  type CommerceStoreCatalog,
} from './stores';

afterEach(() => apiMock.mockReset());

describe('commerce store selector catalog', () => {
  it('uses the tenant-scoped admin list and never the public storefront API', () => {
    expect(COMMERCE_STORE_ADMIN_LIST_PATH).toBe('/commerce/workspace/storefronts');
    expect(COMMERCE_STORE_ADMIN_LIST_PATH).not.toContain('store/v1');
    expect(COMMERCE_STORE_ADMIN_LIST_PATH).not.toContain('tenant');
  });

  it('loads only the session admin path without a client tenant identifier', async () => {
    apiMock.mockResolvedValue({ data: { stores: [] } });

    await expect(loadCommerceStoreCatalog()).resolves.toEqual({ status: 'empty' });
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts');
    expect(String(apiMock.mock.calls[0][0])).not.toContain('tenant');
  });

  it('maps authorized stores and ignores tenant identifiers in the payload', () => {
    const catalog = mapCommerceStoreAdminList({
      data: {
        tenant_id: 'tenant-b',
        stores: [
          {
            id: 'store-a',
            name: 'Store A',
            sales_channel_id: 'ch-a',
            is_active: true,
            preview_url: 'https://a.example/',
            tenant_id: 'tenant-b',
            hostname: 'b.example',
          },
        ],
      },
    });

    expect(catalog).toEqual({
      status: 'ready',
      stores: [
        {
          id: 'store-a',
          name: 'Store A',
          salesChannelId: 'ch-a',
          isActive: true,
          previewUrl: 'https://a.example/',
        },
      ],
    });
    expect(JSON.stringify(catalog)).not.toContain('tenant-b');
    expect(JSON.stringify(catalog)).not.toContain('b.example');
  });

  it('treats a missing preview URL and unsafe URLs as no View Store target', () => {
    const catalog = mapCommerceStoreAdminList({
      data: {
        stores: [
          { id: 'store-a', name: 'Store A', sales_channel_id: 'ch-a', is_active: true, preview_url: null },
          { id: 'store-b', name: 'Store B', sales_channel_id: 'ch-b', is_active: true, preview_url: 'javascript:alert(1)' },
        ],
      },
    });

    expect(catalog.status).toBe('ready');
    if (catalog.status !== 'ready') return;
    expect(catalog.stores[0]?.previewUrl).toBeNull();
    expect(catalog.stores[1]?.previewUrl).toBeNull();
  });

  it('never selects a store that is not in the tenant-scoped catalog', () => {
    const catalog: CommerceStoreCatalog = {
      status: 'ready',
      stores: [
        { id: 'store-a', name: 'Store A', salesChannelId: 'ch-a', isActive: true, previewUrl: 'https://a.example' },
      ],
    };

    expect(selectStoreId(catalog, 'store-b')).toBe('store-a');
    expect(selectStoreId(catalog, 'store-a')).toBe('store-a');
    expect(selectStoreId({ status: 'unavailable', reason: 'missing_admin_api' }, 'store-a')).toBeNull();
    expect(selectStoreId({ status: 'loading' }, 'store-a')).toBeNull();
    expect(selectStoreId({ status: 'empty' }, 'store-a')).toBeNull();
  });

  it('enables View Store only for an authoritative catalog URL', () => {
    const catalog: CommerceStoreCatalog = {
      status: 'ready',
      stores: [
        { id: 'store-a', name: 'Store A', salesChannelId: 'ch-a', isActive: true, previewUrl: 'https://shop.example/' },
        { id: 'store-b', name: 'Store B', salesChannelId: 'ch-b', isActive: true, previewUrl: 'javascript:alert(1)' },
      ],
    };

    expect(resolveViewStoreUrl(catalog, 'store-a')).toBe('https://shop.example/');
    expect(resolveViewStoreUrl(catalog, 'store-b')).toBeNull();
    expect(resolveViewStoreUrl({ status: 'unavailable', reason: 'missing_admin_api' }, 'store-a')).toBeNull();
  });

  it('fails closed when the admin list cannot be loaded', async () => {
    apiMock.mockRejectedValue(new Error('network'));
    await expect(loadCommerceStoreCatalog()).resolves.toEqual({ status: 'error', message: 'load_failed' });
  });
});
