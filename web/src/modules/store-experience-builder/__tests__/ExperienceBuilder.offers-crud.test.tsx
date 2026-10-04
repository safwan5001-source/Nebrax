/**
 * @vitest-environment jsdom
 *
 * CUST-H4-7b — Offers CRUD reconciliation inside the real `ExperienceBuilder`.
 * A tiny in-memory "server" backs the mocked workspace Offers client, so these
 * tests prove the shared state follows the SERVER's responses (no shadow
 * model), and that deleting an offer removes its id from EVERY Offers section
 * (configured catalog = storefront-level Commerce data; `offerIds` = per-section
 * presentation content).
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
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
vi.mock('@/modules/commerce-workspace/workspace-products', () => ({
  listWorkspaceProducts: (...args: unknown[]) => listProductsMock(...args),
  showWorkspaceProduct: vi.fn(async () => ({ ok: false, reason: 'not_found', message: 'nf' })),
}));

vi.mock('@/modules/commerce-workspace/workspace-categories', () => ({
  listWorkspaceCategories: vi.fn(async () => ({ ok: true, data: [], hasMore: false })),
  showWorkspaceCategory: vi.fn(async () => ({ ok: false, reason: 'not_found', message: 'nf' })),
}));

const listOffersMock = vi.fn();
const createOfferMock = vi.fn();
const updateOfferMock = vi.fn();
const deleteOfferMock = vi.fn();
vi.mock('@/modules/commerce-workspace/workspace-offers', async () => {
  const actual = await vi.importActual<typeof import('@/modules/commerce-workspace/workspace-offers')>(
    '@/modules/commerce-workspace/workspace-offers',
  );
  return {
    ...actual,
    listWorkspaceOffers: (...args: unknown[]) => listOffersMock(...args),
    createWorkspaceOffer: (...args: unknown[]) => createOfferMock(...args),
    updateWorkspaceOffer: (...args: unknown[]) => updateOfferMock(...args),
    deleteWorkspaceOffer: (...args: unknown[]) => deleteOfferMock(...args),
  };
});

import { DEFAULT_PRESENTATION_CONFIG, type StorefrontPresentationConfig } from '../presentation';
import { ExperienceBuilder } from '../ExperienceBuilder';
import type { WorkspaceOffer } from '@/modules/commerce-workspace/workspace-offers';
import { hiddenOffer, liveOffer } from './offers-fixtures';

function versionSummary() {
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
  };
}

function configWith(instances: Array<{ id: string; offerIds: string[] }>): StorefrontPresentationConfig {
  return {
    ...DEFAULT_PRESENTATION_CONFIG,
    homepage: {
      ...DEFAULT_PRESENTATION_CONFIG.homepage,
      sections: [
        ...DEFAULT_PRESENTATION_CONFIG.homepage.sections.filter((s) => s.type !== 'offers'),
        ...instances.map((i) => ({
          id: i.id,
          type: 'offers' as const,
          visible: true,
          content: i.offerIds.length ? { offerIds: i.offerIds } : undefined,
        })),
      ],
    },
  };
}

const named = (id: string, name: string, extra: Partial<WorkspaceOffer> = {}) =>
  liveOffer({ id, product: { name, nameEn: null, thumbnailUrl: null }, ...extra });

/** The in-memory "server": the single source of truth the mocked client answers from. */
let server: WorkspaceOffer[] = [];

function wireServer() {
  listOffersMock.mockImplementation(async () => ({ ok: true, data: [...server], maxOffers: 12 }));
  createOfferMock.mockImplementation(async (_s: string, input: { productId: string; isActive?: boolean }) => {
    const created = named(`created-${server.length + 1}`, `عرض جديد ${server.length + 1}`, {
      productId: input.productId,
      position: server.length,
      isActive: input.isActive ?? true,
    });
    server = [...server, created];
    return { ok: true, data: created };
  });
  updateOfferMock.mockImplementation(async (_s: string, id: string, input: { isActive?: boolean }) => {
    const current = server.find((o) => o.id === id);
    if (!current) return { ok: false, reason: 'not_found', message: 'nf', fieldErrors: {} };
    const next: WorkspaceOffer =
      input.isActive === false
        ? hiddenOffer('inactive', { id, productId: current.productId, product: current.product, isActive: false })
        : { ...current };
    server = server.map((o) => (o.id === id ? next : o));
    return { ok: true, data: next };
  });
  deleteOfferMock.mockImplementation(async (_s: string, id: string) => {
    server = server.filter((o) => o.id !== id);
    return { ok: true };
  });
}

async function renderBuilder(config: StorefrontPresentationConfig, locale: 'ar' | 'en' = 'ar') {
  showMock.mockResolvedValue({ ok: true, data: { ...versionSummary(), config } });
  render(<ExperienceBuilder storefrontId="store-1" initialLocale={locale} />);
  await waitFor(() => expect(document.querySelector('[data-experience-builder]')).not.toBeNull());
}

