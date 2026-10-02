/**
 * @vitest-environment jsdom
 *
 * CUST-H4-3 — real Canvas catalog parity for the Home "categories"/
 * "newArrivals" sections. Before this slice, `StorefrontPreviewCanvas`
 * rendered the static `PREVIEW_CATEGORIES`/`PREVIEW_PRODUCTS` fixtures for
 * these two sections specifically (see `preview-fixtures.ts`'s own
 * "fixtures so they cannot be read as the live store" comment). This file
 * proves the fixtures are no longer used for these two sections, real
 * tenant/storefront-scoped workspace data renders instead, and the
 * loading/empty/error/stale-response contract the task requires holds.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listMock = vi.fn();
const showMock = vi.fn();

vi.mock('@/modules/commerce-workspace/presentation-versions', () => ({
  listPresentationVersions: (...args: unknown[]) => listMock(...args),
  showPresentationVersion: (...args: unknown[]) => showMock(...args),
  createPresentationVersion: vi.fn(),
  savePresentationVersion: vi.fn(),
  renamePresentationVersion: vi.fn(),
  deletePresentationVersion: vi.fn(),
}));

const listProductsMock = vi.fn();
const showProductMock = vi.fn();

vi.mock('@/modules/commerce-workspace/workspace-products', () => ({
  listWorkspaceProducts: (...args: unknown[]) => listProductsMock(...args),
  showWorkspaceProduct: (...args: unknown[]) => showProductMock(...args),
}));

const listCategoriesMock = vi.fn();
const showCategoryMock = vi.fn();

vi.mock('@/modules/commerce-workspace/workspace-categories', () => ({
  listWorkspaceCategories: (...args: unknown[]) => listCategoriesMock(...args),
  showWorkspaceCategory: (...args: unknown[]) => showCategoryMock(...args),
}));

import { DEFAULT_PRESENTATION_CONFIG } from '../presentation';
import { ExperienceBuilder } from '../ExperienceBuilder';

function versionSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'v1',
    storefrontId: 'store-1',
    name: 'Current design',
    state: 'draft',
    schemaVersion: 3,
    revision: 5,
    scheduledFor: null,
    lastPublishedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    publishedRevision: null,
    scheduleToken: 'opaque-token-0',
    schedulingRuntimeActive: true,
    ...overrides,
  };
}

function versionDetail(overrides: Record<string, unknown> = {}) {
  const { config, ...rest } = overrides;
  return { ...versionSummary(rest), config: config ?? DEFAULT_PRESENTATION_CONFIG };
}

// These mock the already-mapped client shape (`WorkspaceCategorySummary`/
// `WorkspaceProductSummary`), not the raw snake_case API payload — the test
// mocks the whole `workspace-categories`/`workspace-products` client
// modules, not the underlying `api()` fetch, so `listCategoriesMock`/
// `listProductsMock` stand in for `listWorkspaceCategories`/
// `listWorkspaceProducts` themselves.
function categoryRow(overrides: Record<string, unknown> = {}) {
  return { id: 'c1', name: 'فئة اختبار حقيقية', parentId: null, parentName: null, ...overrides };
}

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'كرسي مكتب حقيقي',
    nameEn: 'Real office chair',
    thumbnailUrl: 'https://cdn.example.test/p1.jpg',
    isVariantManaged: false,
    ...overrides,
  };
}

// The exact Arabic strings `preview-fixtures.ts` used to hardcode for these
// two sections — if any of these render inside the categories/newArrivals
// sections, the mock fixture is still leaking through.
const FIXTURE_CATEGORY_NAMES = ['الإلكترونيات', 'المنزل', 'العناية', 'الأزياء', 'المكتب', 'الرياضة'];
const FIXTURE_PRODUCT_NAMES = ['سماعات لاسلكية', 'إبريق ترشيح', 'كريم عناية', 'قميص كتان', 'دفتر ملاحظات', 'زجاجة ماء'];

function categoriesSection(): HTMLElement | null {
  return document.querySelector('section[aria-labelledby="preview-categories"]');
}

function newArrivalsSection(): HTMLElement | null {
  return document.querySelector('section[aria-labelledby="preview-arrivals"]');
}

describe('ExperienceBuilder — CUST-H4-3 real Home catalog preview', () => {
  beforeEach(() => {
    listMock.mockResolvedValue({ ok: true, data: [versionSummary()] });
    showMock.mockResolvedValue({ ok: true, data: versionDetail() });
    listProductsMock.mockResolvedValue({ ok: true, data: [], hasMore: false });
    showProductMock.mockResolvedValue({ ok: false, reason: 'not_found', message: 'not found' });
    listCategoriesMock.mockResolvedValue({ ok: true, data: [], hasMore: false });
    showCategoryMock.mockResolvedValue({ ok: false, reason: 'not_found', message: 'not found' });
  });

  afterEach(() => {
    cleanup();
    listMock.mockReset();
    showMock.mockReset();
    listProductsMock.mockReset();
    showProductMock.mockReset();
    listCategoriesMock.mockReset();
    showCategoryMock.mockReset();
  });

  it('renders real workspace categories/products, never the removed static fixtures', async () => {
    listCategoriesMock.mockResolvedValue({ ok: true, data: [categoryRow()], hasMore: false });
    listProductsMock.mockResolvedValue({ ok: true, data: [productRow()], hasMore: false });

    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(listCategoriesMock).toHaveBeenCalled());
    await waitFor(() => expect(listProductsMock).toHaveBeenCalled());

    await waitFor(() => expect(categoriesSection()?.textContent).toContain('فئة اختبار حقيقية'));
    expect(newArrivalsSection()?.textContent).toContain('كرسي مكتب حقيقي');

    for (const fake of FIXTURE_CATEGORY_NAMES) {
      expect(categoriesSection()?.textContent ?? '').not.toContain(fake);
    }
    for (const fake of FIXTURE_PRODUCT_NAMES) {
      expect(newArrivalsSection()?.textContent ?? '').not.toContain(fake);
    }

    // Real image comes from the workspace resource, not an invented asset.
    const img = newArrivalsSection()?.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://cdn.example.test/p1.jpg');
  });

  it('uses the tenant/storefront-scoped workspace reads with the right params: no search, sort=newest for products, rootOnly=true for categories', async () => {
    render(<ExperienceBuilder storefrontId="store-42" initialLocale="ar" />);
    await waitFor(() => expect(listCategoriesMock).toHaveBeenCalled());
    await waitFor(() => expect(listProductsMock).toHaveBeenCalledWith(
      'store-42',
      expect.objectContaining({ sort: 'newest', perPage: 8 }),
    ));
    // CUST-H4-3 (parity fix) — root-category scoping is a real,
    // server-side filter requested via `rootOnly: true`, not a client-side
    // `.filter()` over a larger fetched page.
    expect(listCategoriesMock).toHaveBeenCalledWith('store-42', expect.objectContaining({ rootOnly: true, perPage: 12 }));
  });

  it('relies on the server-side root-only filter rather than filtering a mixed-depth page on the client', async () => {
    // Mirrors exactly what the real backend returns for `root_only=true`
    // (CommerceWorkspaceStorefrontCategoryApiTest's own
    // `root_only_true_returns_only_categories_with_a_null_parent`): only
    // root rows, never a mixed page Canvas would need to filter itself.
    listCategoriesMock.mockResolvedValue({
      ok: true,
      hasMore: false,
      data: [categoryRow({ id: 'root-1', name: 'تصنيف رئيسي' })],
    });

    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(categoriesSection()?.textContent).toContain('تصنيف رئيسي'));
    await waitFor(() => expect(listCategoriesMock).toHaveBeenCalledWith(
      'store-1',
      expect.objectContaining({ rootOnly: true }),
    ));
    // Canvas renders exactly what the (mocked) server returned — it never
    // re-derives root-ness itself from a `parentId` field.
    expect(categoriesSection()?.querySelectorAll('li').length).toBe(1);
  });

  it('renders an honest empty state for real-but-empty catalog data, never fake content', async () => {
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(document.querySelector('[data-home-categories-empty]')).not.toBeNull());
    await waitFor(() => expect(document.querySelector('[data-home-new-arrivals-empty]')).not.toBeNull());
    expect(document.querySelector('[data-home-categories-error]')).toBeNull();
    expect(document.querySelector('[data-home-new-arrivals-error]')).toBeNull();
  });

  it('shows a retry affordance on a request error, never a fallback to fake data', async () => {
    listCategoriesMock.mockResolvedValueOnce({ ok: false, reason: 'failed', message: 'network down' });
    listProductsMock.mockResolvedValueOnce({ ok: false, reason: 'failed', message: 'network down' });

    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(document.querySelector('[data-home-categories-error]')).not.toBeNull());
    await waitFor(() => expect(document.querySelector('[data-home-new-arrivals-error]')).not.toBeNull());

    for (const fake of FIXTURE_CATEGORY_NAMES) {
      expect(categoriesSection()?.textContent ?? '').not.toContain(fake);
    }
    for (const fake of FIXTURE_PRODUCT_NAMES) {
      expect(newArrivalsSection()?.textContent ?? '').not.toContain(fake);
    }

    // Retry recovers honestly once the network call succeeds.
    listCategoriesMock.mockResolvedValue({ ok: true, hasMore: false, data: [categoryRow({ name: 'عاد الآن' })] });
    const retryButtons = screen.getAllByText('إعادة المحاولة');
    retryButtons[0].click();
    await waitFor(() => expect(categoriesSection()?.textContent).toContain('عاد الآن'));
  });

  it('does not issue a redundant duplicate fetch once a section has loaded', async () => {
    listCategoriesMock.mockResolvedValue({ ok: true, hasMore: false, data: [categoryRow()] });
    listProductsMock.mockResolvedValue({ ok: true, hasMore: false, data: [productRow()] });

    const { rerender } = render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(categoriesSection()?.textContent).toContain('فئة اختبار حقيقية'));
    await waitFor(() => expect(newArrivalsSection()?.textContent).toContain('كرسي مكتب حقيقي'));

    const categoriesCallsAfterLoad = listCategoriesMock.mock.calls.length;
    const productsCallsAfterLoad = listProductsMock.mock.calls.length;

    // An unrelated re-render (same storefront/version) must not trigger a
    // second identical request for data that is already loaded.
    rerender(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listCategoriesMock.mock.calls.length).toBe(categoriesCallsAfterLoad);
    expect(listProductsMock.mock.calls.length).toBe(productsCallsAfterLoad);
  });

  it('a storefront switch cancels the stale request and never displays the previous store\'s categories/products', async () => {
    let resolveStore1: (value: unknown) => void = () => {};
    const pendingStore1 = new Promise((resolve) => {
      resolveStore1 = resolve;
    });
    listCategoriesMock.mockImplementation((storefrontId: string) => {
      if (storefrontId === 'store-1') return pendingStore1;
      return Promise.resolve({ ok: true, hasMore: false, data: [categoryRow({ name: 'متجر جديد' })] });
    });

    const { rerender } = render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(listCategoriesMock).toHaveBeenCalledWith('store-1', expect.anything()));

    // Switch to a different storefront before store-1's slow response lands.
    rerender(<ExperienceBuilder storefrontId="store-2" initialLocale="ar" />);
    await waitFor(() => expect(listCategoriesMock).toHaveBeenCalledWith('store-2', expect.anything()));
    await waitFor(() => expect(categoriesSection()?.textContent).toContain('متجر جديد'));

    // The slow store-1 response now resolves — it must not overwrite the
    // already-rendered store-2 data.
    resolveStore1({ ok: true, hasMore: false, data: [categoryRow({ name: 'متجر قديم يجب ألا يظهر' })] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(categoriesSection()?.textContent).toContain('متجر جديد');
    expect(categoriesSection()?.textContent ?? '').not.toContain('متجر قديم يجب ألا يظهر');
  });

  it('does not fetch the Home catalog preview when the corresponding section has been removed from the homepage', async () => {
    const configWithoutCatalogSections = {
      ...DEFAULT_PRESENTATION_CONFIG,
      homepage: {
        ...DEFAULT_PRESENTATION_CONFIG.homepage,
        sections: DEFAULT_PRESENTATION_CONFIG.homepage.sections.map((section) =>
          section.type === 'categories' || section.type === 'newArrivals'
            ? { ...section, visible: false }
            : section,
        ),
      },
    };
    listMock.mockResolvedValue({ ok: true, data: [versionSummary()] });
    showMock.mockResolvedValue({ ok: true, data: versionDetail({ config: configWithoutCatalogSections }) });

    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listCategoriesMock).not.toHaveBeenCalled();
    expect(listProductsMock).not.toHaveBeenCalled();
  });
});
