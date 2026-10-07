/**
 * @vitest-environment jsdom
 *
 * CUST-H2-3 — Product page structured editing: Preview Product picker,
 * region visibility/reorder, required-region invariants, variant_selector
 * gating, Save/dirty semantics, Published read-only, and page-switch draft
 * preservation. `ExperienceBuilder.pageNavigator.test.tsx` already covers
 * Home unchanged / Category still a placeholder — not duplicated here.
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

function productSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prod-1',
    name: 'Bike Helmet',
    nameEn: 'Bike Helmet',
    thumbnailUrl: null,
    isVariantManaged: false,
    ...overrides,
  };
}

function productDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prod-1',
    name: 'Bike Helmet',
    nameEn: 'Bike Helmet',
    description: 'A sturdy helmet.',
    sku: 'HEL-1',
    categoryName: 'Gear',
    priceAmountMinor: 15000,
    currency: 'SAR',
    inStock: true,
    media: [],
    isVariantManaged: false,
    options: null,
    variants: null,
    ...overrides,
  };
}

function builderRoot(): HTMLElement {
  return document.querySelector('[data-experience-builder]') as HTMLElement;
}

function regionRow(key: string): HTMLElement {
  return document.querySelector(`[data-product-region-row="${key}"]`) as HTMLElement;
}

async function goToProductPage(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText('Page currently being viewed'));
  await user.click(screen.getByRole('button', { name: 'Product page' }));
}

describe('ExperienceBuilder — CUST-H2-3 Product page structured editing', () => {
  beforeEach(() => {
    listMock.mockResolvedValue({ ok: true, data: [versionSummary()] });
    showMock.mockResolvedValue({ ok: true, data: versionDetail() });
  });

  afterEach(() => {
    cleanup();
    listMock.mockReset();
    showMock.mockReset();
    saveMock.mockReset();
    listProductsMock.mockReset();
    showProductMock.mockReset();
  });

  it('1. loads the first eligible Product deterministically', async () => {
    listProductsMock.mockResolvedValue({
      ok: true,
      hasMore: false,
      data: [productSummary({ id: 'prod-1', name: 'A' }), productSummary({ id: 'prod-2', name: 'B' })],
    });
    showProductMock.mockResolvedValue({ ok: true, data: productDetail() });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));

    await goToProductPage(user);
    await waitFor(() => expect(showProductMock).toHaveBeenCalledWith('store-1', 'prod-1'));
  });

  it('2/3. selecting a preview Product is not written to config and does not dirty the Version', async () => {
    listProductsMock.mockResolvedValue({
      ok: true,
      hasMore: false,
      data: [productSummary({ id: 'prod-1', name: 'A' }), productSummary({ id: 'prod-2', name: 'B' })],
    });
    showProductMock.mockImplementation(async (_storefrontId: string, id: string) => ({
      ok: true,
      data: productDetail({ id, name: id === 'prod-2' ? 'B' : 'A' }),
    }));
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));

    await goToProductPage(user);
    await waitFor(() => expect(listProductsMock).toHaveBeenCalled());
    expect(builderRoot().getAttribute('data-lifecycle')).toBe('clean');

    // Open the toolbar picker and switch to the second product.
    await user.click(screen.getByLabelText('Preview product'));
    await user.click(screen.getByRole('option', { name: 'B' }));
    await waitFor(() => expect(showProductMock).toHaveBeenCalledWith('store-1', 'prod-2'));

    // Still clean — the picker never dirtied the draft.
    expect(builderRoot().getAttribute('data-lifecycle')).toBe('clean');
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('4. shows an honest empty state when the store has zero eligible Products', async () => {
    listProductsMock.mockResolvedValue({ ok: true, hasMore: false, data: [] });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));

    await goToProductPage(user);
    await waitFor(() =>
      expect(document.querySelector('[data-product-preview-state="empty"]')).not.toBeNull(),
    );
    expect(showProductMock).not.toHaveBeenCalled();
  });

  async function renderReady(user: ReturnType<typeof userEvent.setup>, detailOverrides: Record<string, unknown> = {}) {
    listProductsMock.mockResolvedValue({ ok: true, hasMore: false, data: [productSummary()] });
    showProductMock.mockResolvedValue({ ok: true, data: productDetail(detailOverrides) });
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));
    await goToProductPage(user);
    await waitFor(() =>
      expect(document.querySelector('[data-product-preview="ready"]')).not.toBeNull(),
    );
  }

  it('5/6. required regions expose no visibility toggle and no move controls', async () => {
    const user = userEvent.setup();
    await renderReady(user);
    await user.click(screen.getByRole('button', { name: 'Product page structure' }));

    for (const key of ['media_gallery', 'identity', 'price', 'quantity_cta']) {
      const row = regionRow(key);
      expect(row).not.toBeNull();
      expect(within(row).queryByRole('checkbox')).toBeNull();
      expect(within(row).queryByRole('button', { name: 'Up' })).toBeNull();
      expect(within(row).queryByRole('button', { name: 'Down' })).toBeNull();
    }
  });

  it('7. an optional region can be hidden and shown again, updating the Canvas', async () => {
    const user = userEvent.setup();
    await renderReady(user);
    await user.click(screen.getByRole('button', { name: 'Product page structure' }));

    expect(document.querySelector('[data-preview-product-region="description"]')).not.toBeNull();
    await user.click(within(regionRow('description')).getByRole('checkbox'));
    expect(builderRoot().getAttribute('data-lifecycle')).toBe('dirty');
    expect(document.querySelector('[data-preview-product-region="description"]')).toBeNull();

    await user.click(within(regionRow('description')).getByRole('checkbox'));
    expect(document.querySelector('[data-preview-product-region="description"]')).not.toBeNull();
  });

  it('8/9. allowed reorder works; a move that would cross a required region is prevented', async () => {
    const user = userEvent.setup();
    await renderReady(user);
    await user.click(screen.getByRole('button', { name: 'Product page structure' }));

    // availability sits directly under price (FIXED_REQUIRED) — "move up"
    // must be disabled, never silently swap past it.
    const availabilityUp = within(regionRow('availability')).getByRole('button', { name: 'Up' });
    expect(availabilityUp.hasAttribute('disabled')).toBe(true);

    // description → custom_fields → sku_options_details is a free zone.
    const descriptionDown = within(regionRow('description')).getByRole('button', { name: 'Down' });
    expect(descriptionDown.hasAttribute('disabled')).toBe(false);
    await user.click(descriptionDown);
    expect(builderRoot().getAttribute('data-lifecycle')).toBe('dirty');

    const rows = Array.from(document.querySelectorAll('[data-product-region-row]')).map((el) =>
      el.getAttribute('data-product-region-row'),
    );
    const descIndex = rows.indexOf('description');
    const customIndex = rows.indexOf('custom_fields');
    expect(customIndex).toBeLessThan(descIndex);
  });

  it('10. variant_selector appears for a Product with variants', async () => {
    const user = userEvent.setup();
    await renderReady(user, {
      isVariantManaged: true,
      options: [{ id: 'o1', name: 'Color', nameEn: 'Color', values: [{ id: 'v1', value: 'Red', valueEn: 'Red' }] }],
      variants: [
        {
          id: 'var1',
          sku: 'SKU-R',
          optionValueIds: ['v1'],
          priceAmountMinor: 15000,
          currency: 'SAR',
          inStock: true,
          media: [],
        },
      ],
    });
    expect(document.querySelector('[data-preview-product-region="variant_selector"]')).not.toBeNull();
  });

  it('11. variant_selector is absent for a Product without variants', async () => {
    const user = userEvent.setup();
    await renderReady(user, { isVariantManaged: false, variants: null });
    expect(document.querySelector('[data-preview-product-region="variant_selector"]')).toBeNull();
  });

  it('12. missing Product data omits the region honestly instead of inventing content', async () => {
    const user = userEvent.setup();
    await renderReady(user, { description: null, sku: null });
    expect(document.querySelector('[data-preview-product-region="description"]')).toBeNull();
    expect(document.querySelector('[data-preview-product-region="sku_options_details"]')).toBeNull();
    // AWJ's catalog never populates custom fields — always an honest omission.
    expect(document.querySelector('[data-preview-product-region="custom_fields"]')).toBeNull();
  });

  it('13/14/15. an edit dirties the Version, and Save persists pagePresentation.product with the existing revision', async () => {
    const user = userEvent.setup();
    await renderReady(user);
    saveMock.mockResolvedValue({ ok: true, data: versionDetail({ revision: 6 }) });

    await user.click(screen.getByRole('button', { name: 'Product page structure' }));
    await user.click(within(regionRow('availability')).getByRole('checkbox'));
    expect(builderRoot().getAttribute('data-lifecycle')).toBe('dirty');

    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());

    expect(saveMock.mock.calls[0][0]).toBe('store-1');
    expect(saveMock.mock.calls[0][1]).toBe('v1');
    const savedConfig = saveMock.mock.calls[0][2];
    const regions = savedConfig.pagePresentation.product.regions;
    const availability = regions.find((r: { key: string }) => r.key === 'availability');
    expect(availability.visible).toBe(false);
    // 15. the existing Version revision (5), not a fabricated one.
    expect(saveMock.mock.calls[0][3]).toBe(5);
  });

  it('16. switching Home → Product → Home preserves the unsaved Product region edit', async () => {
    const user = userEvent.setup();
    await renderReady(user);

    await user.click(screen.getByRole('button', { name: 'Product page structure' }));
    await user.click(within(regionRow('description')).getByRole('checkbox'));
    expect(document.querySelector('[data-preview-product-region="description"]')).toBeNull();

    await user.click(screen.getByLabelText('Page currently being viewed'));
    await user.click(screen.getByRole('button', { name: 'Home' }));
    expect(builderRoot().getAttribute('data-current-page')).toBe('home');
    expect(saveMock).not.toHaveBeenCalled();

    await user.click(screen.getByLabelText('Page currently being viewed'));
    await user.click(screen.getByRole('button', { name: 'Product page' }));
    await waitFor(() =>
      expect(document.querySelector('[data-product-preview="ready"]')).not.toBeNull(),
    );
    expect(document.querySelector('[data-preview-product-region="description"]')).toBeNull();
    expect(builderRoot().getAttribute('data-lifecycle')).toBe('dirty');
  });

  it('17. a fresh storefront/version open never carries a previous context\'s Product draft', async () => {
    listProductsMock.mockResolvedValue({ ok: true, hasMore: false, data: [productSummary()] });
    showProductMock.mockResolvedValue({ ok: true, data: productDetail() });
    const user = userEvent.setup();
    const configWithHiddenAvailability = {
      ...DEFAULT_PRESENTATION_CONFIG,
      pagePresentation: {
        product: {
          version: 1,
          regions: [
            { id: 'media_gallery', key: 'media_gallery', visible: true },
            { id: 'identity', key: 'identity', visible: true },
            { id: 'price', key: 'price', visible: true },
            { id: 'availability', key: 'availability', visible: false },
            { id: 'quantity_cta', key: 'quantity_cta', visible: true },
            { id: 'description', key: 'description', visible: true },
            { id: 'custom_fields', key: 'custom_fields', visible: true },
            { id: 'sku_options_details', key: 'sku_options_details', visible: true },
          ],
        },
      },
    };
    showMock.mockResolvedValue({ ok: true, data: versionDetail({ config: configWithHiddenAvailability }) });
    const { rerender } = render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));
    await goToProductPage(user);
    await user.click(screen.getByRole('button', { name: 'Product page structure' }));
    expect(
      (within(regionRow('availability')).getByRole('checkbox') as HTMLInputElement).checked,
    ).toBe(false);

    // A different storefront (fresh open) must never inherit that config.
    showMock.mockResolvedValue({ ok: true, data: versionDetail({ id: 'v2', config: DEFAULT_PRESENTATION_CONFIG }) });
    listMock.mockResolvedValue({ ok: true, data: [versionSummary({ id: 'v2' })] });
    rerender(<ExperienceBuilder storefrontId="store-2" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(2));
    expect(builderRoot().getAttribute('data-current-page')).toBe('home');
  });

  it('18. a Published Version keeps the region list visible but read-only', async () => {
    listProductsMock.mockResolvedValue({ ok: true, hasMore: false, data: [productSummary()] });
    showProductMock.mockResolvedValue({ ok: true, data: productDetail() });
    showMock.mockResolvedValue({ ok: true, data: versionDetail({ state: 'published' }) });
    listMock.mockResolvedValue({ ok: true, data: [versionSummary({ state: 'published' })] });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));

    await goToProductPage(user);
    await waitFor(() =>
      expect(document.querySelector('[data-product-preview="ready"]')).not.toBeNull(),
    );
    await user.click(screen.getByRole('button', { name: 'Product page structure' }));

    const toggle = within(regionRow('availability')).getByRole('checkbox');
    expect(toggle.hasAttribute('disabled')).toBe(true);
    expect(document.querySelector('[data-preview-product-region="availability"]')).not.toBeNull();
    expect(builderRoot().getAttribute('data-lifecycle')).toBe('clean');

    const moveButton = within(regionRow('description')).getByRole('button', { name: 'Down' });
    expect(moveButton.hasAttribute('disabled')).toBe(true);
  });
});
