/**
 * @vitest-environment jsdom
 *
 * CUST-H5-4 (Codex review) — a history preview must show the SNAPSHOT's page layout on the Product page, not the live draft's
 * regions, and closing the dialog opened from the «More» menu must return focus to the visible More trigger.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listMock = vi.fn();
const showMock = vi.fn();
const revListMock = vi.fn();
const revShowMock = vi.fn();

vi.mock('@/modules/commerce-workspace/presentation-versions', () => ({
  listPresentationVersions: (...args: unknown[]) => listMock(...args),
  showPresentationVersion: (...args: unknown[]) => showMock(...args),
  createPresentationVersion: vi.fn(),
  savePresentationVersion: vi.fn(),
  renamePresentationVersion: vi.fn(),
  deletePresentationVersion: vi.fn(),
  listPresentationVersionRevisions: (...args: unknown[]) => revListMock(...args),
  showPresentationVersionRevision: (...args: unknown[]) => revShowMock(...args),
}));

vi.mock('@/modules/commerce-workspace/workspace-products', () => ({
  listWorkspaceProducts: vi.fn().mockResolvedValue({
    ok: true,
    hasMore: false,
    data: [{ id: 'prod-1', name: 'Bike Helmet', nameEn: 'Bike Helmet', thumbnailUrl: null, isVariantManaged: false }],
  }),
  showWorkspaceProduct: vi.fn().mockResolvedValue({
    ok: true,
    data: {
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
    },
  }),
}));

import { DEFAULT_PRESENTATION_CONFIG } from '../presentation';
import { defaultProductPageRegions } from '../presentation/page-regions';
import { ExperienceBuilder } from '../ExperienceBuilder';

const summary = {
  id: 'v1',
  storefrontId: 'store-1',
  name: 'Current design',
  state: 'draft',
  schemaVersion: 3,
  revision: 7,
  scheduledFor: null,
  lastPublishedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  publishedRevision: null,
  scheduleToken: 'opaque-token-0',
  schedulingRuntimeActive: true,
};

const snapshotWithoutDescription = {
  ...DEFAULT_PRESENTATION_CONFIG,
  pagePresentation: {
    ...(DEFAULT_PRESENTATION_CONFIG.pagePresentation ?? {}),
    product: {
      version: 1 as const,
      regions: defaultProductPageRegions().map((region) => (region.key === 'description' ? { ...region, visible: false } : region)),
    },
  },
};

const revRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'r1',
  versionId: 'v1',
  versionRevision: 3,
  schemaVersion: 3,
  sizeBytes: 1500,
  createdAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
  isCurrent: false,
  ...overrides,
});

describe('ExperienceBuilder — CUST-H5-4 history preview layout & focus return', () => {
  beforeEach(() => {
    listMock.mockResolvedValue({ ok: true, data: [summary] });
    showMock.mockResolvedValue({ ok: true, data: { ...summary, config: DEFAULT_PRESENTATION_CONFIG } });
    revListMock.mockResolvedValue({ ok: true, data: [revRow({ id: 'r2', versionRevision: 7, isCurrent: true }), revRow()] });
  });

  afterEach(() => {
    cleanup();
    for (const mock of [listMock, showMock, revListMock, revShowMock]) mock.mockReset();
  });

  it('previews the snapshot\'s Product-page regions (a region hidden in the snapshot disappears), and Exit brings the live layout back', async () => {
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(document.querySelector('[data-selected-version-id="v1"]')).toBeTruthy());
    await user.click(screen.getByLabelText('Page currently being viewed'));
    await user.click(screen.getByRole('button', { name: 'Product page' }));
    await waitFor(() => expect(document.querySelector('[data-product-preview="ready"]')).not.toBeNull());
    expect(screen.getAllByText('A sturdy helmet.').length).toBeGreaterThan(0);

    revShowMock.mockResolvedValueOnce({
      ok: true,
      data: { ...revRow(), config: snapshotWithoutDescription, mediaIssues: [] },
    });
    await user.click(document.querySelector('[data-history-open]') as HTMLElement);
    await waitFor(() => expect(document.querySelectorAll('[data-history-row]').length).toBeGreaterThan(0));
    await user.click(within(document.querySelectorAll('[data-history-row]')[1] as HTMLElement).getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(document.querySelector('[data-history-preview-bar]')).toBeTruthy());

    expect(screen.queryByText('A sturdy helmet.')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Exit preview' }));
    expect(screen.getAllByText('A sturdy helmet.').length).toBeGreaterThan(0);
  });

  it('closing the dialog opened from the More menu returns focus to the visible More trigger, not the hidden menu item', async () => {
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(document.querySelector('[data-selected-version-id="v1"]')).toBeTruthy());
    const more = screen.getByRole('button', { name: /More actions/ });
    await user.click(more);
    await user.click(within(screen.getByRole('menu', { name: 'More actions' })).getByRole('menuitem', { name: 'Saved history' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Saved history' })).toBeTruthy());

    await user.keyboard('{Escape}');

    await waitFor(() => expect(document.activeElement).toBe(more));
  });
});
