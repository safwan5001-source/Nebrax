/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const storeContext = vi.hoisted(() => ({ viewStoreUrl: 'https://store.example.test' as string | null }));
const pushMock = vi.fn();
const createMock = vi.fn();
const saveMock = vi.fn();
const deleteMock = vi.fn();
const loadFacetsMock = vi.fn();
const loadSetupMock = vi.fn();

vi.mock('@/modules/commerce-workspace/merchandising/client', () => ({
  loadFacets: (...args: unknown[]) => loadFacetsMock(...args),
}));
vi.mock('@/modules/commerce-workspace/vertical-setup', () => ({
  loadVerticalSetup: (...args: unknown[]) => loadSetupMock(...args),
}));

vi.mock('next-intl', () => ({
  useLocale: () => 'ar',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/lib/auth', () => ({ currentUser: () => ({ role: 'admin', permissions: ['commerce.manage'] }) }));
vi.mock('@/lib/permissions', () => ({ hasPermission: () => true }));

vi.mock('@/modules/commerce-workspace/store-context', () => ({
  useCommerceStoreContext: () => ({
    selectedStoreId: 'store-1',
    viewStoreUrl: storeContext.viewStoreUrl,
  }),
}));

vi.mock('@/modules/commerce-workspace/presentation-versions', () => ({
  createPresentationVersion: (...args: unknown[]) => createMock(...args),
  savePresentationVersion: (...args: unknown[]) => saveMock(...args),
  deletePresentationVersion: (...args: unknown[]) => deleteMock(...args),
}));

import { DEFAULT_PRESENTATION_CONFIG } from '@/modules/store-experience-builder/presentation';
import CommerceThemesPage from './page';

describe('Theme Gallery draft handoff', () => {
  afterEach(() => {
    cleanup();
    storeContext.viewStoreUrl = 'https://store.example.test';
    pushMock.mockReset();
    createMock.mockReset();
    saveMock.mockReset();
    deleteMock.mockReset();
    loadFacetsMock.mockReset();
    loadSetupMock.mockReset();
  });

  it('creates and saves an isolated draft Version before opening Store Experience', async () => {
    createMock.mockResolvedValue({
      ok: true,
      data: {
        id: 'version-1',
        storefrontId: 'store-1',
        name: 'أَوْج الحديث — Theme Gallery',
        state: 'draft',
        schemaVersion: 2,
        revision: 1,
        config: { ...DEFAULT_PRESENTATION_CONFIG, themePreset: 'navy', primaryColor: '#1e3a5f' },
      },
    });
    saveMock.mockResolvedValue({
      ok: true,
      data: {
        id: 'version-1',
        storefrontId: 'store-1',
        name: 'أَوْج الحديث — Theme Gallery',
        state: 'draft',
        schemaVersion: 2,
        revision: 2,
        config: DEFAULT_PRESENTATION_CONFIG,
      },
    });

    const user = userEvent.setup();
    render(<CommerceThemesPage />);

    await user.click(screen.getAllByRole('button', { name: 'استخدام الثيم' })[0]);

    await waitFor(() => expect(createMock).toHaveBeenCalledWith(
      'store-1',
      'أَوْج الحديث — Theme Gallery',
    ));
    expect(saveMock).toHaveBeenCalledWith(
      'store-1',
      'version-1',
      expect.objectContaining({
        themePreset: 'awj-modern',
        primaryColor: '#12372a',
      }),
      1,
    );
    expect(pushMock).toHaveBeenCalledWith('/commerce/appearance?version=version-1');
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('applies AWJ Market starting bundle while preserving unrelated draft fields', async () => {
    createMock.mockResolvedValue({
      ok: true,
      data: {
        id: 'version-market',
        storefrontId: 'store-1',
        name: 'أَوْج ماركت — Theme Gallery',
        state: 'draft',
        schemaVersion: 2,
        revision: 7,
        config: {
          ...DEFAULT_PRESENTATION_CONFIG,
          themePreset: 'awj-modern',
          primaryColor: '#12372a',
          density: 'comfortable',
          productCard: 'standard',
          header: { ...DEFAULT_PRESENTATION_CONFIG.header, style: 'standard' },
          radius: 'sharp',
        },
      },
    });
    saveMock.mockResolvedValue({
      ok: true,
      data: {
        id: 'version-market',
        storefrontId: 'store-1',
        name: 'أَوْج ماركت — Theme Gallery',
        state: 'draft',
        schemaVersion: 2,
        revision: 8,
        config: DEFAULT_PRESENTATION_CONFIG,
      },
    });

    const user = userEvent.setup();
    render(<CommerceThemesPage />);
    await user.click(screen.getAllByRole('button', { name: 'استخدام الثيم' })[1]);

    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock).toHaveBeenCalledWith(
      'store-1',
      'version-market',
      expect.objectContaining({
        themePreset: 'awj-market',
        primaryColor: '#0f766e',
        density: 'compact',
        productCard: 'compact',
        header: expect.objectContaining({ style: 'compact' }),
        radius: 'sharp',
      }),
      7,
    );
    expect(pushMock).toHaveBeenCalledWith('/commerce/appearance?version=version-market');
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('cleans up a newly-created draft if applying the theme fails', async () => {
    createMock.mockResolvedValue({
      ok: true,
      data: {
        id: 'version-2',
        storefrontId: 'store-1',
        name: 'أَوْج الحديث — Theme Gallery',
        state: 'draft',
        schemaVersion: 2,
        revision: 1,
        config: DEFAULT_PRESENTATION_CONFIG,
      },
    });
    saveMock.mockResolvedValue({ ok: false, reason: 'conflict', message: 'stale' });
    deleteMock.mockResolvedValue(true);

    const user = userEvent.setup();
    render(<CommerceThemesPage />);
    await user.click(screen.getAllByRole('button', { name: 'استخدام الثيم' })[0]);

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('store-1', 'version-2'));
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/لم يتغير المتجر الحي/);
  });

  it('lists the three official themes and every one of them is applicable', () => {
    render(<CommerceThemesPage />);

    expect(screen.getByText('أَوْج ماركت')).toBeTruthy();
    expect(screen.getByText('أَوْج بلوم')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'استخدام الثيم' })).toHaveLength(3);
  });

  describe('AWJ Bloom (FLOWERS-H15)', () => {
    const bloomVersion = (config = DEFAULT_PRESENTATION_CONFIG) => ({
      ok: true,
      data: {
        id: 'version-bloom',
        storefrontId: 'store-1',
        name: 'أَوْج بلوم — Theme Gallery',
        state: 'draft',
        schemaVersion: 2,
        revision: 3,
        config,
      },
    });
    const baseConfig = {
      ...DEFAULT_PRESENTATION_CONFIG,
      homepage: {
        ...DEFAULT_PRESENTATION_CONFIG.homepage,
        sections: [
          { id: 'hero-1', type: 'hero' as const, visible: true },
          { id: 'cat-1', type: 'categories' as const, visible: true },
        ],
      },
    };

    it('applies the preset and adds only the gift sections the store can back', async () => {
      createMock.mockResolvedValue(bloomVersion(baseConfig));
      saveMock.mockResolvedValue(bloomVersion());
      loadFacetsMock.mockResolvedValue([
        { id: 'f1', key: 'occasions-mine', systemKey: 'occasion', isActive: true },
        { id: 'f2', key: 'recipient', systemKey: 'recipient', isActive: false },
        { id: 'f3', key: 'flower-type', systemKey: null, isActive: true },
      ]);
      loadSetupMock.mockResolvedValue({
        vertical: 'flowers_gifts',
        items: [{ key: 'delivery_scheduling', available: true, state: 'configured', count: 3, manageIn: 'delivery_schedule' }],
      });

      const user = userEvent.setup();
      render(<CommerceThemesPage />);
      await user.click(screen.getAllByRole('button', { name: 'استخدام الثيم' })[2]);

      await waitFor(() => expect(saveMock).toHaveBeenCalled());
      const saved = saveMock.mock.calls[0][2];
      expect(saved).toMatchObject({ themePreset: 'awj-bloom', primaryColor: '#9d2449' });
      expect(saved.homepage.sections.map((section: { type: string }) => section.type)).toEqual([
        'hero',
        'discovery',
        'deliveryPromise',
        'categories',
      ]);
      expect(saved.homepage.sections[1].content).toMatchObject({ dimension: 'occasions-mine', title: 'تسوّق حسب المناسبة' });
      expect(pushMock).toHaveBeenCalledWith('/commerce/appearance?version=version-bloom');
    });

    it('still applies the theme, without sections, when the data cannot be read', async () => {
      createMock.mockResolvedValue(bloomVersion(baseConfig));
      saveMock.mockResolvedValue(bloomVersion());
      loadFacetsMock.mockRejectedValue(new Error('network'));
      loadSetupMock.mockResolvedValue(null);

      const user = userEvent.setup();
      render(<CommerceThemesPage />);
      await user.click(screen.getAllByRole('button', { name: 'استخدام الثيم' })[2]);

      await waitFor(() => expect(saveMock).toHaveBeenCalled());
      const saved = saveMock.mock.calls[0][2];
      expect(saved.themePreset).toBe('awj-bloom');
      expect(saved.homepage.sections).toEqual(baseConfig.homepage.sections);
      expect(pushMock).toHaveBeenCalled();
    });

    it('a store with no taxonomy and no schedule gets the color only', async () => {
      createMock.mockResolvedValue(bloomVersion(baseConfig));
      saveMock.mockResolvedValue(bloomVersion());
      loadFacetsMock.mockResolvedValue([]);
      loadSetupMock.mockResolvedValue({ vertical: 'general', items: [] });

      const user = userEvent.setup();
      render(<CommerceThemesPage />);
      await user.click(screen.getAllByRole('button', { name: 'استخدام الثيم' })[2]);

      await waitFor(() => expect(saveMock).toHaveBeenCalled());
      expect(saveMock.mock.calls[0][2].homepage.sections).toEqual(baseConfig.homepage.sections);
    });

    it('the other themes never read the store data for the gift pack', async () => {
      createMock.mockResolvedValue({ ...bloomVersion(baseConfig), data: { ...bloomVersion(baseConfig).data, id: 'v' } });
      saveMock.mockResolvedValue(bloomVersion());

      const user = userEvent.setup();
      render(<CommerceThemesPage />);
      await user.click(screen.getAllByRole('button', { name: 'استخدام الثيم' })[1]);

      await waitFor(() => expect(saveMock).toHaveBeenCalled());
      expect(loadFacetsMock).not.toHaveBeenCalled();
      expect(loadSetupMock).not.toHaveBeenCalled();
    });
  });
  // CUST-HV V1A / DEF-4 — "Preview" used to open the live store from every
  // theme card, which a merchant reads as "this is what the theme looks like".
  // It never was. The gallery now offers one honest link, to the published
  // store, and says plainly what applying a theme does.
  describe('honest store link (DEF-4)', () => {
    it('offers no per-theme "Preview" link — the cards carry only apply / customize actions', () => {
      render(<CommerceThemesPage />);

      expect(screen.queryByText('معاينة المتجر')).toBeNull();
      expect(screen.queryByRole('link', { name: /معاينة/ })).toBeNull();
      const cards = screen.getAllByRole('article');
      expect(cards.length).toBeGreaterThan(0);
      for (const card of cards) {
        expect(card.querySelector('a[href^="http"]')).toBeNull();
      }
    });

    it('shows a single "View published store" link to the live store, opened safely in a new tab', () => {
      render(<CommerceThemesPage />);

      const links = screen.getAllByRole('link', { name: 'عرض المتجر المنشور' });
      expect(links).toHaveLength(1);
      expect(links[0].getAttribute('href')).toBe('https://store.example.test');
      expect(links[0].getAttribute('target')).toBe('_blank');
      expect(links[0].getAttribute('rel')).toContain('noreferrer');
    });

    it('explains that using a theme creates a new draft and leaves the published store untouched', () => {
      render(<CommerceThemesPage />);

      expect(
        screen.getByText(/استخدام ثيم ينشئ مسودة جديدة، ولا يتغير متجرك المنشور حتى تنشرها/),
      ).toBeTruthy();
    });

    it('replaces the link with an explanation while the store domain is not provisioned', () => {
      storeContext.viewStoreUrl = null;
      render(<CommerceThemesPage />);

      expect(screen.queryByRole('link', { name: 'عرض المتجر المنشور' })).toBeNull();
      expect(screen.getByText('يظهر رابط المتجر المنشور بعد تجهيز نطاق المتجر.')).toBeTruthy();
    });
  });
});