const q = (selector: string) => document.querySelector(selector) as HTMLElement;
const section = (id: string) => q(`section[aria-labelledby="preview-offers-${id}"]`);
const cardNames = (id: string) =>
  Array.from(section(id)?.querySelectorAll('[data-home-offer-card] p:first-child') ?? []).map((el) => el.textContent);

async function selectSection(id: string) {
  await waitFor(() => expect(q(`[data-preview-section-id="${id}"]`)).not.toBeNull());
  fireEvent.click(q(`[data-preview-section-id="${id}"]`));
  await waitFor(() => expect(q('[data-offers-selected]')).not.toBeNull());
}

function selectedItems(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[data-offers-selected-item]'));
}

describe('ExperienceBuilder — CUST-H4-7b Offers CRUD reconciliation', () => {
  beforeEach(() => {
    listMock.mockResolvedValue({ ok: true, data: [versionSummary()] });
    listProductsMock.mockResolvedValue({
      ok: true,
      hasMore: false,
      data: [
        { id: 'prod-a', name: 'منتج أ', nameEn: 'Product A', thumbnailUrl: null, isVariantManaged: false },
        { id: 'prod-b', name: 'منتج ب', nameEn: 'Product B', thumbnailUrl: null, isVariantManaged: false },
      ],
    });
    server = [];
    wireServer();
  });

  afterEach(() => {
    cleanup();
    for (const mock of [listMock, showMock, listProductsMock, listOffersMock, createOfferMock, updateOfferMock, deleteOfferMock]) {
      mock.mockReset();
    }
  });

  describe('create', () => {
    it('the empty state leads to a created offer that appears in the configured list and becomes selectable', async () => {
      await renderBuilder(configWith([{ id: 'offers-1', offerIds: [] }]));
      await selectSection('offers-1');
      await waitFor(() => expect(q('[data-offer-create-empty]')).not.toBeNull());

      fireEvent.click(q('[data-offer-create-empty]'));
      await waitFor(() => expect(q('[data-offer-product-option="prod-a"]')).not.toBeNull());
      // The product list comes from the real workspace product source (storefront-scoped).
      expect(listProductsMock).toHaveBeenCalledWith('store-1', { search: undefined, perPage: 50 }, expect.any(AbortSignal));
      fireEvent.click(q('[data-offer-product-option="prod-a"]'));
      fireEvent.click(q('[data-offer-submit]'));

      await waitFor(() => expect(createOfferMock).toHaveBeenCalledTimes(1));
      expect(createOfferMock).toHaveBeenCalledWith('store-1', { productId: 'prod-a', isActive: true, position: null });
      await waitFor(() => expect(q('[data-offers-option="created-1"]')).not.toBeNull());
      expect(q('[data-offers-option="created-1"]').textContent).toContain('عرض جديد 1');
      expect(q('[data-offers-option="created-1"]').getAttribute('aria-pressed')).toBe('false');

      // Selectable → the Canvas reflects it (it is live on the server).
      fireEvent.click(q('[data-offers-option="created-1"]'));
      await waitFor(() => expect(cardNames('offers-1')).toEqual(['عرض جديد 1']));
    });

    it('reconciles with the server after a mutation: one upsert + one silent re-read, no skeleton flash', async () => {
      server = [named('o1', 'الأول')];
      await renderBuilder(configWith([{ id: 'offers-1', offerIds: ['o1'] }]));
      await selectSection('offers-1');
      expect(listOffersMock).toHaveBeenCalledTimes(1);
      fireEvent.click(q('[data-offer-add]'));
      await waitFor(() => expect(q('[data-offer-product-option="prod-a"]')).not.toBeNull());
      fireEvent.click(q('[data-offer-product-option="prod-a"]'));
      fireEvent.click(q('[data-offer-submit]'));
      await waitFor(() => expect(listOffersMock).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(q('[data-offers-option="created-2"]')).not.toBeNull());
      // The existing selection's Canvas card never went back to a loading skeleton.
      expect(section('offers-1')?.querySelector('.animate-pulse')).toBeNull();
      expect(cardNames('offers-1')).toEqual(['الأول']);
    });

    it('a 409 duplicate shows the error, then silently re-reads so the conflicting row is visible after the form closes', async () => {
      server = [named('o1', 'الأول')];
      createOfferMock.mockImplementationOnce(async () => {
        // Another tab configured prod-b meanwhile: the server now has it.
        server = [...server, named('o-conflict', 'ب')];
        return { ok: false, reason: 'conflict', message: 'dup', fieldErrors: {} };
      });
      await renderBuilder(configWith([{ id: 'offers-1', offerIds: [] }]));
      await selectSection('offers-1');
      fireEvent.click(q('[data-offer-add]'));
      await waitFor(() => expect(q('[data-offer-product-option="prod-b"]')).not.toBeNull());
      fireEvent.click(q('[data-offer-product-option="prod-b"]'));
      fireEvent.click(q('[data-offer-submit]'));
      await waitFor(() => expect(q('[data-offer-field-error="product_id"]')).not.toBeNull());
      // The error stays on the form; one silent reconcile read shows the server truth.
      await waitFor(() => expect(listOffersMock).toHaveBeenCalledTimes(2));
      // Closing the form returns to the list, which already shows the conflicting row
      // (verified against the real API in CUST-H4-8: no manual refresh needed).
      fireEvent.click(q('[data-offer-cancel]'));
      await waitFor(() => expect(q('[data-offers-option="o-conflict"]')).not.toBeNull());
    });
  });

  describe('edit', () => {
    it('applies the authoritative server response: the row turns hidden with the server reason, and the Canvas card disappears', async () => {
      server = [named('o1', 'الأول'), named('o2', 'الثاني')];
      await renderBuilder(configWith([{ id: 'offers-1', offerIds: ['o1', 'o2'] }]));
      await waitFor(() => expect(cardNames('offers-1')).toEqual(['الأول', 'الثاني']));
      await selectSection('offers-1');

      fireEvent.click(q('[data-offer-edit="o1"]'));
      await waitFor(() => expect(q('[data-offer-form="edit"]')).not.toBeNull());
      fireEvent.click(q('[data-offer-active]'));
      fireEvent.click(q('[data-offer-submit]'));

      await waitFor(() => expect(updateOfferMock).toHaveBeenCalledWith('store-1', 'o1', { isActive: false }));
      await waitFor(() => expect(q('[data-offers-option="o1"]')).not.toBeNull());
      const row = q('[data-offers-option="o1"]');
      expect(row.textContent).toContain('غير ظاهر');
      expect(row.textContent).toContain('العرض موقوف');
      // Selected row + Canvas follow the server, not a local guess.
      await waitFor(() => expect(cardNames('offers-1')).toEqual(['الثاني']));
      expect(selectedItems()[0].textContent).toContain('العرض موقوف');
      // Selection is presentation content and is untouched by editing the offer.
      expect(selectedItems()).toHaveLength(2);
    });

    it('a not-found update (deleted elsewhere) triggers a re-read and shows the server truth', async () => {
      server = [named('o1', 'الأول')];
      await renderBuilder(configWith([{ id: 'offers-1', offerIds: [] }]));
      await selectSection('offers-1');
      fireEvent.click(q('[data-offer-edit="o1"]'));
      await waitFor(() => expect(q('[data-offer-form="edit"]')).not.toBeNull());
      server = []; // another session deleted it
      fireEvent.click(q('[data-offer-active]'));
      fireEvent.click(q('[data-offer-submit]'));
      await waitFor(() => expect(q('[data-offer-form-error]')?.textContent).toContain('لم يعد'));
      await waitFor(() => expect(listOffersMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    });
  });

  describe('delete — no dangling offer ids', () => {
    async function twoSections() {
      server = [named('o1', 'الأول'), named('o2', 'الثاني'), named('o3', 'الثالث')];
      await renderBuilder(
        configWith([
          { id: 'offers-1', offerIds: ['o1', 'o2'] },
          { id: 'offers-2', offerIds: ['o3', 'o1'] },
          { id: 'offers-3', offerIds: ['o1'] },
          { id: 'offers-4', offerIds: ['o2'] },
        ]),
        'en',
      );
      await waitFor(() => expect(cardNames('offers-2')).toEqual(['الثالث', 'الأول']));
    }

    async function deleteOffer(id: string) {
      fireEvent.click(q(`[data-offer-delete="${id}"]`));
      await waitFor(() => expect(q('[data-offer-delete-confirm-button]')).not.toBeNull());
      fireEvent.click(q('[data-offer-delete-confirm-button]'));
      await waitFor(() => expect(deleteOfferMock).toHaveBeenCalledWith('store-1', id));
      await waitFor(() => expect(q(`[data-offers-option="${id}"]`)).toBeNull());
    }

    it('removes the deleted id from the catalog AND from every Offers section that referenced it', async () => {
      await twoSections();
      await selectSection('offers-1');
      await deleteOffer('o1');

      // Canvas: every referencing instance dropped its card; others untouched.
      await waitFor(() => expect(cardNames('offers-1')).toEqual(['الثاني']));
      expect(cardNames('offers-2')).toEqual(['الثالث']);
      expect(cardNames('offers-4')).toEqual(['الثاني']);
      // offers-3 held only o1 → empty selection state, no dangling card/row.
      expect(q('section[aria-labelledby="preview-offers-offers-3"] [data-home-offers-empty]')).not.toBeNull();

      // Picker for the section being edited: no leftover/unavailable row.
      expect(selectedItems()).toHaveLength(1);
      expect(q('[data-offers-unavailable]')).toBeNull();
      expect(selectedItems()[0].textContent).toContain('الثاني');
    });

    it('the other instances really hold clean content: re-selecting each shows no dangling reference', async () => {
      await twoSections();
      await selectSection('offers-1');
      await deleteOffer('o1');
      for (const [id, expected] of [
        ['offers-2', 1],
        ['offers-3', 0],
        ['offers-4', 1],
      ] as const) {
        fireEvent.click(q(`[data-preview-section-id="${id}"]`));
        await waitFor(() => expect(selectedItems()).toHaveLength(expected));
        expect(q('[data-offers-unavailable]')).toBeNull();
      }
    });

    it('marks the draft as having an unsaved change (the section edit is saved with the draft)', async () => {
      await twoSections();
      await selectSection('offers-1');
      expect(document.body.textContent).not.toContain('Unsaved draft');
      await deleteOffer('o1');
      await waitFor(() => expect(document.body.textContent).toContain('Unsaved draft'));
    });

    it('does NOT dirty the draft when no section referenced the deleted offer', async () => {
      server = [named('o1', 'الأول'), named('o9', 'غير مستخدم')];
      await renderBuilder(configWith([{ id: 'offers-1', offerIds: ['o1'] }]), 'en');
      await selectSection('offers-1');
      await deleteOffer('o9');
      expect(document.body.textContent).not.toContain('Unsaved draft');
      expect(cardNames('offers-1')).toEqual(['الأول']);
    });

    it('a 404 on delete means "already gone": same end state, references still cleaned', async () => {
      server = [named('o1', 'الأول')];
      deleteOfferMock.mockResolvedValueOnce({ ok: false, reason: 'not_found', message: 'nf', fieldErrors: {} });
      await renderBuilder(configWithOffers1());
      await selectSection('offers-1');
      fireEvent.click(q('[data-offer-delete="o1"]'));
      await waitFor(() => expect(q('[data-offer-delete-confirm-button]')).not.toBeNull());
      fireEvent.click(q('[data-offer-delete-confirm-button]'));
      await waitFor(() => expect(q('[data-offers-option="o1"]')).toBeNull());
      expect(selectedItems()).toHaveLength(0);
    });

    it('a failed delete changes nothing: the offer, the selection and the draft stay as they were', async () => {
      server = [named('o1', 'الأول')];
      deleteOfferMock.mockResolvedValueOnce({ ok: false, reason: 'failed', message: 'boom', fieldErrors: {} });
      await renderBuilder(configWithOffers1(), 'en');
      await selectSection('offers-1');
      fireEvent.click(q('[data-offer-delete="o1"]'));
      await waitFor(() => expect(q('[data-offer-delete-confirm-button]')).not.toBeNull());
      fireEvent.click(q('[data-offer-delete-confirm-button]'));
      await waitFor(() => expect(q('[data-offer-delete-error]')).not.toBeNull());
      expect(q('[data-offers-option="o1"]')).not.toBeNull();
      expect(selectedItems()).toHaveLength(1);
      expect(document.body.textContent).not.toContain('Unsaved draft');
    });

    function configWithOffers1() {
      return configWith([{ id: 'offers-1', offerIds: ['o1'] }]);
    }
  });

  describe('independence of the two authorities', () => {
    it('creating/editing the catalog never changes any section\'s offerIds; selecting changes only that section', async () => {
      server = [named('o1', 'الأول')];
      await renderBuilder(
        configWith([
          { id: 'offers-1', offerIds: ['o1'] },
          { id: 'offers-2', offerIds: [] },
        ]),
        'en',
      );
      await selectSection('offers-2');
      fireEvent.click(q('[data-offer-add]'));
      await waitFor(() => expect(q('[data-offer-product-option="prod-a"]')).not.toBeNull());
      fireEvent.click(q('[data-offer-product-option="prod-a"]'));
      fireEvent.click(q('[data-offer-submit]'));
      await waitFor(() => expect(q('[data-offers-option="created-2"]')).not.toBeNull());
      // Neither instance auto-selected the new offer, and the draft is still clean.
      expect(selectedItems()).toHaveLength(0);
      expect(cardNames('offers-1')).toEqual(['الأول']);
      expect(document.body.textContent).not.toContain('Unsaved draft');

      fireEvent.click(q('[data-offers-option="created-2"]'));
      await waitFor(() => expect(cardNames('offers-2')).toEqual(['عرض جديد 2']));
      expect(cardNames('offers-1')).toEqual(['الأول']);
    });
  });
});
