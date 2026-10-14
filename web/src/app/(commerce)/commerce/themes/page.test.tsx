/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const storeContext = vi.hoisted(() => ({ viewStoreUrl: 'https://store.example.test' as string | null, storeId: 'store-1' as string | null }));
const listMock = vi.fn();
const permission = vi.hoisted(() => ({ allowed: true }));

vi.mock('next-intl', () => ({
  useLocale: () => 'ar',
}));

vi.mock('@/lib/auth', () => ({ currentUser: () => ({ role: 'admin', permissions: ['commerce.manage'] }) }));
vi.mock('@/lib/permissions', () => ({ hasPermission: () => permission.allowed }));

vi.mock('@/modules/commerce-workspace/store-context', () => ({
  useCommerceStoreContext: () => ({
    selectedStoreId: storeContext.storeId,
    viewStoreUrl: storeContext.viewStoreUrl,
  }),
}));

vi.mock('@/modules/commerce-workspace/presentation-versions', () => ({
  listPresentationVersions: (...args: unknown[]) => listMock(...args),
}));

import { BUILT_IN_THEMES } from '@/modules/store-experience-builder/themes';
import CommerceThemesPage from './page';

function version(id: string, state: 'draft' | 'published' | 'scheduled', updatedAt: string) {
  return { id, state, updatedAt };
}

describe('Theme Gallery (CUST-HV V10b)', () => {
  afterEach(() => {
    cleanup();
    storeContext.viewStoreUrl = 'https://store.example.test';
    storeContext.storeId = 'store-1';
    permission.allowed = true;
    listMock.mockReset();
  });

  it('lists every built-in theme with its own name and a Preview & apply link', async () => {
    listMock.mockResolvedValue({ ok: true, data: [] });
    render(<CommerceThemesPage />);

    expect(screen.getAllByRole('article')).toHaveLength(BUILT_IN_THEMES.length);
    expect(screen.getByText('أَوْج ماركت')).toBeTruthy();
    expect(screen.getByText('أَوْج بلوم')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole('link', { name: 'معاينة وتطبيق' })).toHaveLength(BUILT_IN_THEMES.length));
    // Applying is no longer one click: no card applies directly.
    expect(screen.queryByRole('button', { name: 'استخدام الثيم' })).toBeNull();
  });

  it('previews over the Published Version when there is one', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [version('d1', 'draft', '2026-10-02'), version('p1', 'published', '2026-09-01'), version('d2', 'draft', '2026-10-05')],
    });
    render(<CommerceThemesPage />);

    await waitFor(() => {
      const link = document.querySelector('[data-theme-preview-link="awj-market"]');
      expect(link?.getAttribute('href')).toBe('/commerce/appearance?version=p1&previewTheme=awj-market&store=store-1');
    });
  });

  it('falls back to the most recently updated Version, and to none at all', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [version('d1', 'draft', '2026-10-02'), version('d2', 'scheduled', '2026-10-05')],
    });
    const { unmount } = render(<CommerceThemesPage />);
    await waitFor(() => {
      expect(document.querySelector('[data-theme-preview-link="awj-modern"]')?.getAttribute('href')).toBe(
        '/commerce/appearance?version=d2&previewTheme=awj-modern&store=store-1',
      );
    });
    unmount();

    listMock.mockResolvedValue({ ok: true, data: [] });
    render(<CommerceThemesPage />);
    await waitFor(() => {
      expect(document.querySelector('[data-theme-preview-link="awj-modern"]')?.getAttribute('href')).toBe(
        '/commerce/appearance?previewTheme=awj-modern&store=store-1',
      );
    });
  });

  it('offers no Preview link while the base version is still loading, nor when it failed to load (review)', async () => {
    let release: (value: unknown) => void = () => {};
    listMock.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const { unmount } = render(<CommerceThemesPage />);
    expect(screen.queryAllByRole('link', { name: 'معاينة وتطبيق' })).toHaveLength(0);
    expect(document.querySelector('[data-theme-preview-disabled="loading"]')).not.toBeNull();
    release({ ok: true, data: [version('p1', 'published', '2026-09-01')] });
    await waitFor(() => expect(screen.getAllByRole('link', { name: 'معاينة وتطبيق' })).toHaveLength(BUILT_IN_THEMES.length));
    unmount();

    listMock.mockReset();
    listMock.mockResolvedValue({ ok: false, reason: 'error' });
    render(<CommerceThemesPage />);
    await waitFor(() => expect(document.querySelector('[data-theme-base-error]')).not.toBeNull());
    expect(screen.queryAllByRole('link', { name: 'معاينة وتطبيق' })).toHaveLength(0);
    expect(document.querySelector('[data-theme-preview-link]')).toBeNull();
  });

  it('offers no Preview link without a store or without permission', () => {
    listMock.mockResolvedValue({ ok: true, data: [] });
    storeContext.storeId = null;
    render(<CommerceThemesPage />);
    expect(screen.queryAllByRole('link', { name: 'معاينة وتطبيق' })).toHaveLength(0);
    expect(listMock).not.toHaveBeenCalled();
    cleanup();

    storeContext.storeId = 'store-1';
    permission.allowed = false;
    render(<CommerceThemesPage />);
    expect(screen.queryAllByRole('link', { name: 'معاينة وتطبيق' })).toHaveLength(0);
  });

  // CUST-HV V1A / DEF-4 — one honest link to the published store, never a per-theme "preview" of the live store.
  describe('honest store link (DEF-4)', () => {
    it('shows a single "View published store" link to the live store, opened safely in a new tab', () => {
      listMock.mockResolvedValue({ ok: true, data: [] });
      render(<CommerceThemesPage />);

      const links = screen.getAllByRole('link', { name: 'عرض المتجر المنشور' });
      expect(links).toHaveLength(1);
      expect(links[0].getAttribute('href')).toBe('https://store.example.test');
      expect(links[0].getAttribute('target')).toBe('_blank');
      expect(links[0].getAttribute('rel')).toContain('noreferrer');
      for (const card of screen.getAllByRole('article')) {
        expect(card.querySelector('a[href^="http"]')).toBeNull();
      }
    });

    it('explains that a theme is previewed first and applied as a new draft', () => {
      listMock.mockResolvedValue({ ok: true, data: [] });
      render(<CommerceThemesPage />);
      expect(screen.getByText(/ثم طبّقه كمسودة جديدة؛ لا يتغير متجرك المنشور حتى تنشرها/)).toBeTruthy();
    });

    it('replaces the link with an explanation while the store domain is not provisioned', () => {
      listMock.mockResolvedValue({ ok: true, data: [] });
      storeContext.viewStoreUrl = null;
      render(<CommerceThemesPage />);

      expect(screen.queryByRole('link', { name: 'عرض المتجر المنشور' })).toBeNull();
      expect(screen.getByText('يظهر رابط المتجر المنشور بعد تجهيز نطاق المتجر.')).toBeTruthy();
    });
  });
});
