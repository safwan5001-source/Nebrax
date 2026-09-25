import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const locale = { current: 'ar' };

vi.mock('next-intl', () => ({
  useLocale: () => locale.current,
}));

vi.mock('@/modules/commerce-workspace/store-context', () => ({
  useCommerceStoreContext: () => ({
    catalog: {
      status: 'ready',
      stores: [{ id: 's1', name: 'متجر النور', salesChannelId: 'c1', isActive: true, previewUrl: null, defaultLocale: 'ar' }],
    },
    selectedStoreId: 's1',
    setSelectedStoreId: vi.fn(),
    viewStoreUrl: null,
    refresh: vi.fn(),
  }),
}));

import CommerceAppearancePage from './page';

function builderRoot(): HTMLElement {
  const root = document.querySelector('[data-experience-builder]');
  if (!root) throw new Error('builder root missing');
  return root as HTMLElement;
}

describe('commerce appearance — STORE-CUSTOMIZER-V2-1 shell and section selection', () => {
  beforeEach(() => {
    // jsdom does not implement scrollIntoView; the builder guards for that,
    // and here we observe the scroll trigger explicitly.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    locale.current = 'ar';
    vi.restoreAllMocks();
  });

  it('keeps toolbar / sidebar / preview as independent scroll regions', () => {
    render(<CommerceAppearancePage />);
    const regions = document.querySelectorAll('[data-customizer-scroll]');
    // sidebar nav + settings panel + preview canvas
    expect(regions.length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('بناء تجربة المتجر')).toBeTruthy();
    expect(screen.getByLabelText('معاينة المتجر')).toBeTruthy();
  });

  it('selects a section from the sidebar composer and syncs the preview', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await user.click(screen.getByRole('button', { name: 'الصفحة الرئيسية' }));
    await user.click(screen.getByRole('button', { name: 'التصنيفات' }));

    expect(builderRoot().dataset.selectedSection).toBe('categories');

    const composerRow = screen.getByRole('button', { name: 'التصنيفات' });
    expect(composerRow.getAttribute('aria-pressed')).toBe('true');

    const previewSection = document.querySelector(
      '[data-preview-section="categories"]',
    );
    expect(previewSection).toBeTruthy();
    expect(previewSection?.getAttribute('data-section-selected')).not.toBeNull();
    expect(previewSection?.getAttribute('aria-pressed')).toBe('true');
  });

  it('scrolls the preview to the section chosen from the sidebar', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await user.click(screen.getByRole('button', { name: 'الصفحة الرئيسية' }));
    await user.click(screen.getByRole('button', { name: 'الجملة' }));

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    const call = vi.mocked(Element.prototype.scrollIntoView).mock.calls.at(-1);
    expect(call?.[0]).toMatchObject({ block: 'start' });
  });

  it('uses a non-smooth scroll when the user prefers reduced motion', async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await user.click(screen.getByRole('button', { name: 'الصفحة الرئيسية' }));
    await user.click(screen.getByRole('button', { name: 'وصل حديثاً' }));

    const call = vi.mocked(Element.prototype.scrollIntoView).mock.calls.at(-1);
    expect(call?.[0]).toMatchObject({ behavior: 'auto' });

    window.matchMedia = originalMatchMedia;
  });

  it('clicking a section inside the preview selects it without scrolling again', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);

    const previewSection = document.querySelector(
      '[data-preview-section="hero"]',
    ) as HTMLElement;
    expect(previewSection).toBeTruthy();
    await user.click(previewSection);

    expect(builderRoot().dataset.selectedSection).toBe('hero');
    // Sidebar synced: homepage panel opened and composer row pressed.
    expect(builderRoot().dataset.panel).toBe('homepage');
    const composerHero = document.querySelector('[data-section-option="hero"]');
    expect(composerHero?.getAttribute('aria-pressed')).toBe('true');
    // Preview-origin selection must not trigger a scroll jump.
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('keeps Desktop/Tablet/Mobile preview modes working', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await user.click(screen.getByRole('button', { name: 'جوال' }));
    expect(builderRoot().dataset.device).toBe('mobile');
    expect(
      document.querySelector('[data-preview-viewport]')?.getAttribute(
        'data-preview-viewport',
      ),
    ).toBe('mobile');
    await user.click(screen.getByRole('button', { name: 'جهاز لوحي' }));
    expect(builderRoot().dataset.device).toBe('tablet');
  });

  it('preserves composer visibility and reorder behaviour', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await user.click(screen.getByRole('button', { name: 'الصفحة الرئيسية' }));

    // Hide the hero: its preview section disappears.
    const heroRow = document.querySelector('[data-composer-section="hero"]');
    const toggle = heroRow?.querySelector('input[type="checkbox"]') as HTMLElement;
    expect(toggle).toBeTruthy();
    await user.click(toggle);
    expect(
      document.querySelector('[data-preview-section="hero"]'),
    ).toBeNull();

    // Reorder: move categories up above its previous sibling.
    const before = Array.from(
      document.querySelectorAll('[data-composer-section]'),
    ).map((el) => el.getAttribute('data-composer-section'));
    const categoriesIndex = before.indexOf('categories');
    const rows = document.querySelectorAll('[data-composer-section]');
    const upButton = rows[categoriesIndex].querySelector(
      'button[aria-label="أعلى"]',
    ) as HTMLElement;
    await user.click(upButton);
    const after = Array.from(
      document.querySelectorAll('[data-composer-section]'),
    ).map((el) => el.getAttribute('data-composer-section'));
    expect(after.indexOf('categories')).toBe(categoriesIndex - 1);
  });

  it('routes header, logo and footer clicks to their existing panels', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);

    const header = document.querySelector(
      'header[data-preview-chrome="header"]',
    ) as HTMLElement;
    expect(header).toBeTruthy();
    await user.click(screen.getByText('السعودية · ر.س'));
    expect(builderRoot().dataset.panel).toBe('header');
    expect(builderRoot().dataset.selectedChrome).toBe('header');
    expect(header.getAttribute('aria-pressed')).toBe('true');

    const logo = document.querySelector(
      '[data-preview-chrome="branding"]',
    ) as HTMLElement;
    await user.click(logo);
    expect(builderRoot().dataset.panel).toBe('branding');
    expect(builderRoot().dataset.selectedChrome).toBe('branding');
    expect(builderRoot().dataset.selectedSection).toBe('');

    const footer = document.querySelector(
      'footer[data-preview-chrome="footer"]',
    ) as HTMLElement;
    await user.click(footer);
    expect(builderRoot().dataset.panel).toBe('footer');
    expect(footer.getAttribute('aria-pressed')).toBe('true');
  });
});

