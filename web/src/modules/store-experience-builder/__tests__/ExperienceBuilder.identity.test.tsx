/**
 * @vitest-environment jsdom
 *
 * CUST-H3-1 — Store Identity Studio shell + branding consolidation. Covers:
 * one merchant-facing Identity entry grouping display name/logo/compact
 * logo/favicon, Identity staying Global across Home/Product/Category (no
 * lost values, no Draft/Version mutation from switching pages alone),
 * distinct accessible names per logo slot, the no-logo → display-name
 * fallback, and RTL/LTR label rendering. This file does not re-litigate
 * CUST-H1/H2 — see `ExperienceBuilder.pageNavigator.test.tsx` and
 * `ExperienceBuilder.versions.test.tsx` for that coverage.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const listProductsMock = vi.fn();
const showProductMock = vi.fn();
const listCategoriesMock = vi.fn();
const showCategoryMock = vi.fn();

vi.mock('@/modules/commerce-workspace/workspace-products', () => ({
  listWorkspaceProducts: (...args: unknown[]) => listProductsMock(...args),
  showWorkspaceProduct: (...args: unknown[]) => showProductMock(...args),
}));

vi.mock('@/modules/commerce-workspace/workspace-categories', () => ({
  listWorkspaceCategories: (...args: unknown[]) => listCategoriesMock(...args),
  showWorkspaceCategory: (...args: unknown[]) => showCategoryMock(...args),
}));

import {
  clonePresentationConfig,
  DEFAULT_PRESENTATION_CONFIG,
  type StorefrontPresentationConfig,
} from '../presentation';
import { ExperienceBuilder } from '../ExperienceBuilder';

// A minimal, validly-formed (not a real image) base64 PNG data URL — enough
// to pass `sanitizeLogoUrl`'s format check without depending on FileReader.
const FIXTURE_LOGO = 'data:image/png;base64,aGVsbG8=';
const FIXTURE_COMPACT_LOGO = 'data:image/png;base64,d29ybGQ=';
const FIXTURE_FAVICON = 'data:image/png;base64,Zm9v';

function configWithBranding(
  overrides: Partial<StorefrontPresentationConfig['branding']>,
): StorefrontPresentationConfig {
  const config = clonePresentationConfig(DEFAULT_PRESENTATION_CONFIG);
  config.branding = { ...config.branding, ...overrides };
  return config;
}

function builderRoot(): HTMLElement {
  return document.querySelector('[data-experience-builder]') as HTMLElement;
}

async function openIdentityPanel(user: ReturnType<typeof userEvent.setup>) {
  // `data-panel-option="branding"` is the sidebar nav button for the
  // Identity panel. Its accessible name ("Identity"/"الهوية") is not unique
  // on the page — the preview canvas's click-to-edit logo chrome carries the
  // same label — so this targets the nav entry specifically.
  const navButton = document.querySelector(
    '[data-panel-option="branding"]',
  ) as HTMLElement;
  await user.click(navButton);
}

describe('ExperienceBuilder — CUST-H3-1 Store Identity Studio', () => {
  afterEach(() => {
    cleanup();
    listProductsMock.mockReset();
    showProductMock.mockReset();
    listCategoriesMock.mockReset();
    showCategoryMock.mockReset();
  });

  it('groups display name, logo, compact logo and favicon under one merchant-facing Identity entry with an explanatory intro', async () => {
    const user = userEvent.setup();
    render(
      <ExperienceBuilder
        initialLocale="en"
        initialConfig={configWithBranding({ displayName: 'Al-Noor Store' })}
      />,
    );
    await openIdentityPanel(user);

    expect(screen.getByRole('heading', { name: 'Identity' })).toBeTruthy();
    expect(
      screen.getByText(
        "Your store's name and logo live here together. The compact logo appears in the mobile header, and the favicon shows in the browser tab.",
      ),
    ).toBeTruthy();
    expect(screen.getByDisplayValue('Al-Noor Store')).toBeTruthy();
    expect(screen.getByText('Store logo')).toBeTruthy();
    expect(screen.getByText('Compact mobile logo')).toBeTruthy();
    expect(screen.getByText('Favicon')).toBeTruthy();
    // No internal storage keys leak into merchant-facing copy.
    expect(screen.queryByText('branding.displayName')).toBeNull();
    expect(screen.queryByText('logoDataUrl', { exact: false })).toBeNull();
  });

  it('renders the same Identity grouping in Arabic RTL with the localized labels', async () => {
    const user = userEvent.setup();
    render(
      <ExperienceBuilder
        initialLocale="ar"
        initialConfig={configWithBranding({ displayName: 'متجر النور' })}
      />,
    );
    expect(builderRoot().getAttribute('dir')).toBe('rtl');

    await openIdentityPanel(user);
    expect(screen.getByRole('heading', { name: 'الهوية' })).toBeTruthy();
    expect(
      screen.getByText(
        'اسم متجرك وشعاره يُحفظان هنا معاً. الشعار المصغّر يظهر في الرأس المضغوط على الجوال، وأيقونة التبويب تظهر في شريط المتصفح.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('شعار المتجر')).toBeTruthy();
    expect(screen.getByText('شعار مصغّر للجوال')).toBeTruthy();
    expect(screen.getByText('أيقونة التبويب')).toBeTruthy();
  });

  it('keeps Identity open and its values intact across Home → Product → Category → Home, without touching Draft state', async () => {
    listProductsMock.mockResolvedValue({ ok: true, data: [], hasMore: false });
    showProductMock.mockResolvedValue({ ok: false, reason: 'not_found', message: 'not found' });
    listCategoriesMock.mockResolvedValue({ ok: true, data: [], hasMore: false });
    showCategoryMock.mockResolvedValue({ ok: false, reason: 'not_found', message: 'not found' });

    const user = userEvent.setup();
    // Local-only mode (no storefrontId): page switching needs no network and
    // exercises the same `handleSelectPage` logic the persisted path uses.
    render(
      <ExperienceBuilder
        initialLocale="en"
        initialConfig={configWithBranding({ displayName: 'Al-Noor Store' })}
      />,
    );
    await openIdentityPanel(user);
    expect(builderRoot().getAttribute('data-panel')).toBe('branding');
    expect(builderRoot().getAttribute('data-lifecycle')).toBe('clean');

    await user.click(screen.getByLabelText('Page currently being viewed'));
    await user.click(screen.getByRole('button', { name: 'Product page' }));
    expect(builderRoot().getAttribute('data-current-page')).toBe('product');
    // Global panel: switching pages must not fall back away from Identity,
    // unlike the page-specific "homepage"/"product"/"category" panels.
    expect(builderRoot().getAttribute('data-panel')).toBe('branding');
    expect(screen.getByDisplayValue('Al-Noor Store')).toBeTruthy();
    expect(builderRoot().getAttribute('data-lifecycle')).toBe('clean');

    await user.click(screen.getByLabelText('Page currently being viewed'));
    await user.click(screen.getByRole('button', { name: 'Category page' }));
    expect(builderRoot().getAttribute('data-current-page')).toBe('category');
    expect(builderRoot().getAttribute('data-panel')).toBe('branding');
    expect(screen.getByDisplayValue('Al-Noor Store')).toBeTruthy();
    expect(builderRoot().getAttribute('data-lifecycle')).toBe('clean');

    await user.click(screen.getByLabelText('Page currently being viewed'));
    await user.click(screen.getByRole('button', { name: 'Home' }));
    expect(builderRoot().getAttribute('data-current-page')).toBe('home');
    expect(builderRoot().getAttribute('data-panel')).toBe('branding');
    expect(screen.getByDisplayValue('Al-Noor Store')).toBeTruthy();
    expect(builderRoot().getAttribute('data-lifecycle')).toBe('clean');
  });

  it('falls back to the display name as text when no logo is set, and renders an image once a logo exists', async () => {
    const { unmount } = render(
      <ExperienceBuilder
        initialLocale="en"
        initialConfig={configWithBranding({ displayName: 'Al-Noor Store', logoDataUrl: null })}
      />,
    );
    const headerBrand = document.querySelector(
      '[data-preview-chrome="branding"]',
    ) as HTMLElement;
    expect(within(headerBrand).getByText('Al-Noor Store')).toBeTruthy();
    expect(within(headerBrand).queryByRole('img')).toBeNull();
    unmount();

    render(
      <ExperienceBuilder
        initialLocale="en"
        initialConfig={configWithBranding({ displayName: 'Al-Noor Store', logoDataUrl: FIXTURE_LOGO })}
      />,
    );
    const headerBrandWithLogo = document.querySelector(
      '[data-preview-chrome="branding"]',
    ) as HTMLElement;
    const logoImg = within(headerBrandWithLogo).getByAltText('Al-Noor Store') as HTMLImageElement;
    expect(logoImg.src).toBe(FIXTURE_LOGO);
  });

  it('shows a thumbnail preview for a saved logo, and removing it restores the no-logo message without touching the other identity fields', async () => {
    const user = userEvent.setup();
    render(
      <ExperienceBuilder
        initialLocale="en"
        initialConfig={configWithBranding({
          displayName: 'Al-Noor Store',
          logoDataUrl: FIXTURE_LOGO,
          compactLogoDataUrl: FIXTURE_COMPACT_LOGO,
          faviconDataUrl: FIXTURE_FAVICON,
        })}
      />,
    );
    await openIdentityPanel(user);

    expect(screen.getByLabelText('Store logo — Remove')).toBeTruthy();
    expect(screen.getByLabelText('Compact mobile logo — Remove')).toBeTruthy();
    expect(screen.getByLabelText('Favicon — Remove')).toBeTruthy();

    await user.click(screen.getByLabelText('Compact mobile logo — Remove'));

    expect(screen.queryByLabelText('Compact mobile logo — Remove')).toBeNull();
    expect(screen.getAllByText('No logo — typographic name is used')).toHaveLength(1);
    // The other two slots, and the display name, are untouched.
    expect(screen.getByLabelText('Store logo — Remove')).toBeTruthy();
    expect(screen.getByLabelText('Favicon — Remove')).toBeTruthy();
    expect(screen.getByDisplayValue('Al-Noor Store')).toBeTruthy();
  });

  it('gives each logo slot a distinct accessible name for its upload input and remove action', async () => {
    const user = userEvent.setup();
    render(
      <ExperienceBuilder
        initialLocale="en"
        initialConfig={configWithBranding({
          logoDataUrl: FIXTURE_LOGO,
          compactLogoDataUrl: FIXTURE_COMPACT_LOGO,
          faviconDataUrl: FIXTURE_FAVICON,
        })}
      />,
    );
    await openIdentityPanel(user);

    // Three previously-identical "Choose image" accessible names, now distinct.
    expect(screen.getByLabelText('Store logo — Choose image')).toBeTruthy();
    expect(screen.getByLabelText('Compact mobile logo — Choose image')).toBeTruthy();
    expect(screen.getByLabelText('Favicon — Choose image')).toBeTruthy();
    expect(screen.getByLabelText('Store logo — Remove')).toBeTruthy();
    expect(screen.getByLabelText('Compact mobile logo — Remove')).toBeTruthy();
    expect(screen.getByLabelText('Favicon — Remove')).toBeTruthy();
  });

  it('is reachable and usable at a 390px mobile viewport via click-to-edit on the preview logo, with no new toolbar entry added', async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    const user = userEvent.setup();
    render(
      <ExperienceBuilder
        initialLocale="en"
        initialConfig={configWithBranding({ displayName: 'Al-Noor Store', logoDataUrl: FIXTURE_LOGO })}
      />,
    );

    // Preview-first: the mobile toolbar keeps exactly its existing three
    // buttons (Sections / + Add section / Design) — H3-1 adds no fourth one.
    const toolbarButtons = document.querySelectorAll('.border-t.border-border button');
    expect(toolbarButtons.length).toBe(3);

    const logoChrome = document.querySelector('[data-preview-chrome="branding"]') as HTMLElement;
    expect(logoChrome).toBeTruthy();
    await user.click(logoChrome);

    expect(builderRoot().getAttribute('data-panel')).toBe('branding');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Store logo')).toBeTruthy();
    expect(within(dialog).getByLabelText('Store logo — Remove')).toBeTruthy();

    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, configurable: true });
  });
});
