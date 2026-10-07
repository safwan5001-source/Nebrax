import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CUST-H4-2 review fix — the Section Library must follow the AWJ mobile
 * Bottom Sheet contract, not stack a second centered modal on top of the
 * existing "sections" sheet. These tests exercise the real mobile path
 * (390px viewport, through `ExperienceBuilder`'s own `isMobileViewport`
 * detection), not just the Library component in isolation.
 */

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

import { DEFAULT_PRESENTATION_CONFIG } from '@/modules/store-experience-builder/presentation';

const showMock = vi.fn(async () => ({
  ok: true,
  data: {
    id: 'v1',
    storefrontId: 's1',
    name: 'التصميم الحالي',
    state: 'draft',
    schemaVersion: 1,
    revision: 0,
    scheduledFor: null,
    lastPublishedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    config: DEFAULT_PRESENTATION_CONFIG,
  },
}));

vi.mock('@/modules/commerce-workspace/presentation-versions', () => ({
  listPresentationVersions: vi.fn(async () => ({
    ok: true,
    data: [
      {
        id: 'v1',
        storefrontId: 's1',
        name: 'التصميم الحالي',
        state: 'draft',
        schemaVersion: 1,
        revision: 0,
        scheduledFor: null,
        lastPublishedAt: null,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    ],
  })),
  showPresentationVersion: (...args: unknown[]) => showMock(...args),
  createPresentationVersion: vi.fn(),
  savePresentationVersion: vi.fn(),
  renamePresentationVersion: vi.fn(),
  deletePresentationVersion: vi.fn(),
}));

import CommerceAppearancePage from './page';

function setMobileViewport(width: number): () => void {
  const original = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  window.dispatchEvent(new Event('resize'));
  return () => {
    Object.defineProperty(window, 'innerWidth', { value: original, configurable: true });
  };
}

async function openMobileSectionsSheet(user: ReturnType<typeof userEvent.setup>) {
  // The bottom-nav "+ إضافة قسم" button opens the generic "sections" sheet
  // (ExperienceBuilder.tsx) — same sheet the dedicated "الأقسام" tab opens.
  await user.click(screen.getByRole('button', { name: /إضافة قسم/ }));
}

function mobileSheet(): HTMLElement {
  const sheets = screen.getAllByRole('dialog');
  // Exactly one aria-modal surface at a time — the review fix's own
  // "no nested centered modal" requirement, asserted structurally here so
  // every test in this file would fail loudly if that regressed.
  expect(sheets).toHaveLength(1);
  return sheets[0];
}

describe('CUST-H4-2 review fix — Section Library follows the mobile Bottom Sheet contract', () => {
  let restoreViewport: () => void;

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    restoreViewport = setMobileViewport(390);
  });

  afterEach(() => {
    cleanup();
    locale.current = 'ar';
    vi.restoreAllMocks();
    restoreViewport();
  });

  it('opens the Library inside the existing Sections Bottom Sheet, never as a second nested dialog', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await openMobileSectionsSheet(user);
    const sheet = mobileSheet();
    // The composer's own "+ Add section" trigger, now inside the sheet.
    await user.click(within(sheet).getByRole('button', { name: /إضافة قسم/ }));

    // Still exactly one dialog — the Library replaced the sheet's content,
    // it did not open on top of it.
    const sameSheet = mobileSheet();
    expect(sameSheet).toBe(sheet);
    const library = sameSheet.querySelector('[data-section-picker]');
    expect(library).toBeTruthy();
    // The library content itself carries no dialog/modal role of its own.
    expect(library?.getAttribute('role')).toBeNull();
    expect(library?.getAttribute('aria-modal')).toBeNull();
  });

  it('replaces the composer list while the Library is open (opening preserves the document, nothing is added yet)', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await openMobileSectionsSheet(user);
    const sheet = mobileSheet();
    const before = sheet.querySelectorAll('[data-composer-section]').length;
    expect(before).toBeGreaterThan(0);

    await user.click(within(sheet).getByRole('button', { name: /إضافة قسم/ }));
    expect(mobileSheet().querySelectorAll('[data-composer-section]')).toHaveLength(0);
    // Nothing was added by merely opening the Library.
    expect(
      document.querySelector('[data-experience-builder]')?.getAttribute('data-lifecycle'),
    ).toBe('clean');
  });

  it('CUST-H4-2 review fix (UX polish) — the Library shows a Back control, not a second Close, and clicking it returns to the composer without closing the sheet', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await openMobileSectionsSheet(user);
    const sheet = mobileSheet();
    const before = sheet.querySelectorAll('[data-composer-section]').length;

    await user.click(within(sheet).getByRole('button', { name: /إضافة قسم/ }));
    const library = mobileSheet().querySelector('[data-section-picker]') as HTMLElement;

    // Exactly one "×" on screen — the outer sheet's own close — not two.
    expect(library.getAttribute('data-close-action')).toBe('back');
    expect(within(library).queryByLabelText('إغلاق')).toBeNull();
    const back = within(library).getByLabelText('رجوع');
    expect(back.getAttribute('data-section-library-close-action')).toBe('back');
    // The outer sheet's own "×" is still "إغلاق", outside the library root.
    expect(within(sheet).getByLabelText('إغلاق')).toBeTruthy();
    expect(library.contains(within(sheet).getByLabelText('إغلاق'))).toBe(false);

    await user.click(back);

    // Same sheet, still open, composer list restored exactly as it was.
    const sameSheet = mobileSheet();
    expect(sameSheet).toBe(sheet);
    expect(sameSheet.querySelectorAll('[data-composer-section]')).toHaveLength(before);
  });

  it('the outer Sections sheet Close still closes the whole sheet (distinct from the Library Back)', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await openMobileSectionsSheet(user);
    const sheet = mobileSheet();
    await user.click(within(sheet).getByLabelText('إغلاق'));
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
  });

  it('search and category filtering work in the mobile Library, and adding a section works and returns to the composer', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await openMobileSectionsSheet(user);
    await user.click(
      within(mobileSheet()).getByRole('button', { name: /إضافة قسم/ }),
    );
    const library = mobileSheet().querySelector('[data-section-picker]') as HTMLElement;

    // Category filter.
    await user.click(within(library).getByRole('button', { name: 'العروض والتسويق' }));
    expect(library.querySelector('[data-picker-option="banner"]')).toBeNull();
    expect(library.querySelector('[data-picker-option="wholesale"]')).toBeTruthy();
    await user.click(within(library).getByRole('button', { name: 'الكل' }));

    // Search.
    const search = library.querySelector('[data-section-library-search]') as HTMLInputElement;
    await user.type(search, 'شريط ترويجي');
    const bannerCard = library.querySelector('[data-picker-option="banner"]') as HTMLButtonElement;
    expect(bannerCard).toBeTruthy();

    // Add — returns to the composer, now containing a second banner
    // instance (the default config already seeds one `banner` row, hidden,
    // per DEFAULT_PRESENTATION_CONFIG — see section-instances.test.tsx's
    // own `DEFAULT_ROW_COUNT` comment for the same fact).
    await user.click(bannerCard);
    const sheetAfter = mobileSheet();
    expect(sheetAfter.querySelector('[data-section-picker]')).toBeNull();
    expect(sheetAfter.querySelectorAll('[data-composer-section="banner"]')).toHaveLength(2);
  });

  it('Offers is LIVE and addable in the mobile Library: no gated badge, and clicking it adds an instance (CUST-H4-7)', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await openMobileSectionsSheet(user);
    await user.click(
      within(mobileSheet()).getByRole('button', { name: /إضافة قسم/ }),
    );
    const library = mobileSheet().querySelector('[data-section-picker]') as HTMLElement;
    const offers = library.querySelector('[data-picker-option="offers"]') as HTMLButtonElement;

    expect(offers).toBeTruthy();
    expect(offers.disabled).toBe(false);
    expect(within(library).queryByText('غير مفعّل')).toBeNull();
    expect(within(library).queryByText(/العروض قادمة/)).toBeNull();

    await user.click(offers);
    // The mobile Library closes after an add and the composer shows the
    // default seeded `offers` row plus the newly added instance.
    expect(mobileSheet().querySelector('[data-section-picker]')).toBeNull();
    expect(
      mobileSheet().querySelectorAll('[data-composer-section="offers"]'),
    ).toHaveLength(2);
  });

  it('an already-added singleton (categories) stays disabled with its reason in the mobile Library', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await openMobileSectionsSheet(user);
    await user.click(
      within(mobileSheet()).getByRole('button', { name: /إضافة قسم/ }),
    );
    const library = mobileSheet().querySelector('[data-section-picker]') as HTMLElement;
    const categories = library.querySelector('[data-picker-option="categories"]') as HTMLButtonElement;
    expect(categories.disabled).toBe(true);
    expect(within(categories).getByText('أُضيف بالفعل')).toBeTruthy();
  });
});
