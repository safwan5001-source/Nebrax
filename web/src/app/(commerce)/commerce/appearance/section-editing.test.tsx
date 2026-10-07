import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const locale = { current: 'ar' };
// يُبنى الاستدعاء الافتراضي هنا حتى `vi.fn(impl)` نفسه — `vi.restoreAllMocks()`
// في `afterEach` أدناه يعيد أي `vi.fn()` عاري الإنشاء إلى دالة فارغة، لكنه
// يستعيد التطبيق الأصلي الممرَّر وقت الإنشاء، فلا حاجة لإعادة ضبطه في كل اختبار.
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

// CUST-H1-2 — الآن تُحمَّل الواجهة عبر نسخة تصميم واحدة (list → show)؛ نسخة
// مسودة واحدة فقط فيُختار تلقائياً بلا غموض (`applyVersionSelection`).
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

import { DEFAULT_PRESENTATION_CONFIG } from '@/modules/store-experience-builder/presentation';
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

  it('offers no global hero fields while nothing is selected — a hero edits its own content (V6a)', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());
    await openHomepage(user);

    expect(selectedSettings()).toBeNull();
    expect(screen.queryByText('محتوى البطل')).toBeNull();
    expect(document.querySelector('[data-hero-fields]')).toBeNull();
  });

  it('shows only the selected section settings for hero, with its content fields', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());
    await openHomepage(user);
    await user.click(
      document.querySelector('[data-section-option="hero"]') as HTMLElement,
    );

    const block = selectedSettings();
    expect(block?.getAttribute('data-selected-section-settings')).toBe('hero');
    expect(within(block as HTMLElement).getByText('عنوان البطل')).toBeTruthy();
    expect(within(block as HTMLElement).getByText('سطر داعم')).toBeTruthy();
    // two buttons, each with its own text and link
    expect(block?.querySelectorAll('[data-hero-cta-slot]')).toHaveLength(2);
    expect(screen.queryByText('محتوى البطل')).toBeNull();
  });

  it('editing the hero headline in the selected block updates the preview', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());
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
    await waitFor(() => expect(showMock).toHaveBeenCalled());
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

  it('shows the real Offers picker (not a gated note) for an offers section', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());
    await openHomepage(user);
    await user.click(
      document.querySelector('[data-section-option="offers"]') as HTMLElement,
    );

    const block = selectedSettings() as HTMLElement;
    expect(block.getAttribute('data-selected-section-settings')).toBe('offers');
    // CUST-H4-7 — Offers is LIVE: the Content tab hosts the real picker, with
    // its selected-count header, never the old "no offers engine" note.
    expect(block.textContent).toContain('العروض المختارة');
    expect(block.textContent).toContain('0/8');
    expect(block.textContent).not.toContain('محرك العروض');
    expect(block.textContent).not.toContain('غير مفعّل');
  });

  it('toggles visibility from the selected block and keeps preview in sync', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());
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
    await waitFor(() => expect(showMock).toHaveBeenCalled());
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

  it('offers duplicate for multi-instance types and the bounded hero, never for singletons', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());
    await openHomepage(user);
    await user.click(
      document.querySelector('[data-section-option="wholesale"]') as HTMLElement,
    );

    // Singleton rows (categories/newArrivals/wholesale): no duplicate. A hero is a bounded
    // per-instance section (V6a) and does offer one.
    for (const type of ['categories', 'newArrivals', 'wholesale']) {
      const row = document.querySelector(
        `[data-composer-section="${type}"]`,
      ) as HTMLElement;
      expect(
        row.querySelector('button[aria-label="تكرار القسم"]'),
      ).toBeNull();
    }
    const heroRow = document.querySelector(
      '[data-composer-section="hero"]',
    ) as HTMLElement;
    expect(heroRow.querySelector('button[aria-label="تكرار القسم"]')).toBeTruthy();
    // The picker exists; existing singletons are not offered again, a hero still is (1 of 3).
    await user.click(screen.getByRole('button', { name: /إضافة قسم/ }));
    const picker = document.querySelector('[data-section-picker]') as HTMLElement;
    expect(picker).toBeTruthy();
    for (const type of ['categories', 'newArrivals', 'wholesale']) {
      const option = picker.querySelector(
        `[data-picker-option="${type}"]`,
      ) as HTMLButtonElement;
      expect(option.disabled).toBe(true);
    }
    expect(
      (picker.querySelector('[data-picker-option="hero"]') as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
