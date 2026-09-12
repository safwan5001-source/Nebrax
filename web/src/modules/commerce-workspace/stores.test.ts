import { describe, expect, it } from 'vitest';
import {
  COMMERCE_STORE_ADMIN_LIST_PATH,
  loadCommerceStoreCatalog,
  resolveViewStoreUrl,
  selectStoreId,
  type CommerceStoreCatalog,
} from './stores';

describe('commerce store selector foundation', () => {
  it('does not invent an admin store list path', () => {
    expect(COMMERCE_STORE_ADMIN_LIST_PATH).toBeNull();
    expect(loadCommerceStoreCatalog()).toEqual({ status: 'unavailable', reason: 'missing_admin_api' });
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
});
