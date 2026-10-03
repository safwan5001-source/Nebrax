/**
 * @vitest-environment jsdom
 *
 * CUST-H4-5 — Featured Products real picker + batched product read.
 * Before this slice, the Home "featured" section's Canvas preview showed
 * only raw id text chips, and the editor was a raw product-id text input.
 * This file proves: one batched `ids[]` read per Featured section instance
 * (never N per-product fetches), stored-order restoration, honest
 * loading/empty/error states, stale-response protection, and that multiple
 * Featured section instances resolve independently.
 */
import { cleanup, render, waitFor } from '@testing-library/react';
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

import { DEFAULT_PRESENTATION_CONFIG, type StorefrontPresentationConfig } from '../presentation';
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

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'منتج مميّز حقيقي',
    nameEn: 'Real featured product',
    thumbnailUrl: 'https://cdn.example.test/p1.jpg',
    isVariantManaged: false,
    ...overrides,
  };
}

/** Builds a config whose Home page has exactly one extra "featured" section with the given productIds, appended after the defaults. */
function configWithFeatured(
  productIds: string[],
  extraSections: Array<{ id: string; productIds: string[] }> = [],
): StorefrontPresentationConfig {
  return {
    ...DEFAULT_PRESENTATION_CONFIG,
    homepage: {
      ...DEFAULT_PRESENTATION_CONFIG.homepage,
      sections: [
        ...DEFAULT_PRESENTATION_CONFIG.homepage.sections,
        { id: 'featured-1', type: 'featured' as const, visible: true, content: { productIds } },
        ...extraSections.map((s) => ({
          id: s.id,
          type: 'featured' as const,
          visible: true,
          content: { productIds: s.productIds },
        })),
      ],
    },
  };
}

function featuredSection(sectionId = 'featured-1'): HTMLElement | null {
  return document.querySelector(`section[aria-labelledby="preview-featured-${sectionId}"]`);
}

