import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import {
  COMMERCE_STORE_ADMIN_LIST_PATH,
  loadCommerceStoreCatalog,
  mapCommerceStoreAdminList,
  provisionCommerceStorefront,
  resolveViewStoreUrl,
  selectStoreId,
  updateCommerceStorefrontIdentity,
  activateCommerceStorefront,
  deactivateCommerceStorefront,
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
            default_locale: 'ar',
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
          defaultLocale: 'ar',
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
        { id: 'store-a', name: 'Store A', salesChannelId: 'ch-a', isActive: true, previewUrl: 'https://a.example', defaultLocale: 'ar' },
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
        { id: 'store-a', name: 'Store A', salesChannelId: 'ch-a', isActive: true, previewUrl: 'https://shop.example/', defaultLocale: 'ar' },
        { id: 'store-b', name: 'Store B', salesChannelId: 'ch-b', isActive: true, previewUrl: 'javascript:alert(1)', defaultLocale: 'ar' },
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

describe('commerce storefront provisioning (COM-STORE-PROVISION-1)', () => {
  it('posts to the same tenant-scoped admin path and never sends a client hostname/tenant', async () => {
    apiMock.mockResolvedValue({
      data: { store: { id: 'store-x', name: 'X', sales_channel_id: 'ch-x', is_active: true, preview_url: 'https://x.example/', default_locale: 'ar' } },
      meta: { created: true },
    });

    const result = await provisionCommerceStorefront();

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts', { method: 'POST', body: {} });
    expect(result).toEqual({
      ok: true,
      store: { id: 'store-x', name: 'X', salesChannelId: 'ch-x', isActive: true, previewUrl: 'https://x.example/', defaultLocale: 'ar' },
    });
  });

  it('sends an optional trimmed display name only, no other identity field', async () => {
    apiMock.mockResolvedValue({
      data: { store: { id: 'store-y', name: 'متجري', sales_channel_id: 'ch-y', is_active: true, preview_url: null } },
    });

    await provisionCommerceStorefront('  متجري  ');

    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts', { method: 'POST', body: { name: 'متجري' } });
  });

  it('surfaces a failure instead of throwing when provisioning is rejected', async () => {
    apiMock.mockRejectedValue(new Error('forbidden'));

    await expect(provisionCommerceStorefront()).resolves.toEqual({ ok: false, message: 'forbidden' });
  });

  it('fails closed on an unexpected response shape instead of returning a fabricated store', async () => {
    apiMock.mockResolvedValue({ data: {} });

    await expect(provisionCommerceStorefront()).resolves.toEqual({ ok: false, message: 'invalid_payload' });
  });
});

describe('commerce storefront identity update (STORE-ADMIN-ADOPT-1B-1)', () => {
  it('PUTs to the tenant-scoped storefront id path with only name/default_locale', async () => {
    apiMock.mockResolvedValue({
      data: { store: { id: 'store-x', name: 'الاسم الجديد', sales_channel_id: 'ch-x', is_active: true, preview_url: null, default_locale: 'en' } },
    });

    const result = await updateCommerceStorefrontIdentity('store-x', { name: 'الاسم الجديد', default_locale: 'en' });

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/store-x', {
      method: 'PUT',
      body: { name: 'الاسم الجديد', default_locale: 'en' },
    });
    expect(result).toEqual({
      ok: true,
      store: { id: 'store-x', name: 'الاسم الجديد', salesChannelId: 'ch-x', isActive: true, previewUrl: null, defaultLocale: 'en' },
    });
  });

  it('surfaces a failure instead of throwing when the update is rejected', async () => {
    apiMock.mockRejectedValue(new Error('forbidden'));

    await expect(updateCommerceStorefrontIdentity('store-x', { name: 'X' })).resolves.toEqual({
      ok: false,
      message: 'forbidden',
    });
  });

  it('fails closed on an unexpected response shape', async () => {
    apiMock.mockResolvedValue({ data: {} });

    await expect(updateCommerceStorefrontIdentity('store-x', { name: 'X' })).resolves.toEqual({
      ok: false,
      message: 'invalid_payload',
    });
  });
});

describe('commerce storefront lifecycle (STORE-ADMIN-LIFECYCLE-1)', () => {
  it('posts activate to the storefront id path and never to a domain edge URL', async () => {
    apiMock.mockResolvedValue({
      data: { store: { id: 'store-x', name: 'X', sales_channel_id: 'ch-x', is_active: true, preview_url: 'https://x.example/', default_locale: 'ar' } },
    });

    const result = await activateCommerceStorefront('store-x');

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/store-x/activate', {
      method: 'POST',
      body: {},
    });
    expect(String(apiMock.mock.calls[0][0])).not.toContain('domains');
    expect(String(apiMock.mock.calls[0][0])).not.toContain('activate-edge');
    expect(result).toEqual({
      ok: true,
      store: { id: 'store-x', name: 'X', salesChannelId: 'ch-x', isActive: true, previewUrl: 'https://x.example/', defaultLocale: 'ar' },
    });
  });

  it('posts deactivate to the storefront id path and never to a domain edge URL', async () => {
    apiMock.mockResolvedValue({
      data: { store: { id: 'store-x', name: 'X', sales_channel_id: 'ch-x', is_active: false, preview_url: null, default_locale: 'ar' } },
    });

    const result = await deactivateCommerceStorefront('store-x');

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/store-x/deactivate', {
      method: 'POST',
      body: {},
    });
    expect(String(apiMock.mock.calls[0][0])).not.toContain('domains');
    expect(String(apiMock.mock.calls[0][0])).not.toContain('activate-edge');
    expect(result).toEqual({
      ok: true,
      store: { id: 'store-x', name: 'X', salesChannelId: 'ch-x', isActive: false, previewUrl: null, defaultLocale: 'ar' },
    });
  });

  it('surfaces a failure instead of throwing when activate is rejected', async () => {
    apiMock.mockRejectedValue(new Error('forbidden'));

    await expect(activateCommerceStorefront('store-x')).resolves.toEqual({
      ok: false,
      message: 'forbidden',
    });
  });

  it('fails closed on an unexpected deactivate response shape', async () => {
    apiMock.mockResolvedValue({ data: {} });

    await expect(deactivateCommerceStorefront('store-x')).resolves.toEqual({
      ok: false,
      message: 'invalid_payload',
    });
  });
});
