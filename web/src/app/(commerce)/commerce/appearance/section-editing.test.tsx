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

function builderRoot(): HTMLElement {
  const root = document.querySelector('[data-experience-builder]');
  if (!root) throw new Error('builder root missing');
  return root as HTMLElement;
}

function selectedSettings(): HTMLElement | null {
  return document.querySelector('[data-selected-section-settings]');
}

async function openHomepage(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'الصفحة الرئيسية' }));
}

describe('commerce appearance — STORE-CUSTOMIZER-V2-2 section editing', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    locale.current = 'ar';
    vi.restoreAllMocks();
  });

  it('shows the default hero content section when nothing is selected', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await openHomepage(user);

    expect(selectedSettings()).toBeNull();
    expect(screen.getByText('محتوى البطل')).toBeTruthy();
  });

  it('shows only the selected section settings for hero, with its content fields', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await openHomepage(user);
    await user.click(
      document.querySelector('[data-section-option="hero"]') as HTMLElement,
    );

    const block = selectedSettings();
    expect(block?.getAttribute('data-selected-section-settings')).toBe('hero');
    expect(within(block as HTMLElement).getByText('عنوان البطل')).toBeTruthy();
    expect(within(block as HTMLElement).getByText('سطر داعم')).toBeTruthy();
    // The default standalone hero section is replaced while editing.
    expect(screen.queryByText('محتوى البطل')).toBeNull();
  });

  it('editing the hero headline in the selected block updates the preview', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await openHomepage(user);
    await user.click(
      document.querySelector('[data-section-option="hero"]') as HTMLElement,
    );

    const block = selectedSettings() as HTMLElement;
    const input = block.querySelector(
      'input:not([type="checkbox"])',
    ) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'عنوان جديد');

    expect(input.value).toBe('عنوان جديد');
  });

  it('shows an honest catalog-managed note for implemented non-hero sections', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await openHomepage(user);
    await user.click(screen.getByRole('button', { name: 'التصنيفات' }));

    const block = selectedSettings() as HTMLElement;
    expect(block.getAttribute('data-selected-section-settings')).toBe(
      'categories',
    );
    expect(block.textContent).toContain('يأتي من كتالوج');
    // No content fields are offered for a catalog-driven section.
    expect(within(block).queryByText('عنوان البطل')).toBeNull();
  });

  it('shows the gated note for gated sections without content fields', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await openHomepage(user);
    await user.click(
      document.querySelector('[data-section-option="offers"]') as HTMLElement,
    );

    const block = selectedSettings() as HTMLElement;
    expect(block.getAttribute('data-selected-section-settings')).toBe('offers');
    expect(block.textContent).toContain('لا يُنشر على المتجر الحي');
  });

  it('toggles visibility from the selected block and keeps preview in sync', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await openHomepage(user);
    await user.click(screen.getByRole('button', { name: 'التصنيفات' }));

    const block = selectedSettings() as HTMLElement;
    const toggle = block.querySelector(
      'input[type="checkbox"]',
    ) as HTMLElement;
    expect(toggle).toBeTruthy();
    await user.click(toggle);

    expect(
      document.querySelector('[data-preview-section="categories"]'),
    ).toBeNull();
    // Selection survives the mutation.
    expect(builderRoot().dataset.selectedSection).toBe('categories');
    expect(selectedSettings()?.getAttribute('data-selected-section-settings')).toBe(
      'categories',
    );
  });

  it('keeps reorder working while a section is selected', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await openHomepage(user);
    await user.click(screen.getByRole('button', { name: 'وصل حديثاً' }));

    const rows = document.querySelectorAll('[data-composer-section]');
    const before = Array.from(rows).map((el) =>
      el.getAttribute('data-composer-section'),
    );
    const index = before.indexOf('newArrivals');
    const upButton = rows[index].querySelector(
      'button[aria-label="أعلى"]',
    ) as HTMLElement;
    await user.click(upButton);

    const after = Array.from(
      document.querySelectorAll('[data-composer-section]'),
    ).map((el) => el.getAttribute('data-composer-section'));
    expect(after.indexOf('newArrivals')).toBe(index - 1);
    expect(builderRoot().dataset.selectedSection).toBe('newArrivals');
  });

  it('offers duplicate only for multi-instance types, never for singletons', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await openHomepage(user);
    await user.click(
      document.querySelector('[data-section-option="wholesale"]') as HTMLElement,
    );

    // Singleton rows (hero/categories/newArrivals/wholesale): no duplicate.
    for (const type of ['hero', 'categories', 'newArrivals', 'wholesale']) {
      const row = document.querySelector(
        `[data-composer-section="${type}"]`,
      ) as HTMLElement;
      expect(
        row.querySelector('button[aria-label="تكرار القسم"]'),
      ).toBeNull();
    }
    // The picker exists, but existing singletons are not offered again.
    await user.click(screen.getByRole('button', { name: /إضافة قسم/ }));
    const picker = document.querySelector('[data-section-picker]') as HTMLElement;
    expect(picker).toBeTruthy();
    for (const type of ['hero', 'categories', 'newArrivals', 'wholesale']) {
      const option = picker.querySelector(
        `[data-picker-option="${type}"]`,
      ) as HTMLButtonElement;
      expect(option.disabled).toBe(true);
    }
  });
});
