/**
 * @vitest-environment jsdom
 *
 * CUST-H2-4 — Category page structured editing: Preview Category picker,
 * region visibility/reorder, required-region invariants, the real
 * `product_grid` preview (category_id-filtered Workspace Product reads),
 * Save/dirty semantics, Published read-only, and page-switch draft
 * preservation. `ExperienceBuilder.pageNavigator.test.tsx` already covers
 * Home unchanged; `ExperienceBuilder.productRegions.test.tsx` (still green,
 * unmodified by this slice) covers the Product editor unchanged — neither
 * is duplicated here.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listMock = vi.fn();
const showMock = vi.fn();
const saveMock = vi.fn();

vi.mock('@/modules/commerce-workspace/presentation-versions', () => ({
  listPresentationVersions: (...args: unknown[]) => listMock(...args),
  showPresentationVersion: (...args: unknown[]) => showMock(...args),
  createPresentationVersion: vi.fn(),
  savePresentationVersion: (...args: unknown[]) => saveMock(...args),
  renamePresentationVersion: vi.fn(),
  deletePresentationVersion: vi.fn(),
}));

const listCategoriesMock = vi.fn();
const showCategoryMock = vi.fn();

vi.mock('@/modules/commerce-workspace/workspace-categories', () => ({
  listWorkspaceCategories: (...args: unknown[]) => listCategoriesMock(...args),
  showWorkspaceCategory: (...args: unknown[]) => showCategoryMock(...args),
}));

// The Category page's `product_grid` region fetches real, category_id-
// filtered products via the same Workspace Product API H2-3 built. Default
// to an honest empty grid unless a test explicitly seeds products.
const listProductsMock = vi.fn();
const showProductMock = vi.fn();

vi.mock('@/modules/commerce-workspace/workspace-products', () => ({
  listWorkspaceProducts: (...args: unknown[]) => listProductsMock(...args),
  showWorkspaceProduct: (...args: unknown[]) => showProductMock(...args),
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

function categorySummary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cat-1',
    name: 'Bikes',
    parentId: null,
    parentName: null,
    ...overrides,
  };
}

function categoryDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cat-1',
    name: 'Bikes',
    description: 'Two-wheeled transport.',
    parentId: null,
    children: [{ id: 'cat-2', name: 'Road bikes' }],
    ancestors: [],
    ...overrides,
  };
}

function builderRoot(): HTMLElement {
  return document.querySelector('[data-experience-builder]') as HTMLElement;
}

function regionRow(key: string): HTMLElement {
  return document.querySelector(`[data-category-region-row="${key}"]`) as HTMLElement;
}

async function goToCategoryPage(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText('Page currently being viewed'));
  await user.click(screen.getByRole('button', { name: 'Category page' }));
}

describe('ExperienceBuilder — CUST-H2-4 Category page structured editing', () => {
  beforeEach(() => {
    listMock.mockResolvedValue({ ok: true, data: [versionSummary()] });
    showMock.mockResolvedValue({ ok: true, data: versionDetail() });
    listProductsMock.mockResolvedValue({ ok: true, hasMore: false, data: [] });
  });

  afterEach(() => {
    cleanup();
    listMock.mockReset();
    showMock.mockReset();
    saveMock.mockReset();
    listCategoriesMock.mockReset();
    showCategoryMock.mockReset();
    listProductsMock.mockReset();
    showProductMock.mockReset();
  });

  it('1. loads the first eligible Category deterministically', async () => {
    listCategoriesMock.mockResolvedValue({
      ok: true,
      hasMore: false,
      data: [categorySummary({ id: 'cat-1', name: 'A' }), categorySummary({ id: 'cat-2', name: 'B' })],
    });
    showCategoryMock.mockResolvedValue({ ok: true, data: categoryDetail() });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));

    await goToCategoryPage(user);
    await waitFor(() => expect(showCategoryMock).toHaveBeenCalledWith('store-1', 'cat-1'));
  });

  it('2/3. selecting a preview Category is not written to config and does not dirty the Version', async () => {
    listCategoriesMock.mockResolvedValue({
      ok: true,
      hasMore: false,
      data: [categorySummary({ id: 'cat-1', name: 'A' }), categorySummary({ id: 'cat-2', name: 'B' })],
    });
    showCategoryMock.mockImplementation(async (_storefrontId: string, id: string) => ({
      ok: true,
      data: categoryDetail({ id, name: id === 'cat-2' ? 'B' : 'A' }),
    }));
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));

    await goToCategoryPage(user);
    await waitFor(() => expect(listCategoriesMock).toHaveBeenCalled());
    expect(builderRoot().getAttribute('data-lifecycle')).toBe('clean');

    await user.click(screen.getByLabelText('Preview category'));
    await user.click(screen.getByRole('option', { name: /B/ }));
    await waitFor(() => expect(showCategoryMock).toHaveBeenCalledWith('store-1', 'cat-2'));

    expect(builderRoot().getAttribute('data-lifecycle')).toBe('clean');
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('4. shows an honest empty state when the store has zero eligible Categories', async () => {
    listCategoriesMock.mockResolvedValue({ ok: true, hasMore: false, data: [] });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));

    await goToCategoryPage(user);
    await waitFor(() =>
      expect(document.querySelector('[data-category-preview-state="empty"]')).not.toBeNull(),
    );
    expect(showCategoryMock).not.toHaveBeenCalled();
  });

  async function renderReady(user: ReturnType<typeof userEvent.setup>, detailOverrides: Record<string, unknown> = {}) {
    listCategoriesMock.mockResolvedValue({ ok: true, hasMore: false, data: [categorySummary()] });
    showCategoryMock.mockResolvedValue({ ok: true, data: categoryDetail(detailOverrides) });
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));
    await goToCategoryPage(user);
    await waitFor(() =>
      expect(document.querySelector('[data-category-preview="ready"]')).not.toBeNull(),
    );
  }

  it('5/6. required regions expose no visibility toggle and no move controls', async () => {
    const user = userEvent.setup();
    await renderReady(user);
    await user.click(screen.getByRole('button', { name: 'Category page structure' }));

    for (const key of ['breadcrumbs', 'identity_title', 'filter_sort_bar', 'product_grid']) {
      const row = regionRow(key);
      expect(row).not.toBeNull();
      expect(within(row).queryByRole('checkbox')).toBeNull();
      expect(within(row).queryByRole('button', { name: 'Up' })).toBeNull();
      expect(within(row).queryByRole('button', { name: 'Down' })).toBeNull();
    }
  });

  it('7. the optional description region can be hidden and shown again, updating the Canvas', async () => {
    const user = userEvent.setup();
    await renderReady(user);
    await user.click(screen.getByRole('button', { name: 'Category page structure' }));

    expect(document.querySelector('[data-preview-category-region="description"]')).not.toBeNull();
    await user.click(within(regionRow('description')).getByRole('checkbox'));
    expect(builderRoot().getAttribute('data-lifecycle')).toBe('dirty');
    expect(document.querySelector('[data-preview-category-region="description"]')).toBeNull();

    await user.click(within(regionRow('description')).getByRole('checkbox'));
    expect(document.querySelector('[data-preview-category-region="description"]')).not.toBeNull();
  });

  it('8. the optional subcategories_rail region can be hidden and shown again', async () => {
    const user = userEvent.setup();
    await renderReady(user);
    await user.click(screen.getByRole('button', { name: 'Category page structure' }));

    expect(document.querySelector('[data-preview-category-region="subcategories_rail"]')).not.toBeNull();
    await user.click(within(regionRow('subcategories_rail')).getByRole('checkbox'));
    expect(document.querySelector('[data-preview-category-region="subcategories_rail"]')).toBeNull();
  });

  it('9/10. subcategories_rail may move up past description, but never down past filter_sort_bar', async () => {
    const user = userEvent.setup();
    await renderReady(user);
    await user.click(screen.getByRole('button', { name: 'Category page structure' }));

    // description itself has no move buttons at all (not reorderable).
    expect(within(regionRow('description')).queryByRole('button', { name: 'Up' })).toBeNull();
    expect(within(regionRow('description')).queryByRole('button', { name: 'Down' })).toBeNull();

    const subDown = within(regionRow('subcategories_rail')).getByRole('button', { name: 'Down' });
    expect(subDown.hasAttribute('disabled')).toBe(true); // would cross filter_sort_bar (FIXED_REQUIRED)

    const subUp = within(regionRow('subcategories_rail')).getByRole('button', { name: 'Up' });
    expect(subUp.hasAttribute('disabled')).toBe(false);
    await user.click(subUp);
    expect(builderRoot().getAttribute('data-lifecycle')).toBe('dirty');

    const rows = Array.from(document.querySelectorAll('[data-category-region-row]')).map((el) =>
      el.getAttribute('data-category-region-row'),
    );
    expect(rows.indexOf('subcategories_rail')).toBeLessThan(rows.indexOf('description'));
  });

  it('11. no description is handled honestly — the region is omitted, never fabricated', async () => {
    const user = userEvent.setup();
    await renderReady(user, { description: null });
    expect(document.querySelector('[data-preview-category-region="description"]')).toBeNull();
  });

  it('12. no subcategories is handled honestly — the region is omitted, never fabricated', async () => {
    const user = userEvent.setup();
    await renderReady(user, { children: [] });
    expect(document.querySelector('[data-preview-category-region="subcategories_rail"]')).toBeNull();
  });

  it('13. zero Products in the category is handled honestly in the product grid', async () => {
    listProductsMock.mockResolvedValue({ ok: true, hasMore: false, data: [] });
    const user = userEvent.setup();
    await renderReady(user);
    await waitFor(() => expect(listProductsMock).toHaveBeenCalled());
    expect(listProductsMock.mock.calls[0][1]).toMatchObject({ categoryId: 'cat-1' });
    await waitFor(() =>
      expect(document.querySelector('[data-category-preview-no-products]')).not.toBeNull(),
    );
  });

  it('14/15/16. an edit dirties the Version, and Save persists pagePresentation.category with the existing revision', async () => {
    const user = userEvent.setup();
    await renderReady(user);
    saveMock.mockResolvedValue({ ok: true, data: versionDetail({ revision: 6 }) });

    await user.click(screen.getByRole('button', { name: 'Category page structure' }));
    await user.click(within(regionRow('description')).getByRole('checkbox'));
    expect(builderRoot().getAttribute('data-lifecycle')).toBe('dirty');

    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());

    expect(saveMock.mock.calls[0][0]).toBe('store-1');
    expect(saveMock.mock.calls[0][1]).toBe('v1');
    const savedConfig = saveMock.mock.calls[0][2];
    const regions = savedConfig.pagePresentation.category.regions;
    const description = regions.find((r: { key: string }) => r.key === 'description');
    expect(description.visible).toBe(false);
    // 16. the existing Version revision (5), not a fabricated one.
    expect(saveMock.mock.calls[0][3]).toBe(5);
  });

  it('17. switching Category → Home → Category preserves the unsaved Category region edit', async () => {
    const user = userEvent.setup();
    await renderReady(user);

    await user.click(screen.getByRole('button', { name: 'Category page structure' }));
    await user.click(within(regionRow('description')).getByRole('checkbox'));
    expect(document.querySelector('[data-preview-category-region="description"]')).toBeNull();

    await user.click(screen.getByLabelText('Page currently being viewed'));
    await user.click(screen.getByRole('button', { name: 'Home' }));
    expect(builderRoot().getAttribute('data-current-page')).toBe('home');
    expect(saveMock).not.toHaveBeenCalled();

    await user.click(screen.getByLabelText('Page currently being viewed'));
    await user.click(screen.getByRole('button', { name: 'Category page' }));
    await waitFor(() =>
      expect(document.querySelector('[data-category-preview="ready"]')).not.toBeNull(),
    );
    expect(document.querySelector('[data-preview-category-region="description"]')).toBeNull();
    expect(builderRoot().getAttribute('data-lifecycle')).toBe('dirty');
  });

  it("18. a fresh storefront/version open never carries a previous context's Category draft", async () => {
    listCategoriesMock.mockResolvedValue({ ok: true, hasMore: false, data: [categorySummary()] });
    showCategoryMock.mockResolvedValue({ ok: true, data: categoryDetail() });
    const user = userEvent.setup();
    const configWithHiddenDescription = {
      ...DEFAULT_PRESENTATION_CONFIG,
      pagePresentation: {
        category: {
          version: 1,
          regions: [
            { id: 'breadcrumbs', key: 'breadcrumbs', visible: true },
            { id: 'identity_title', key: 'identity_title', visible: true },
            { id: 'description', key: 'description', visible: false },
            { id: 'subcategories_rail', key: 'subcategories_rail', visible: true },
            { id: 'filter_sort_bar', key: 'filter_sort_bar', visible: true },
            { id: 'product_grid', key: 'product_grid', visible: true },
          ],
        },
      },
    };
    showMock.mockResolvedValue({ ok: true, data: versionDetail({ config: configWithHiddenDescription }) });
    const { rerender } = render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));
    await goToCategoryPage(user);
    await user.click(screen.getByRole('button', { name: 'Category page structure' }));
    expect(
      (within(regionRow('description')).getByRole('checkbox') as HTMLInputElement).checked,
    ).toBe(false);

    showMock.mockResolvedValue({ ok: true, data: versionDetail({ id: 'v2', config: DEFAULT_PRESENTATION_CONFIG }) });
    listMock.mockResolvedValue({ ok: true, data: [versionSummary({ id: 'v2' })] });
    rerender(<ExperienceBuilder storefrontId="store-2" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(2));
    expect(builderRoot().getAttribute('data-current-page')).toBe('home');
  });

  it('19. a Published Version keeps the region list visible but read-only', async () => {
    listCategoriesMock.mockResolvedValue({ ok: true, hasMore: false, data: [categorySummary()] });
    showCategoryMock.mockResolvedValue({ ok: true, data: categoryDetail() });
    showMock.mockResolvedValue({ ok: true, data: versionDetail({ state: 'published' }) });
    listMock.mockResolvedValue({ ok: true, data: [versionSummary({ state: 'published' })] });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));

    await goToCategoryPage(user);
    await waitFor(() =>
      expect(document.querySelector('[data-category-preview="ready"]')).not.toBeNull(),
    );
    await user.click(screen.getByRole('button', { name: 'Category page structure' }));

    const toggle = within(regionRow('description')).getByRole('checkbox');
    expect(toggle.hasAttribute('disabled')).toBe(true);
    expect(document.querySelector('[data-preview-category-region="description"]')).not.toBeNull();
    expect(builderRoot().getAttribute('data-lifecycle')).toBe('clean');

    const moveButton = within(regionRow('subcategories_rail')).getByRole('button', { name: 'Up' });
    expect(moveButton.hasAttribute('disabled')).toBe(true);
  });
});
