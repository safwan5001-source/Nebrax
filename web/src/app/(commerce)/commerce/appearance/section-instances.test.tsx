import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
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

const SAFE_ID = /^[a-zA-Z0-9_-]{1,64}$/;

function builderRoot(): HTMLElement {
  const root = document.querySelector('[data-experience-builder]');
  if (!root) throw new Error('builder root missing');
  return root as HTMLElement;
}

function composerRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[data-composer-section]'));
}

function rowIds(): string[] {
  return composerRows().map(
    (row) => row.getAttribute('data-section-id') as string,
  );
}

async function openHomepage(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'الصفحة الرئيسية' }));
}

async function addSection(
  user: ReturnType<typeof userEvent.setup>,
  type: string,
): Promise<string> {
  await user.click(screen.getByRole('button', { name: /إضافة قسم/ }));
  const picker = document.querySelector('[data-section-picker]') as HTMLElement;
  await user.click(
    picker.querySelector(`[data-picker-option="${type}"]`) as HTMLElement,
  );
  const ids = rowIds();
  return ids[ids.length - 1];
}

describe('commerce appearance — STORE-CUSTOMIZER-V2-2 section instances', () => {
  // The default homepage seeds every registered type once (id = type), with
  // only hero/categories/newArrivals/wholesale visible.
  const DEFAULT_ROW_COUNT = 10;

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    locale.current = 'ar';
    vi.restoreAllMocks();
  });

  it('picker lists every registered type with its translated name and gated badge', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await openHomepage(user);
    await user.click(screen.getByRole('button', { name: /إضافة قسم/ }));

    const picker = document.querySelector('[data-section-picker]') as HTMLElement;
    const options = Array.from(picker.querySelectorAll('[data-picker-option]'));
    expect(options.map((el) => el.getAttribute('data-picker-option'))).toEqual([
      'hero',
      'categories',
      'newArrivals',
      'wholesale',
      'banner',
      'featured',
      'offers',
      'benefits',
      'appPromo',
      'customContent',
    ]);
    expect(picker.textContent).toContain('شريط ترويجي');
    const offersOption = picker.querySelector(
      '[data-picker-option="offers"]',
    ) as HTMLElement;
    expect(offersOption.textContent).toContain('غير مفعّل');
    expect(
      (picker.querySelector('[data-picker-option="banner"]') as HTMLElement)
        .textContent,
    ).not.toContain('غير مفعّل');
    // Existing singletons are disabled; multi-instance types are not.
    expect(
      (picker.querySelector('[data-picker-option="hero"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (picker.querySelector('[data-picker-option="appPromo"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (picker.querySelector('[data-picker-option="banner"]') as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it('add creates a new instance with a safe unique id and selects it', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await openHomepage(user);

    expect(composerRows()).toHaveLength(DEFAULT_ROW_COUNT);
    const id = await addSection(user, 'banner');

    expect(composerRows()).toHaveLength(DEFAULT_ROW_COUNT + 1);
    expect(SAFE_ID.test(id)).toBe(true);
    expect(id.startsWith('section-')).toBe(true);
    // New instance is selected immediately and its settings are shown.
    expect(builderRoot().dataset.selectedSection).toBe(id);
    expect(
      document
        .querySelector('[data-selected-section-settings]')
        ?.getAttribute('data-selected-section-settings'),
    ).toBe('banner');
  });

  it('multi-instance types can be added more than once with distinct ids', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await openHomepage(user);

    const first = await addSection(user, 'offers');
    const second = await addSection(user, 'offers');

    expect(first).not.toBe(second);
    // One default instance plus the two added ones.
    expect(
      document.querySelectorAll('[data-composer-section="offers"]'),
    ).toHaveLength(3);
  });

  it('duplicate copies type/visible, creates a new id, sits next to the source and is selected', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await openHomepage(user);

    const sourceId = await addSection(user, 'benefits');
    // Hide the source first so we can prove `visible` is copied.
    const sourceRow = document.querySelector(
      `[data-section-id="${sourceId}"]`,
    ) as HTMLElement;
    await user.click(sourceRow.querySelector('input[type="checkbox"]') as HTMLElement);

    const idsBefore = rowIds();
    const sourceIndex = idsBefore.indexOf(sourceId);
    await user.click(
      sourceRow.querySelector('button[aria-label="تكرار القسم"]') as HTMLElement,
    );

    const idsAfter = rowIds();
    expect(idsAfter).toHaveLength(idsBefore.length + 1);
    const copyId = idsAfter[sourceIndex + 1];
    expect(copyId).not.toBe(sourceId);
    expect(SAFE_ID.test(copyId)).toBe(true);
    // Same type, copied visibility (both hidden), copy selected. One default
    // instance plus the source plus the copy.
    expect(
      document.querySelectorAll('[data-composer-section="benefits"]'),
    ).toHaveLength(3);
    const copyRow = document.querySelector(
      `[data-section-id="${copyId}"]`,
    ) as HTMLElement;
    expect(
      (copyRow.querySelector('input[type="checkbox"]') as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(builderRoot().dataset.selectedSection).toBe(copyId);
  });

  it('selects duplicate instances of the same type independently', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await openHomepage(user);

    const first = await addSection(user, 'customContent');
    const second = await addSection(user, 'customContent');
    expect(second).not.toBe(first);

    // Click the first instance's row: selection moves to it alone.
    const firstRow = document.querySelector(
      `[data-section-id="${first}"]`,
    ) as HTMLElement;
    await user.click(
      firstRow.querySelector('[data-section-option]') as HTMLElement,
    );
    expect(builderRoot().dataset.selectedSection).toBe(first);
    expect(
      firstRow.querySelector('[data-section-option]')?.getAttribute('aria-pressed'),
    ).toBe('true');
    const secondRow = document.querySelector(
      `[data-section-id="${second}"]`,
    ) as HTMLElement;
    expect(
      secondRow.querySelector('[data-section-option]')?.getAttribute('aria-pressed'),
    ).toBe('false');

    // The preview renders both placeholders with distinct instance ids.
    const previewed = Array.from(
      document.querySelectorAll('[data-preview-section="customContent"]'),
    );
    expect(previewed).toHaveLength(2);
    expect(
      previewed.map((el) => el.getAttribute('data-preview-section-id')),
    ).toEqual([first, second]);
  });

  it('does not offer delete for hero while hero content remains global', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await openHomepage(user);

    const heroRow = document.querySelector(
      '[data-section-id="hero"]',
    ) as HTMLElement;

    expect(
      heroRow.querySelector('button[aria-label="حذف القسم"]'),
    ).toBeNull();
    expect(
      heroRow.querySelector('input[type="checkbox"]'),
    ).toBeTruthy();
  });

  it('delete removes the instance from the list (not a hide) and moves selection to the next sibling', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await openHomepage(user);

    // Default order: hero, categories, newArrivals, wholesale (id = type).
    await user.click(screen.getByRole('button', { name: 'التصنيفات' }));
    expect(builderRoot().dataset.selectedSection).toBe('categories');

    const rowsBefore = composerRows();
    const categoriesRow = rowsBefore[1];
    await user.click(
      categoriesRow.querySelector('button[aria-label="حذف القسم"]') as HTMLElement,
    );

    // Truly removed: the row count shrinks and the id is gone entirely —
    // a hide would keep the row with visible=false.
    expect(composerRows()).toHaveLength(rowsBefore.length - 1);
    expect(document.querySelector('[data-section-id="categories"]')).toBeNull();
    expect(
      document.querySelector('[data-preview-section="categories"]'),
    ).toBeNull();
    // Deterministic fallback: next sibling.
    expect(builderRoot().dataset.selectedSection).toBe('newArrivals');
    expect(
      document
        .querySelector('[data-selected-section-settings]')
        ?.getAttribute('data-selected-section-settings'),
    ).toBe('newArrivals');
  });

  it('delete falls back to the previous sibling when the last instance is removed', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await openHomepage(user);

    // The default list ends with customContent; removing it must fall back
    // to the previous sibling (appPromo), not the next one.
    const rows = composerRows();
    const lastRow = rows[rows.length - 1];
    const lastId = lastRow.getAttribute('data-section-id') as string;
    const previousId = rows[rows.length - 2].getAttribute(
      'data-section-id',
    ) as string;
    await user.click(
      lastRow.querySelector('[data-section-option]') as HTMLElement,
    );
    expect(builderRoot().dataset.selectedSection).toBe(lastId);
    await user.click(
      lastRow.querySelector('button[aria-label="حذف القسم"]') as HTMLElement,
    );

    expect(document.querySelector(`[data-section-id="${lastId}"]`)).toBeNull();
    expect(builderRoot().dataset.selectedSection).toBe(previousId);
  });

  it('hide keeps the instance in the list and only flips visible', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await openHomepage(user);

    const before = rowIds();
    const heroRow = document.querySelector(
      '[data-section-id="hero"]',
    ) as HTMLElement;
    const toggle = heroRow.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await user.click(toggle);

    // Instance still present (not deleted), same ids, preview hero gone.
    expect(rowIds()).toEqual(before);
    expect(document.querySelector('[data-section-id="hero"]')).toBeTruthy();
    expect(document.querySelector('[data-preview-section="hero"]')).toBeNull();
  });

  it('reorder moves the instance itself and preserves every id', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await openHomepage(user);

    const bannerId = await addSection(user, 'banner');
    const idsBefore = rowIds();
    const bannerRow = document.querySelector(
      `[data-section-id="${bannerId}"]`,
    ) as HTMLElement;
    await user.click(
      bannerRow.querySelector('button[aria-label="أعلى"]') as HTMLElement,
    );

    const idsAfter = rowIds();
    expect([...idsAfter].sort()).toEqual([...idsBefore].sort());
    expect(idsAfter.indexOf(bannerId)).toBe(idsBefore.indexOf(bannerId) - 1);
    // Selection stays on the same instance after the move.
    expect(builderRoot().dataset.selectedSection).toBe(bannerId);
  });

  it('selected-section settings target the selected instance id among duplicates', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await openHomepage(user);

    const first = await addSection(user, 'featured');
    const second = await addSection(user, 'featured');
    expect(builderRoot().dataset.selectedSection).toBe(second);

    // Hide via the settings block: only the selected (second) instance flips.
    const block = document.querySelector(
      '[data-selected-section-settings]',
    ) as HTMLElement;
    await user.click(block.querySelector('input[type="checkbox"]') as HTMLElement);

    const firstRow = document.querySelector(
      `[data-section-id="${first}"]`,
    ) as HTMLElement;
    const secondRow = document.querySelector(
      `[data-section-id="${second}"]`,
    ) as HTMLElement;
    expect(
      (firstRow.querySelector('input[type="checkbox"]') as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (secondRow.querySelector('input[type="checkbox"]') as HTMLInputElement)
        .checked,
    ).toBe(false);
    // Only the still-visible instance renders in the preview.
    const previewed = document.querySelectorAll(
      '[data-preview-section="featured"]',
    );
    expect(previewed).toHaveLength(1);
    expect(previewed[0].getAttribute('data-preview-section-id')).toBe(first);
  });
});
