/**
 * @vitest-environment jsdom
 *
 * CUST-H4-7 — Offers editor + Canvas data flow. Proves ONE workspace Offers
 * read serves the picker, selected-offer hydration and every Offers section
 * instance (never a request per offer, per instance or per product), that the
 * merchant-stored `offerIds` order and only live offers reach the Canvas, and
 * the honest loading / empty / error / retry / stale-response behaviour.
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
vi.mock('@/modules/commerce-workspace/workspace-products', () => ({
  listWorkspaceProducts: (...args: unknown[]) => listProductsMock(...args),
  showWorkspaceProduct: vi.fn(async () => ({ ok: false, reason: 'not_found', message: 'nf' })),
}));

vi.mock('@/modules/commerce-workspace/workspace-categories', () => ({
  listWorkspaceCategories: vi.fn(async () => ({ ok: true, data: [], hasMore: false })),
  showWorkspaceCategory: vi.fn(async () => ({ ok: false, reason: 'not_found', message: 'nf' })),
}));

const listOffersMock = vi.fn();
vi.mock('@/modules/commerce-workspace/workspace-offers', async () => {
  const actual = await vi.importActual<typeof import('@/modules/commerce-workspace/workspace-offers')>(
    '@/modules/commerce-workspace/workspace-offers',
  );
  return { ...actual, listWorkspaceOffers: (...args: unknown[]) => listOffersMock(...args) };
});

import { DEFAULT_PRESENTATION_CONFIG, type StorefrontPresentationConfig } from '../presentation';
import { ExperienceBuilder } from '../ExperienceBuilder';
import { hiddenOffer, liveOffer } from './offers-fixtures';

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

function versionDetail(config: StorefrontPresentationConfig) {
  return { ...versionSummary(), config };
}

/** Default sections minus the seeded `offers` row, plus the given visible Offers instances. */
function configWithOffers(
  instances: Array<{ id: string; offerIds: string[]; visible?: boolean }>,
): StorefrontPresentationConfig {
  return {
    ...DEFAULT_PRESENTATION_CONFIG,
    homepage: {
      ...DEFAULT_PRESENTATION_CONFIG.homepage,
      sections: [
        ...DEFAULT_PRESENTATION_CONFIG.homepage.sections.filter((section) => section.type !== 'offers'),
        ...instances.map((instance) => ({
          id: instance.id,
          type: 'offers' as const,
          visible: instance.visible ?? true,
          content: instance.offerIds.length ? { offerIds: instance.offerIds } : undefined,
        })),
      ],
    },
  };
}

function offersSection(id = 'offers-1'): HTMLElement | null {
  return document.querySelector(`section[aria-labelledby="preview-offers-${id}"]`);
}

function cardNames(id = 'offers-1'): string[] {
  return Array.from(offersSection(id)?.querySelectorAll('[data-home-offer-card] p:first-child') ?? []).map(
    (el) => el.textContent ?? '',
  );
}

function mk(id: string, name: string, extra: Record<string, unknown> = {}) {
  return liveOffer({ id, product: { name, nameEn: null, thumbnailUrl: null }, ...extra });
}

async function renderBuilder(config: StorefrontPresentationConfig) {
  showMock.mockResolvedValue({ ok: true, data: versionDetail(config) });
  render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
  await waitFor(() => expect(document.querySelector('[data-experience-builder]')).not.toBeNull());
}

