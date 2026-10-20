import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';

const apiMock = vi.fn();
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

import { commerceWorkspaceSectionDataPath, fetchWorkspaceSectionData } from './workspace-section-data';

afterEach(() => apiMock.mockReset());

describe('workspace section-data client — FLOWERS-H9c', () => {
  it('uses only the storefront-scoped route and maps product shelves', async () => {
    apiMock.mockResolvedValue({ data: [{ id: 'p1', name: 'Rose', thumbnail_url: null, is_variant_managed: false, price: { amount_minor: 0, currency: 'SAR' }, in_stock: false }] });
    const result = await fetchWorkspaceSectionData('store-1', { section: 'product_shelf', source_kind: 'collection', source_slug: 'roses', limit: 8 });
    expect(result).toEqual({ ok: true, section: 'product_shelf', products: [{ id: 'p1', name: 'Rose', nameEn: null, thumbnailUrl: null, isVariantManaged: false, priceAmountMinor: 0, currency: 'SAR', inStock: false }] });
    expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('/commerce/workspace/storefronts/store-1/section-data?'), expect.objectContaining({}));
    expect(commerceWorkspaceSectionDataPath('store/1')).toBe('/commerce/workspace/storefronts/store%2F1/section-data');
  });

  it('maps discovery and delivery data without inventing a missing value', async () => {
    apiMock.mockResolvedValueOnce({ data: { axis: 'facet', dimension: 'occasion', name: 'Occasion', name_en: 'Occasion', visual: null, options: [{ value: 'birthday', name: 'عيد ميلاد', name_en: 'Birthday', count: 2, visual: null }] } });
    await expect(fetchWorkspaceSectionData('store-1', { section: 'discovery', axis: 'facet', dimension: 'occasion' })).resolves.toMatchObject({ ok: true, section: 'discovery', discovery: { options: [{ value: 'birthday', count: 2 }] } });
    apiMock.mockResolvedValueOnce({ data: { earliest: null } });
    await expect(fetchWorkspaceSectionData('store-1', { section: 'delivery_promise' })).resolves.toEqual({ ok: true, section: 'delivery_promise', earliest: null });
  });

  it('keeps authorization failures closed', async () => {
    apiMock.mockRejectedValue(new ApiError(403, 'forbidden', {}));
    await expect(fetchWorkspaceSectionData('store-1', { section: 'delivery_promise' })).resolves.toEqual({ ok: false, reason: 'forbidden', message: 'forbidden' });
  });
});
