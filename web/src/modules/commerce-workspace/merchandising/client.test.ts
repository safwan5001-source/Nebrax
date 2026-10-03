import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));

import { ApiError } from '@/lib/api';
import {
  COLLECTIONS_PATH,
  FACETS_PATH,
  createFacet,
  createFacetValue,
  deleteFacetValue,
  loadCollectionMembers,
  loadFacets,
  mapCollection,
  mapFacet,
  moveItem,
  productFacetsPath,
  replaceCollectionMembers,
  replaceProductFacetValueIds,
  suggestFacetKey,
} from './client';

afterEach(() => apiMock.mockReset());

describe('merchandising mappers', () => {
  it('maps a facet with values and drops malformed rows', () => {
    const facet = mapFacet({
      id: 'f1', key: 'occasion', system_key: 'occasion', name: 'المناسبة', name_en: 'Occasion', sort_order: 1, is_active: true,
      values: [
        { id: 'v1', slug: 'birthday', name: 'ميلاد', name_en: 'Birthday', sort_order: 0, is_active: true, product_count: 3 },
        { id: 'v2', slug: 'x' },
        null,
      ],
    });

    expect(facet?.systemKey).toBe('occasion');
    expect(facet?.values).toHaveLength(1);
    expect(facet?.values[0]).toMatchObject({ slug: 'birthday', productCount: 3, isActive: true });
  });

  it('rejects an unknown system key instead of trusting it, and fails closed on missing identity', () => {
    expect(mapFacet({ id: 'f', key: 'k', name: 'n', system_key: 'brand' })?.systemKey).toBeNull();
    expect(mapFacet({ key: 'k', name: 'n' })).toBeNull();
    expect(mapFacet('nope')).toBeNull();
  });

  it('maps a collection and defaults unknown status to draft', () => {
    expect(mapCollection({ id: 'c', slug: 's', title: 't', status: 'live', member_count: 2 })).toMatchObject({ status: 'draft', memberCount: 2 });
    expect(mapCollection({ id: 'c', slug: 's', title: 't', status: 'active' })?.status).toBe('active');
    expect(mapCollection({ id: 'c' })).toBeNull();
  });
});

describe('merchandising helpers', () => {
  it('moves an item one step and ignores out-of-range moves', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });

  it('suggests an ascii key and returns empty for non-latin sources', () => {
    expect(suggestFacetKey('Flower Type!')).toBe('flower-type');
    expect(suggestFacetKey('نوع الزهرة')).toBe('');
  });
});

describe('merchandising requests', () => {
  it('never sends a tenant identifier and uses the workspace paths', async () => {
    apiMock.mockResolvedValue({ data: { facets: [] } });
    await loadFacets();
    expect(apiMock).toHaveBeenCalledWith(FACETS_PATH);
    expect(FACETS_PATH).not.toContain('tenant');
    expect(COLLECTIONS_PATH).not.toContain('tenant');
  });

  it('creates a system facet with only the allowed fields', async () => {
    apiMock.mockResolvedValue({ data: { facet: { id: 'f', key: 'occasion', name: 'المناسبة', system_key: 'occasion' } } });
    const result = await createFacet({ key: 'occasion', name: 'المناسبة', nameEn: 'Occasion', systemKey: 'occasion' });

    expect(result.ok).toBe(true);
    expect(apiMock).toHaveBeenCalledWith(FACETS_PATH, {
      method: 'POST',
      body: { key: 'occasion', name: 'المناسبة', name_en: 'Occasion', system_key: 'occasion' },
    });
  });

  it('surfaces a 409 conflict with the server message instead of throwing', async () => {
    apiMock.mockRejectedValue(new ApiError(409, 'توجد قيمة بنفس الاسم في هذا البُعد.', {}));
    const result = await createFacetValue('f1', { name: 'ميلاد' });

    expect(result).toEqual({ ok: false, status: 409, message: 'توجد قيمة بنفس الاسم في هذا البُعد.' });
  });

  it('returns a non-HTTP failure with a null status', async () => {
    apiMock.mockRejectedValue(new TypeError('network'));
    expect(await deleteFacetValue('f1', 'v1')).toEqual({ ok: false, status: null, message: null });
  });

  it('replaces product assignments and collection members as ordered sets', async () => {
    apiMock.mockResolvedValue({ data: { value_ids: ['v1', 'v2'] } });
    const assigned = await replaceProductFacetValueIds('p 1', ['v1', 'v2']);
    expect(assigned).toEqual({ ok: true, data: ['v1', 'v2'] });
    expect(apiMock).toHaveBeenCalledWith(productFacetsPath('p 1'), { method: 'PUT', body: { value_ids: ['v1', 'v2'] } });
    expect(productFacetsPath('p 1')).toBe('/commerce/workspace/products/p%201/facets');

    apiMock.mockResolvedValue({ data: { products: [{ product_id: 'b', name: 'ب', position: 0 }, { product_id: 'a', name: 'أ', position: 1 }] } });
    const members = await replaceCollectionMembers('c1', ['b', 'a']);
    expect(apiMock).toHaveBeenLastCalledWith(`${COLLECTIONS_PATH}/c1/products`, { method: 'PUT', body: { product_ids: ['b', 'a'] } });
    expect(members.ok && members.data.map((m) => m.productId)).toEqual(['b', 'a']);
  });

  it('returns null (not a crash) when a read fails or has an unexpected shape', async () => {
    apiMock.mockRejectedValue(new Error('x'));
    expect(await loadFacets()).toBeNull();
    apiMock.mockResolvedValue({ data: {} });
    expect(await loadCollectionMembers('c1')).toBeNull();
  });
});