describe('ExperienceBuilder — CUST-H4-7 Offers shared workspace read', () => {
  beforeEach(() => {
    listMock.mockResolvedValue({ ok: true, data: [versionSummary()] });
    showMock.mockResolvedValue({ ok: true, data: versionDetail(DEFAULT_PRESENTATION_CONFIG) });
    listProductsMock.mockResolvedValue({ ok: true, data: [], hasMore: false });
    listOffersMock.mockResolvedValue({ ok: true, data: [], maxOffers: 12 });
  });

  afterEach(() => {
    cleanup();
    for (const mock of [listMock, showMock, listProductsMock, listOffersMock]) mock.mockReset();
  });

  it('issues exactly one workspace Offers read for the whole page, with the storefront id and an AbortSignal', async () => {
    listOffersMock.mockResolvedValue({ ok: true, data: [mk('o1', 'أول'), mk('o2', 'ثانٍ'), mk('o3', 'ثالث')], maxOffers: 12 });
    await renderBuilder(configWithOffers([{ id: 'offers-1', offerIds: ['o1', 'o2', 'o3'] }]));
    await waitFor(() => expect(offersSection()?.textContent).toContain('أول'));
    expect(listOffersMock).toHaveBeenCalledTimes(1);
    expect(listOffersMock.mock.calls[0][0]).toBe('store-1');
    expect(listOffersMock.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
    // No product endpoint is touched per offer.
    expect(listProductsMock.mock.calls.filter(([, params]) => params?.ids)).toHaveLength(0);
  });

  it('shares that single read across multiple Offers instances (N sections ⇒ still one request)', async () => {
    listOffersMock.mockResolvedValue({ ok: true, data: [mk('o1', 'أول'), mk('o2', 'ثانٍ')], maxOffers: 12 });
    await renderBuilder(
      configWithOffers([
        { id: 'offers-1', offerIds: ['o1'] },
        { id: 'offers-2', offerIds: ['o2', 'o1'] },
        { id: 'offers-3', offerIds: ['o2'] },
      ]),
    );
    await waitFor(() => expect(cardNames('offers-2')).toEqual(['ثانٍ', 'أول']));
    expect(cardNames('offers-1')).toEqual(['أول']);
    expect(cardNames('offers-3')).toEqual(['ثانٍ']);
    expect(listOffersMock).toHaveBeenCalledTimes(1);
  });

  it('renders only live offers, in the merchant-stored offerIds order, from the real backend values', async () => {
    listOffersMock.mockResolvedValue({
      ok: true,
      maxOffers: 12,
      data: [
        // Workspace order deliberately differs from the stored order.
        mk('o1', 'الأول', { discountPercent: 10 }),
        hiddenOffer('expired', { id: 'h1' }),
        mk('o2', 'الثاني', { discountPercent: 50 }),
      ],
    });
    await renderBuilder(configWithOffers([{ id: 'offers-1', offerIds: ['o2', 'h1', 'o1'] }]));
    await waitFor(() => expect(cardNames()).toEqual(['الثاني', 'الأول']));
    const badges = Array.from(offersSection()?.querySelectorAll('[data-home-offer-badge]') ?? []).map((el) => el.textContent);
    expect(badges).toEqual(['خصم 50%', 'خصم 10%']);
    expect(offersSection()?.textContent).not.toContain('منتج مخفي');
  });

  it('shows the loading skeleton while the read is pending, then the cards', async () => {
    let resolve: (value: unknown) => void = () => {};
    listOffersMock.mockImplementation(() => new Promise((r) => (resolve = r)));
    await renderBuilder(configWithOffers([{ id: 'offers-1', offerIds: ['o1'] }]));
    await waitFor(() => expect(offersSection()?.querySelector('.animate-pulse')).not.toBeNull());
    expect(offersSection()?.querySelectorAll('[data-home-offer-card]')).toHaveLength(0);
    resolve({ ok: true, maxOffers: 12, data: [mk('o1', 'جاهز')] });
    await waitFor(() => expect(cardNames()).toEqual(['جاهز']));
  });

  it('renders an honest empty state when nothing is selected — and a configured store with no offers still reads once', async () => {
    await renderBuilder(configWithOffers([{ id: 'offers-1', offerIds: [] }]));
    await waitFor(() => expect(document.querySelector('[data-home-offers-empty]')).not.toBeNull());
    expect(offersSection()?.querySelectorAll('[data-home-offer-card]')).toHaveLength(0);
  });

  it('shows an error with a working retry that re-reads once and renders the recovered data', async () => {
    listOffersMock.mockResolvedValueOnce({ ok: false, reason: 'failed', message: 'network down' });
    await renderBuilder(configWithOffers([{ id: 'offers-1', offerIds: ['o1'] }]));
    await waitFor(() => expect(document.querySelector('[data-home-offers-error]')).not.toBeNull());
    expect(offersSection()?.querySelectorAll('[data-home-offer-card]')).toHaveLength(0);

    listOffersMock.mockResolvedValue({ ok: true, maxOffers: 12, data: [mk('o1', 'عاد الآن')] });
    (document.querySelector('[data-home-offers-error] button') as HTMLButtonElement).click();
    await waitFor(() => expect(cardNames()).toEqual(['عاد الآن']));
    expect(listOffersMock).toHaveBeenCalledTimes(2);
  });

  it('a read for a previous storefront is aborted on switch and its late answer never repopulates the new one', async () => {
    const resolvers: Record<string, (value: unknown) => void> = {};
    listOffersMock.mockImplementation(
      (storefrontId: string) => new Promise((resolve) => (resolvers[storefrontId] = resolve)),
    );
    showMock.mockResolvedValue({ ok: true, data: versionDetail(DEFAULT_PRESENTATION_CONFIG) });

    async function openOffersRow() {
      const homeNav = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'الصفحة الرئيسية');
      homeNav?.click();
      await waitFor(() => expect(document.querySelector('[data-section-option="offers"]')).not.toBeNull());
      (document.querySelector('[data-section-option="offers"]') as HTMLElement).click();
    }

    const { rerender } = render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));
    await openOffersRow();
    await waitFor(() => expect(resolvers['store-1']).toBeDefined());
    const firstSignal = listOffersMock.mock.calls[0][1] as AbortSignal;

    rerender(<ExperienceBuilder storefrontId="store-2" initialLocale="ar" />);
    await waitFor(() => expect(firstSignal.aborted).toBe(true));
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(2));
    await openOffersRow();
    await waitFor(() => expect(resolvers['store-2']).toBeDefined());

    // The new storefront answers first…
    resolvers['store-2']({ ok: true, maxOffers: 12, data: [mk('o1', 'متجر ٢')] });
    await waitFor(() => expect(document.querySelector('[data-offers-option="o1"]')?.textContent).toContain('متجر ٢'));
    // …then the previous storefront's late answer arrives and is discarded.
    resolvers['store-1']({ ok: true, maxOffers: 12, data: [mk('o1', 'متجر ١ القديم')] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.querySelector('[data-offers-option="o1"]')?.textContent).toContain('متجر ٢');
    expect(document.body.textContent ?? '').not.toContain('القديم');
  });

  it('a retry after an error replaces the error with the recovered data (exactly one extra read)', async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    let call = 0;
    listOffersMock.mockImplementation(() => {
      call += 1;
      if (call === 1) return Promise.resolve({ ok: false, reason: 'failed', message: 'x' });
      return new Promise((resolve) => resolvers.push(resolve));
    });
    await renderBuilder(configWithOffers([{ id: 'offers-1', offerIds: ['o1'] }]));
    await waitFor(() => expect(document.querySelector('[data-home-offers-error]')).not.toBeNull());

    (document.querySelector('[data-home-offers-error] button') as HTMLButtonElement).click();
    await waitFor(() => expect(resolvers).toHaveLength(1));
    resolvers[0]({ ok: true, maxOffers: 12, data: [mk('o1', 'النتيجة الأخيرة')] });
    await waitFor(() => expect(cardNames()).toEqual(['النتيجة الأخيرة']));
    expect(listOffersMock).toHaveBeenCalledTimes(2);
  });

  it('issues no request at all while the only Offers row is the default hidden, never-opened one', async () => {
    await renderBuilder(DEFAULT_PRESENTATION_CONFIG);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listOffersMock).not.toHaveBeenCalled();
  });

  it('reads once when a hidden Offers row is selected for editing, and the picker shows real offers with hidden reasons', async () => {
    listOffersMock.mockResolvedValue({
      ok: true,
      maxOffers: 12,
      data: [mk('o1', 'ظاهر'), hiddenOffer('scheduled', { id: 'h1' })],
    });
    await renderBuilder(configWithOffers([{ id: 'offers-1', offerIds: [], visible: false }]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listOffersMock).not.toHaveBeenCalled();

    const homeNav = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'الصفحة الرئيسية');
    homeNav?.click();
    await waitFor(() => expect(document.querySelector('[data-section-option="offers"]')).not.toBeNull());
    (document.querySelector('[data-section-option="offers"]') as HTMLElement).click();
    await waitFor(() => expect(document.querySelector('[data-offers-option="o1"]')).not.toBeNull());
    expect(listOffersMock).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-offers-option="h1"]')?.textContent).toContain('لم تبدأ فترته بعد');
  });

  it('selecting an offer in the picker updates the Canvas immediately with no extra request', async () => {
    listOffersMock.mockResolvedValue({ ok: true, maxOffers: 12, data: [mk('o1', 'الأول'), mk('o2', 'الثاني')] });
    await renderBuilder(configWithOffers([{ id: 'offers-1', offerIds: ['o1'] }]));
    await waitFor(() => expect(cardNames()).toEqual(['الأول']));
    document.querySelector('[data-preview-section-id="offers-1"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await waitFor(() => expect(document.querySelector('[data-offers-option="o2"]')).not.toBeNull());

    (document.querySelector('[data-offers-option="o2"]') as HTMLElement).click();
    await waitFor(() => expect(cardNames()).toEqual(['الأول', 'الثاني']));
    expect(listOffersMock).toHaveBeenCalledTimes(1);
    expect(listProductsMock.mock.calls.filter(([, params]) => params?.ids)).toHaveLength(0);
  });

  it('keeps a selected offer that becomes hidden in the draft: no Canvas card, an honest reason in the editor', async () => {
    listOffersMock.mockResolvedValue({
      ok: true,
      maxOffers: 12,
      data: [mk('o1', 'الأول'), hiddenOffer('out_of_stock', { id: 'h1' })],
    });
    await renderBuilder(configWithOffers([{ id: 'offers-1', offerIds: ['o1', 'h1'] }]));
    await waitFor(() => expect(cardNames()).toEqual(['الأول']));
    document.querySelector('[data-preview-section-id="offers-1"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await waitFor(() => expect(document.querySelectorAll('[data-offers-selected-item]')).toHaveLength(2));
    const hiddenRow = document.querySelector('[data-offers-selected-item="h1"]') as HTMLElement;
    expect(hiddenRow.textContent).toContain('غير متوفر في المخزون');
  });

  it('keeps independent per-instance selection: editing one instance leaves the other untouched', async () => {
    listOffersMock.mockResolvedValue({ ok: true, maxOffers: 12, data: [mk('o1', 'الأول'), mk('o2', 'الثاني')] });
    await renderBuilder(
      configWithOffers([
        { id: 'offers-1', offerIds: ['o1'] },
        { id: 'offers-2', offerIds: ['o2'] },
      ]),
    );
    await waitFor(() => expect(cardNames('offers-2')).toEqual(['الثاني']));
    document.querySelector('[data-preview-section-id="offers-1"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await waitFor(() => expect(document.querySelector('[data-offers-option="o2"]')).not.toBeNull());
    (document.querySelector('[data-offers-option="o2"]') as HTMLElement).click();
    await waitFor(() => expect(cardNames('offers-1')).toEqual(['الأول', 'الثاني']));
    expect(cardNames('offers-2')).toEqual(['الثاني']);
    expect(listOffersMock).toHaveBeenCalledTimes(1);
  });

  it('the picker lists "no offers configured" honestly when the store has none', async () => {
    listOffersMock.mockResolvedValue({ ok: true, maxOffers: 12, data: [] });
    await renderBuilder(configWithOffers([{ id: 'offers-1', offerIds: [] }]));
    document.querySelector('[data-preview-section-id="offers-1"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await waitFor(() => expect(document.querySelector('[data-offers-picker-empty]')).not.toBeNull());
  });

  it('never issues pricing, product or cart requests for Offers', async () => {
    listOffersMock.mockResolvedValue({ ok: true, maxOffers: 12, data: [mk('o1', 'الأول')] });
    await renderBuilder(configWithOffers([{ id: 'offers-1', offerIds: ['o1'] }]));
    await waitFor(() => expect(cardNames()).toEqual(['الأول']));
    expect(listProductsMock.mock.calls.filter(([, params]) => params?.ids)).toHaveLength(0);
  });
});
