/**
 * @vitest-environment jsdom
 *
 * CUST-H2-2 — Page Navigator + page-aware Canvas shell. Covers: default page
 * state, Home/Product/Category switching, Version-vs-Page independence (no
 * Save, no Version GET, no dirty, Version stays put), Home-section-selection
 * reset on page switch, panel/nav hiding for the Home-only "homepage" panel,
 * the mobile Page Navigator bottom sheet, and RTL label rendering.
 * `ExperienceBuilder.versions.test.tsx` already covers the Version Manager
 * itself in depth — this file only asserts Page/Version independence, not
 * Version Manager internals.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

import { DEFAULT_PRESENTATION_CONFIG } from '../presentation';
import { ExperienceBuilder } from '../ExperienceBuilder';

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'v1',
    storefrontId: 'store-1',
    name: 'Current design',
    state: 'draft',
    schemaVersion: 1,
    revision: 0,
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

function detail(overrides: Record<string, unknown> = {}) {
  const { config, ...rest } = overrides;
  return { ...summary(rest), config: config ?? DEFAULT_PRESENTATION_CONFIG };
}

function builderRoot(): HTMLElement {
  return document.querySelector('[data-experience-builder]') as HTMLElement;
}

function canvas(): HTMLElement {
  return document.querySelector('[data-preview-canvas]') as HTMLElement;
}

async function openPageNavigator(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText('Page currently being viewed'));
}

describe('ExperienceBuilder — CUST-H2-2 Page Navigator', () => {
  afterEach(() => {
    cleanup();
    listMock.mockReset();
    showMock.mockReset();
    saveMock.mockReset();
  });

  it('defaults to Home: toolbar, canvas and mobile pill all agree, with no Product/Category placeholder', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary()] });
    showMock.mockResolvedValue({ ok: true, data: detail() });
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));

    expect(builderRoot().getAttribute('data-current-page')).toBe('home');
    expect(canvas().getAttribute('data-preview-page')).toBe('home');
    expect(document.querySelector('[data-page-placeholder]')).toBeNull();
    expect(screen.getByLabelText('Page currently being viewed').textContent).toContain('Home');
  });

  it('switches Home → Product → Category → Home, updating the Canvas with an honest placeholder and no fake product/category data', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary()] });
    showMock.mockResolvedValue({ ok: true, data: detail() });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));

    await openPageNavigator(user);
    await user.click(screen.getByRole('button', { name: 'Product page' }));
    expect(builderRoot().getAttribute('data-current-page')).toBe('product');
    expect(canvas().getAttribute('data-preview-page')).toBe('product');
    expect(document.querySelector('[data-page-placeholder="product"]')).not.toBeNull();
    expect(
      screen.getByText(
        'Customizing the product page will become available in the next step. This is page context only, not real product data.',
      ),
    ).toBeTruthy();

    await openPageNavigator(user);
    await user.click(screen.getByRole('button', { name: 'Category page' }));
    expect(builderRoot().getAttribute('data-current-page')).toBe('category');
    expect(canvas().getAttribute('data-preview-page')).toBe('category');
    expect(document.querySelector('[data-page-placeholder="product"]')).toBeNull();
    expect(document.querySelector('[data-page-placeholder="category"]')).not.toBeNull();

    await openPageNavigator(user);
    await user.click(screen.getByRole('button', { name: 'Home' }));
    expect(builderRoot().getAttribute('data-current-page')).toBe('home');
    expect(canvas().getAttribute('data-preview-page')).toBe('home');
    expect(document.querySelector('[data-page-placeholder]')).toBeNull();
  });

  it('keeps the open Version, viewport, locale and dirty/clean state untouched, and issues no Save or Version GET, across a page switch', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ revision: 3 })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ revision: 3 }) });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));

    // Desktop/tablet mode by default in jsdom (innerWidth defaults >= 768).
    await user.click(screen.getByRole('button', { name: 'Tablet' }));
    expect(builderRoot().getAttribute('data-device')).toBe('tablet');
    expect(builderRoot().getAttribute('data-lifecycle')).toBe('clean');
    const versionIdBefore = builderRoot().getAttribute('data-selected-version-id');
    const dirBefore = builderRoot().getAttribute('dir');

    await openPageNavigator(user);
    await user.click(screen.getByRole('button', { name: 'Product page' }));

    expect(builderRoot().getAttribute('data-selected-version-id')).toBe(versionIdBefore);
    expect(builderRoot().getAttribute('data-device')).toBe('tablet');
    expect(builderRoot().getAttribute('dir')).toBe(dirBefore);
    expect(builderRoot().getAttribute('data-lifecycle')).toBe('clean');
    expect(screen.getByText('No changes')).toBeTruthy();
    expect(showMock).toHaveBeenCalledTimes(1); // no re-fetch of the Version
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('does not carry the Home section/chrome selection onto Product/Category, and Home selection works again on return', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary()] });
    showMock.mockResolvedValue({ ok: true, data: detail() });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));

    const heroSection = document.querySelector('[data-preview-section="hero"]') as HTMLElement;
    await user.click(heroSection);
    await waitFor(() => expect(builderRoot().getAttribute('data-selected-section')).not.toBe(''));

    await openPageNavigator(user);
    await user.click(screen.getByRole('button', { name: 'Product page' }));
    expect(builderRoot().getAttribute('data-selected-section')).toBe('');
    expect(builderRoot().getAttribute('data-selected-chrome')).toBe('');

    await openPageNavigator(user);
    await user.click(screen.getByRole('button', { name: 'Home' }));
    const heroSectionAgain = document.querySelector('[data-preview-section="hero"]') as HTMLElement;
    await user.click(heroSectionAgain);
    await waitFor(() => expect(builderRoot().getAttribute('data-selected-section')).not.toBe(''));
  });

  it('hides the Home-only "Homepage" sidebar entry on Product/Category and restores it on Home, without ever showing Home section controls on the wrong page', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary()] });
    showMock.mockResolvedValue({ ok: true, data: detail() });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));

    expect(screen.getByRole('button', { name: 'Homepage' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Homepage' }));
    expect(screen.getByRole('button', { name: 'Homepage' }).getAttribute('aria-current')).toBe('page');

    await openPageNavigator(user);
    await user.click(screen.getByRole('button', { name: 'Product page' }));

    expect(screen.queryByRole('button', { name: 'Homepage' })).toBeNull();
    // The inspector must not silently keep rendering the Home composer for
    // the now-hidden "homepage" panel — it is redirected to a global panel.
    expect(screen.queryByText('Homepage controls', { exact: false })).toBeNull();
    expect(screen.getByRole('button', { name: 'Appearance' }).getAttribute('aria-current')).toBe('page');

    await openPageNavigator(user);
    await user.click(screen.getByRole('button', { name: 'Home' }));
    expect(screen.getByRole('button', { name: 'Homepage' })).toBeTruthy();
  });

  it('preserves the Product page context across a Version switch', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [summary({ id: 'a', name: 'Version A' }), summary({ id: 'b', name: 'Version B' })],
    });
    showMock.mockImplementation((_storefrontId: string, versionId: string) =>
      Promise.resolve({ ok: true, data: detail({ id: versionId, name: versionId === 'a' ? 'Version A' : 'Version B' }) }),
    );
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" versionId="a" initialLocale="en" />);
    await waitFor(() => expect(builderRoot().getAttribute('data-selected-version-id')).toBe('a'));

    await openPageNavigator(user);
    await user.click(screen.getByRole('button', { name: 'Product page' }));
    expect(builderRoot().getAttribute('data-current-page')).toBe('product');

    await user.click(screen.getByLabelText('Design version being edited'));
    const menu = screen.getByRole('menu', { name: 'Manage design versions' });
    const rowB = within(menu).getByText('Version B').closest('li') as HTMLElement;
    await user.click(within(rowB).getByRole('button', { name: 'Open to edit' }));

    await waitFor(() => expect(builderRoot().getAttribute('data-selected-version-id')).toBe('b'));
    expect(builderRoot().getAttribute('data-current-page')).toBe('product');
    expect(canvas().getAttribute('data-preview-page')).toBe('product');
  });

  it('resets to Home when a different storefront/version is opened (Theme Gallery handoff)', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary()] });
    showMock.mockResolvedValue({ ok: true, data: detail() });
    const user = userEvent.setup();
    const { rerender } = render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));

    await openPageNavigator(user);
    await user.click(screen.getByRole('button', { name: 'Product page' }));
    expect(builderRoot().getAttribute('data-current-page')).toBe('product');

    rerender(<ExperienceBuilder storefrontId="store-2" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(2));
    expect(builderRoot().getAttribute('data-current-page')).toBe('home');
  });

  it('opens the Page Navigator as a mobile bottom sheet and switches from it', async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    listMock.mockResolvedValue({ ok: true, data: [summary()] });
    showMock.mockResolvedValue({ ok: true, data: detail() });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    window.dispatchEvent(new Event('resize'));
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));

    const pill = document.querySelector('[data-page-navigator-mobile]') as HTMLElement;
    expect(pill).toBeTruthy();
    expect(pill.textContent).toContain('Home');
    await user.click(pill);

    const sheet = await screen.findByRole('dialog', { name: 'Choose a page' });
    await user.click(within(sheet).getByRole('button', { name: 'Category page' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(builderRoot().getAttribute('data-current-page')).toBe('category');
    expect(document.querySelector('[data-page-navigator-mobile]')?.textContent).toContain('Category page');

    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, configurable: true });
  });

  it('renders Arabic page labels under RTL', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ name: 'رمضان 1448' })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ name: 'رمضان 1448' }) });
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));

    expect(builderRoot().getAttribute('dir')).toBe('rtl');
    expect(screen.getByLabelText('الصفحة المعروضة حالياً').textContent).toContain('الرئيسية');
  });
});
