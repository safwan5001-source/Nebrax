import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';

const apiMock = vi.fn();
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: (...args: unknown[]) => apiMock(...args),
  };
});

import {
  commerceWorkspaceProductPath,
  commerceWorkspaceProductsPath,
  listWorkspaceProducts,
  showWorkspaceProduct,
} from './workspace-products';

afterEach(() => apiMock.mockReset());

function summaryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'منتج تجريبي',
    name_en: 'Sample Product',
    thumbnail_url: 'https://cdn.example.test/p1.jpg',
    is_variant_managed: false,
    ...overrides,
  };
}

function detailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'منتج تجريبي',
    name_en: 'Sample Product',
    description: 'وصف المنتج',
    sku: 'SKU-1',
    category: { id: 'c1', name: 'فئة' },
    price: { amount_minor: 12500, currency: 'SAR' },
    in_stock: true,
    thumbnail_url: 'https://cdn.example.test/p1.jpg',
    media: [{ id: 'm1', url: 'https://cdn.example.test/p1.jpg', alt: null, position: 0 }],
    is_variant_managed: false,
    options: null,
    variants: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('workspace-products client — CUST-H2-3', () => {
  it('builds paths without leaking a tenant id anywhere in the URL', () => {
    expect(commerceWorkspaceProductsPath('store-1')).toBe(
      '/commerce/workspace/storefronts/store-1/products',
    );
    expect(commerceWorkspaceProductPath('store-1', 'p1')).toBe(
      '/commerce/workspace/storefronts/store-1/products/p1',
    );
  });

  it('lists products and maps the minimal summary shape', async () => {
    apiMock.mockResolvedValue({
      data: [summaryRow(), summaryRow({ id: 'p2', name: 'منتج آخر' })],
      meta: { pagination: { page: 1, per_page: 20, total: 2, last_page: 1, has_more: false } },
    });

    const result = await listWorkspaceProducts('store-1');
    expect(result).toEqual({
      ok: true,
      hasMore: false,
      data: [
        {
          id: 'p1',
          name: 'منتج تجريبي',
          nameEn: 'Sample Product',
          thumbnailUrl: 'https://cdn.example.test/p1.jpg',
          isVariantManaged: false,
        },
        {
          id: 'p2',
          name: 'منتج آخر',
          nameEn: 'Sample Product',
          thumbnailUrl: 'https://cdn.example.test/p1.jpg',
          isVariantManaged: false,
        },
      ],
    });
    expect(apiMock).toHaveBeenCalledWith(
      '/commerce/workspace/storefronts/store-1/products',
      expect.objectContaining({}),
    );
  });

  it('sends search/page/per_page as query params only when provided', async () => {
    apiMock.mockResolvedValue({ data: [], meta: { pagination: { has_more: false } } });
    await listWorkspaceProducts('store-1', { search: 'زيت', page: 2, perPage: 10 });
    const [path] = apiMock.mock.calls[0];
    expect(path).toContain('/commerce/workspace/storefronts/store-1/products?');
    expect(path).toContain('search=');
    expect(path).toContain('page=2');
    expect(path).toContain('per_page=10');
  });

  it('sends sort=newest only when explicitly requested (CUST-H4-3)', async () => {
    apiMock.mockResolvedValue({ data: [], meta: { pagination: { has_more: false } } });
    await listWorkspaceProducts('store-1', { sort: 'newest', perPage: 8 });
    const [path] = apiMock.mock.calls[0];
    expect(path).toContain('sort=newest');
    expect(path).toContain('per_page=8');

    apiMock.mockClear();
    await listWorkspaceProducts('store-1');
    const [defaultPath] = apiMock.mock.calls[0];
    expect(defaultPath).not.toContain('sort=');
  });

  it('sends ids[] as repeated query params only when provided (CUST-H4-5)', async () => {
    apiMock.mockResolvedValue({ data: [], meta: { pagination: { has_more: false } } });
    await listWorkspaceProducts('store-1', { ids: ['p1', 'p2'] });
    const [path] = apiMock.mock.calls[0];
    expect(path).toContain('ids%5B%5D=p1');
    expect(path).toContain('ids%5B%5D=p2');

    apiMock.mockClear();
    await listWorkspaceProducts('store-1');
    const [defaultPath] = apiMock.mock.calls[0];
    expect(defaultPath).not.toContain('ids');
  });

  it('sends no ids[] param at all for an empty ids array', async () => {
    apiMock.mockResolvedValue({ data: [], meta: { pagination: { has_more: false } } });
    await listWorkspaceProducts('store-1', { ids: [] });
    const [path] = apiMock.mock.calls[0];
    expect(path).not.toContain('ids');
  });

  it('classifies a 404 as not_found without throwing', async () => {
    apiMock.mockRejectedValue(new ApiError(404, 'not found', {}));
    const result = await listWorkspaceProducts('store-1');
    expect(result).toEqual({ ok: false, reason: 'not_found', message: 'not found' });
  });

  it('classifies a 403 as forbidden', async () => {
    apiMock.mockRejectedValue(new ApiError(403, 'forbidden', {}));
    const result = await listWorkspaceProducts('store-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('forbidden');
  });

  it('rejects a malformed list payload rather than crashing on a bad row', async () => {
    apiMock.mockResolvedValue({ data: [{ id: 'p1' /* missing name */ }] });
    const result = await listWorkspaceProducts('store-1');
    expect(result).toEqual({ ok: false, reason: 'failed', message: 'invalid_payload' });
  });

  it('shows a product detail and maps the full safe shape', async () => {
    apiMock.mockResolvedValue({ data: detailRow() });
    const result = await showWorkspaceProduct('store-1', 'p1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      id: 'p1',
      name: 'منتج تجريبي',
      nameEn: 'Sample Product',
      description: 'وصف المنتج',
      sku: 'SKU-1',
      categoryName: 'فئة',
      priceAmountMinor: 12500,
      currency: 'SAR',
      inStock: true,
      media: [{ id: 'm1', url: 'https://cdn.example.test/p1.jpg', alt: null }],
      isVariantManaged: false,
      options: null,
      variants: null,
    });
  });

  it('maps a variant-managed product detail with options and variants', async () => {
    apiMock.mockResolvedValue({
      data: detailRow({
        is_variant_managed: true,
        options: [
          {
            id: 'opt1',
            name: 'اللون',
            name_en: 'Color',
            values: [{ id: 'v1', value: 'أحمر', value_en: 'Red' }],
          },
        ],
        variants: [
          {
            id: 'var1',
            sku: 'SKU-1-RED',
            option_value_ids: ['v1'],
            price: { amount_minor: 12500, currency: 'SAR' },
            in_stock: true,
            media: [],
          },
        ],
      }),
    });

    const result = await showWorkspaceProduct('store-1', 'p1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.isVariantManaged).toBe(true);
    expect(result.data.options).toEqual([
      { id: 'opt1', name: 'اللون', nameEn: 'Color', values: [{ id: 'v1', value: 'أحمر', valueEn: 'Red' }] },
    ]);
    expect(result.data.variants).toEqual([
      {
        id: 'var1',
        sku: 'SKU-1-RED',
        optionValueIds: ['v1'],
        priceAmountMinor: 12500,
        currency: 'SAR',
        inStock: true,
        media: [],
      },
    ]);
  });

  it('classifies a foreign/ineligible product 404 as not_found', async () => {
    apiMock.mockRejectedValue(new ApiError(404, 'not found', {}));
    const result = await showWorkspaceProduct('store-1', 'foreign-product');
    expect(result).toEqual({ ok: false, reason: 'not_found', message: 'not found' });
  });

  it('never fabricates data on an unexpected/network failure', async () => {
    apiMock.mockRejectedValue(new Error('network down'));
    const result = await showWorkspaceProduct('store-1', 'p1');
    expect(result).toEqual({ ok: false, reason: 'failed', message: 'network down' });
  });
});