describe('ExperienceBuilder — CUST-H4-5 Featured batched read', () => {
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

  it('resolves selected ids with exactly one batched ids[] request, not one per product', async () => {
    showMock.mockResolvedValue({ ok: true, data: versionDetail({ config: configWithFeatured(['p1', 'p2', 'p3']) }) });
    listProductsMock.mockImplementation((_id: string, params: Record<string, unknown>) => {
      if (params?.ids) {
        return Promise.resolve({
          ok: true,
          hasMore: false,
          data: [productRow({ id: 'p1' }), productRow({ id: 'p2', name: 'الثاني' }), productRow({ id: 'p3', name: 'الثالث' })],
        });
      }
      return Promise.resolve({ ok: true, data: [], hasMore: false });
    });

    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(featuredSection()?.textContent).toContain('منتج مميّز حقيقي'));

    const idsCalls = listProductsMock.mock.calls.filter(([, params]) => params?.ids);
    expect(idsCalls).toHaveLength(1);
    expect(idsCalls[0][1]).toMatchObject({ ids: ['p1', 'p2', 'p3'] });
  });

  it('renders real image/name from the batched read, never the bare id', async () => {
    showMock.mockResolvedValue({ ok: true, data: versionDetail({ config: configWithFeatured(['p1']) }) });
    listProductsMock.mockImplementation((_id: string, params: Record<string, unknown>) =>
      params?.ids
        ? Promise.resolve({ ok: true, hasMore: false, data: [productRow()] })
        : Promise.resolve({ ok: true, data: [], hasMore: false }),
    );

    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(featuredSection()?.textContent).toContain('منتج مميّز حقيقي'));
    expect(featuredSection()?.textContent ?? '').not.toContain('p1');
    const img = featuredSection()?.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://cdn.example.test/p1.jpg');
  });

  it('restores the merchant-stored productIds order even when the API answers in a different order', async () => {
    showMock.mockResolvedValue({ ok: true, data: versionDetail({ config: configWithFeatured(['p1', 'p2', 'p3']) }) });
    listProductsMock.mockImplementation((_id: string, params: Record<string, unknown>) =>
      params?.ids
        ? Promise.resolve({
            ok: true,
            hasMore: false,
            // Database/API order deliberately scrambled relative to the stored array.
            data: [productRow({ id: 'p3', name: 'ثالث' }), productRow({ id: 'p1', name: 'أول' }), productRow({ id: 'p2', name: 'ثانٍ' })],
          })
        : Promise.resolve({ ok: true, data: [], hasMore: false }),
    );

    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(featuredSection()?.textContent).toContain('ثالث'));
    const names = Array.from(featuredSection()?.querySelectorAll('li p') ?? []).map((el) => el.textContent);
    expect(names).toEqual(['أول', 'ثانٍ', 'ثالث']);
  });

  it('omits a selected id missing from the batched result, without a placeholder', async () => {
    showMock.mockResolvedValue({ ok: true, data: versionDetail({ config: configWithFeatured(['p1', 'p2']) }) });
    listProductsMock.mockImplementation((_id: string, params: Record<string, unknown>) =>
      params?.ids
        // p2 is foreign/unpublished/deleted — absent from the result.
        ? Promise.resolve({ ok: true, hasMore: false, data: [productRow({ id: 'p1' })] })
        : Promise.resolve({ ok: true, data: [], hasMore: false }),
    );

    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(featuredSection()?.textContent).toContain('منتج مميّز حقيقي'));
    expect(featuredSection()?.querySelectorAll('li').length).toBe(1);
  });

  it('renders an honest empty state when no products are selected, with no fetch issued', async () => {
    showMock.mockResolvedValue({ ok: true, data: versionDetail({ config: configWithFeatured([]) }) });

    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(document.querySelector('[data-home-featured-empty]')).not.toBeNull());
    expect(listProductsMock.mock.calls.filter(([, params]) => params?.ids)).toHaveLength(0);
  });

  it('shows a retry affordance on a batched-read error, never fake content', async () => {
    showMock.mockResolvedValue({ ok: true, data: versionDetail({ config: configWithFeatured(['p1']) }) });
    listProductsMock.mockImplementation((_id: string, params: Record<string, unknown>) =>
      params?.ids
        ? Promise.resolve({ ok: false, reason: 'failed', message: 'network down' })
        : Promise.resolve({ ok: true, data: [], hasMore: false }),
    );

    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(document.querySelector('[data-home-featured-error]')).not.toBeNull());

    listProductsMock.mockImplementation((_id: string, params: Record<string, unknown>) =>
      params?.ids
        ? Promise.resolve({ ok: true, hasMore: false, data: [productRow({ name: 'عاد الآن' })] })
        : Promise.resolve({ ok: true, data: [], hasMore: false }),
    );
    const retryButton = document.querySelector('[data-home-featured-error] button') as HTMLButtonElement;
    retryButton.click();
    await waitFor(() => expect(featuredSection()?.textContent).toContain('عاد الآن'));
  });

  it('does not re-fetch when the selection has not changed across an unrelated re-render', async () => {
    showMock.mockResolvedValue({ ok: true, data: versionDetail({ config: configWithFeatured(['p1']) }) });
    listProductsMock.mockImplementation((_id: string, params: Record<string, unknown>) =>
      params?.ids
        ? Promise.resolve({ ok: true, hasMore: false, data: [productRow()] })
        : Promise.resolve({ ok: true, data: [], hasMore: false }),
    );

    const { rerender } = render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(featuredSection()?.textContent).toContain('منتج مميّز حقيقي'));
    const callsAfterLoad = listProductsMock.mock.calls.filter(([, params]) => params?.ids).length;

    rerender(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listProductsMock.mock.calls.filter(([, params]) => params?.ids).length).toBe(callsAfterLoad);
  });

  it('resolves two Featured section instances independently, one batched request each', async () => {
    showMock.mockResolvedValue({
      ok: true,
      data: versionDetail({
        config: configWithFeatured(['p1'], [{ id: 'featured-2', productIds: ['p9'] }]),
      }),
    });
    listProductsMock.mockImplementation((_id: string, params: Record<string, unknown>) => {
      if (!params?.ids) return Promise.resolve({ ok: true, data: [], hasMore: false });
      const ids = params.ids as string[];
      if (ids.includes('p1')) return Promise.resolve({ ok: true, hasMore: false, data: [productRow({ id: 'p1', name: 'الأول' })] });
      return Promise.resolve({ ok: true, hasMore: false, data: [productRow({ id: 'p9', name: 'التاسع' })] });
    });

    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(featuredSection('featured-1')?.textContent).toContain('الأول'));
    await waitFor(() => expect(featuredSection('featured-2')?.textContent).toContain('التاسع'));

    const idsCalls = listProductsMock.mock.calls.filter(([, params]) => params?.ids);
    expect(idsCalls).toHaveLength(2);
  });

  it('a slow superseded resolution never overwrites the result of a newer selection edit', async () => {
    // Stale-response protection: selecting the section fires fetch #1
    // (ids=['p1'], held pending). Before it answers, the merchant adds a
    // second product via the real picker UI, firing fetch #2
    // (ids=['p1','p2'], resolves fast). `loadFeaturedResolution` bumps the
    // per-section request token on every call, so #1's late answer must be
    // discarded rather than clobbering #2's already-rendered result.
    showMock.mockResolvedValue({ ok: true, data: versionDetail({ config: configWithFeatured(['p1']) }) });
    let resolveFirst: (value: unknown) => void = () => {};
    const pendingFirst = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    let idsCallCount = 0;
    listProductsMock.mockImplementation((_id: string, params: Record<string, unknown>) => {
      if (params?.ids) {
        idsCallCount += 1;
        if (idsCallCount === 1) return pendingFirst;
        return Promise.resolve({
          ok: true,
          hasMore: false,
          data: [productRow({ id: 'p1', name: 'الأول' }), productRow({ id: 'p2', name: 'الثاني الجديد' })],
        });
      }
      // The picker's own candidate search list (no `ids` filter).
      return Promise.resolve({
        ok: true,
        hasMore: false,
        data: [productRow({ id: 'p1', name: 'الأول' }), productRow({ id: 'p2', name: 'الثاني الجديد' })],
      });
    });

    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(document.querySelector('[data-preview-section-id="featured-1"]')).not.toBeNull());
    document.querySelector('[data-preview-section-id="featured-1"]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    await waitFor(() => expect(listProductsMock).toHaveBeenCalledWith('store-1', expect.objectContaining({ ids: ['p1'] })));
    await waitFor(() => expect(document.querySelector('[data-featured-option="p2"]')).not.toBeNull());

    document.querySelector('[data-featured-option="p2"]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    await waitFor(() => expect(listProductsMock).toHaveBeenCalledWith('store-1', expect.objectContaining({ ids: ['p1', 'p2'] })));
    await waitFor(() => expect(featuredSection()?.textContent).toContain('الثاني الجديد'));

    resolveFirst({ ok: true, hasMore: false, data: [productRow({ id: 'p1', name: 'نتيجة قديمة يجب ألا تظهر' })] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(featuredSection()?.textContent).toContain('الثاني الجديد');
    expect(featuredSection()?.textContent ?? '').not.toContain('نتيجة قديمة يجب ألا تظهر');
  });
});
