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
  saveFacetValueVisual,
  saveFacetVisual,
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

// ── AWJ-VD-H1 / VD-3: the visual identity fields and the two PUT endpoints (VD-1b) ──────────────────────────

describe('facet visual fields on GET facets', () => {
  const raw = {
    id: 'f1', key: 'occasion', name: 'المناسبة', visual_version: 3,
    visual: { self: { shape: 'arch' }, defaults: { size: 'lg', bogus: 1 } },
    visual_preview: { thumb_160: 'https://s/a-160.webp', thumb_320: 'https://s/a-320.webp' },
    values: [
      { id: 'v1', slug: 'a', name: 'أ', visual: { shape: 'star', image: { mediaId: '0b9d6a3e-1f5c-4a8e-9a47-2c1d3e4f5a6b', crop: { x: 0 } } }, visual_version: 1, visual_preview: null },
      { id: 'v2', slug: 'b', name: 'ب', visual: null, visual_version: 4, visual_preview: null },
      { id: 'v3', slug: 'c', name: 'ج' },
    ],
  };

  it('maps the normalised document, the integer token and the signed previews', () => {
    const facet = mapFacet(raw);
    expect(facet?.visual).toEqual({ self: { shape: 'arch' }, defaults: { size: 'lg' } });
    expect(facet?.visualVersion).toBe(3);
    expect(facet?.visualPreview).toEqual({ thumb160: 'https://s/a-160.webp', thumb320: 'https://s/a-320.webp' });
    expect(facet?.values[0].visual).toEqual({ shape: 'star', image: { mediaId: '0b9d6a3e-1f5c-4a8e-9a47-2c1d3e4f5a6b' } });
  });

  it('a tombstone keeps its token with no document, and a legacy row has neither', () => {
    const facet = mapFacet(raw);
    expect(facet?.values[1]).toMatchObject({ visual: null, visualVersion: 4 });
    expect(facet?.values[2]).toMatchObject({ visual: null, visualVersion: null, visualPreview: null });
  });

  it('refuses a token that is not a positive integer', () => {
    expect(mapFacet({ ...raw, visual_version: '3' })?.visualVersion).toBeNull();
    expect(mapFacet({ ...raw, visual_version: 1.5 })?.visualVersion).toBeNull();
    expect(mapFacet({ ...raw, visual_version: 0 })?.visualVersion).toBeNull();
  });
});

describe('facet visual writes', () => {
  it('PUTs a dimension’s document with the exact body {visual, expected_version}', async () => {
    apiMock.mockResolvedValue({ data: { visual: { self: { shape: 'arch' } }, version: 4 } });
    const result = await saveFacetVisual('f1', { self: { shape: 'arch' } }, 3);

    expect(apiMock).toHaveBeenCalledWith(`${FACETS_PATH}/f1/visual`, {
      method: 'PUT',
      body: { visual: { self: { shape: 'arch' } }, expected_version: 3 },
    });
    expect(result).toEqual({ ok: true, visual: { self: { shape: 'arch' } }, version: 4 });
  });

  it('PUTs a value’s document on the value path', async () => {
    apiMock.mockResolvedValue({ data: { visual: { shape: 'star' }, version: 1 } });
    await saveFacetValueVisual('f1', 'v1', { shape: 'star' }, null);

    expect(apiMock).toHaveBeenCalledWith(`${FACETS_PATH}/f1/values/v1/visual`, {
      method: 'PUT',
      body: { visual: { shape: 'star' }, expected_version: null },
    });
  });

  it('sends the null tombstone as `visual: null`, keeping the token', async () => {
    apiMock.mockResolvedValue({ data: { visual: null, version: 5 } });
    const result = await saveFacetValueVisual('f1', 'v1', null, 4);

    expect(apiMock).toHaveBeenCalledWith(`${FACETS_PATH}/f1/values/v1/visual`, {
      method: 'PUT',
      body: { visual: null, expected_version: 4 },
    });
    expect(result).toEqual({ ok: true, visual: null, version: 5 });
  });

  it('the token is a JSON integer or null: anything else is refused before any request', async () => {
    for (const bad of [0, -1, 1.5, Number.NaN, '3', true]) {
      const result = await saveFacetValueVisual('f1', 'v1', { shape: 'star' }, bad as unknown as number);
      expect(result).toMatchObject({ ok: false, code: 'invalid_expected_version', status: null });
    }
    expect(apiMock).not.toHaveBeenCalled();
    // an integer-valued number serialises as a JSON integer
    apiMock.mockResolvedValue({ data: { visual: null, version: 2 } });
    await saveFacetVisual('f1', null, 1);
    expect(JSON.stringify(apiMock.mock.calls[0][1].body)).toBe('{"visual":null,"expected_version":1}');
  });

  it('surfaces 409 with the current version, 428 and a 422 with field errors instead of throwing', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(409, 'تغيّرت', { code: 'visual_version_conflict', current_version: 7 }));
    expect(await saveFacetVisual('f1', null, 3)).toEqual({
      ok: false, status: 409, code: 'visual_version_conflict', message: 'تغيّرت', currentVersion: 7, errors: {},
    });

    apiMock.mockRejectedValueOnce(new ApiError(428, 'مطلوب', { code: 'visual_precondition_required' }));
    expect(await saveFacetVisual('f1', null, null)).toMatchObject({ ok: false, status: 428, code: 'visual_precondition_required', currentVersion: null });

    apiMock.mockRejectedValueOnce(
      new ApiError(422, 'غير صالحة', { code: 'visual_invalid', errors: { 'visual.image.mediaId': ['media_not_ready'], 'visual.shape': ['unknown_shape', 5] } }),
    );
    expect(await saveFacetValueVisual('f1', 'v1', { shape: 'star' }, 2)).toMatchObject({
      ok: false, status: 422, code: 'visual_invalid',
      errors: { 'visual.image.mediaId': ['media_not_ready'], 'visual.shape': ['unknown_shape'] },
    });
  });

  it('a non-HTTP failure has a null status and no codes', async () => {
    apiMock.mockRejectedValue(new TypeError('network'));
    expect(await saveFacetVisual('f1', null, null)).toEqual({
      ok: false, status: null, code: null, message: null, currentVersion: null, errors: {},
    });
  });

  it('a success without a usable token is not reported as saved', async () => {
    apiMock.mockResolvedValue({ data: { visual: null } });
    expect(await saveFacetVisual('f1', null, null)).toMatchObject({ ok: false });
  });
});
