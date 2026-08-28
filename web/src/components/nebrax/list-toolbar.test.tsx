/* @vitest-environment jsdom */
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ListToolbar } from './list-toolbar';
import type { FilterDefinition } from '@/lib/data-explorer/types';
import { ARABIC_DISPLAY_LOCALE, ENGLISH_DISPLAY_LOCALE } from '@/lib/formatting';
import { TEST_LOCALES, type TestLocale, nebraxText, renderIntl } from '@/test-utils/intl';

afterEach(cleanup);

const definitions: FilterDefinition[] = [
  {
    key: 'status',
    label: 'الحالة',
    kind: 'select',
    quick: true,
    options: [
      { value: 'draft', label: 'مسودة' },
      { value: 'posted', label: 'مرحّلة' },
    ],
  },
];

const noop = () => {};

function renderToolbar(
  overrides: Partial<React.ComponentProps<typeof ListToolbar>> = {},
  locale: TestLocale = 'ar'
) {
  return renderIntl(
    <ListToolbar
      search=""
      onSearchChange={noop}
      searchPlaceholder="…"
      definitions={definitions}
      filters={[]}
      onFilterChange={noop}
      onRemoveFilter={noop}
      onClearFilters={noop}
      {...overrides}
    />,
    locale
  );
}

describe.each(TEST_LOCALES)('ListToolbar (%s)', (locale) => {
  it('labels the bar, the search box and the sort control in the active language', () => {
    renderToolbar(
      {
        sort: { value: 'a', onChange: noop, options: [{ value: 'a', label: 'A' }] },
        onOpenAdvanced: noop,
      },
      locale
    );

    expect(screen.getByRole('region', { name: nebraxText(locale, 'searchAndFilter') })).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: nebraxText(locale, 'search') })).toBeTruthy();
    expect(screen.getByLabelText(nebraxText(locale, 'sortResults'))).toBeTruthy();
  });

  it('lets the page override the accessible labels with something more specific', () => {
    renderToolbar(
      {
        searchLabel: 'Invoice search',
        sort: { value: 'a', onChange: noop, options: [{ value: 'a', label: 'A' }], label: 'Invoice sort' },
      },
      locale
    );

    expect(screen.getByRole('searchbox', { name: 'Invoice search' })).toBeTruthy();
    expect(screen.getByLabelText('Invoice sort')).toBeTruthy();
    expect(screen.queryByLabelText(nebraxText(locale, 'sortResults'))).toBeNull();
  });

  it('reports typed search text to the page', async () => {
    const onSearchChange = vi.fn();
    renderToolbar({ onSearchChange }, locale);

    await userEvent.type(screen.getByRole('searchbox', { name: nebraxText(locale, 'search') }), 'n');
    expect(onSearchChange).toHaveBeenCalledWith('n');
  });

  it('renders the sort control only when the page defines one, and reports the chosen key', async () => {
    const { unmount } = renderToolbar({}, locale);
    expect(screen.queryByLabelText(nebraxText(locale, 'sortResults'))).toBeNull();
    unmount();

    const onChange = vi.fn();
    renderToolbar(
      {
        sort: {
          value: '-invoice_date',
          onChange,
          options: [
            { value: '-invoice_date', label: 'Newest' },
            { value: 'total', label: 'Lowest total' },
          ],
        },
      },
      locale
    );

    await userEvent.selectOptions(screen.getByLabelText(nebraxText(locale, 'sortResults')), 'total');
    expect(onChange).toHaveBeenCalledWith('total');
  });

  it('lets an active filter be removed individually or cleared as a whole', async () => {
    const onRemoveFilter = vi.fn();
    const onClearFilters = vi.fn();
    renderToolbar(
      {
        filters: [{ key: 'status', operator: 'eq', value: 'draft', label: 'الحالة' }],
        onRemoveFilter,
        onClearFilters,
      },
      locale
    );

    const activeFilter = locale === 'ar' ? 'إزالة الفلتر الحالة: draft' : 'Remove filter الحالة: draft';
    const clearAll = locale === 'ar' ? 'مسح الكل' : 'Clear all';
    await userEvent.click(screen.getByRole('button', { name: activeFilter }));
    expect(onRemoveFilter).toHaveBeenCalledWith('status');

    await userEvent.click(screen.getByRole('button', { name: clearAll }));
    expect(onClearFilters).toHaveBeenCalledOnce();
  });
});

describe('ListToolbar result counter', () => {
  const counter = () => screen.getByRole('region').querySelector('[aria-live="polite"]')?.textContent ?? '';

  it('counts results in Arabic for the Arabic interface', () => {
    renderToolbar({ resultCount: 12 }, 'ar');
    expect(counter()).toBe('12 نتيجة');
  });

  it('counts results in English for the English interface', () => {
    renderToolbar({ resultCount: 12 }, 'en');
    expect(counter()).toBe('12 results');
    expect(counter()).not.toMatch(/[؀-ۿ]/);
  });

  it('pluralises a single English result', () => {
    renderToolbar({ resultCount: 1 }, 'en');
    expect(counter()).toBe('1 result');
  });

  it('states the filtered-of-total count in each language', () => {
    const { unmount } = renderToolbar({ resultCount: 12, totalCount: 40 }, 'ar');
    expect(counter()).toBe('12 من أصل 40');
    unmount();

    renderToolbar({ resultCount: 12, totalCount: 40 }, 'en');
    expect(counter()).toBe('12 of 40');
  });

  it('formats the count with the active display locale, never a pinned Arabic one', () => {
    const { unmount } = renderToolbar({ resultCount: 87654 }, 'en');
    expect(counter()).toContain((87654).toLocaleString(ENGLISH_DISPLAY_LOCALE));
    expect(counter()).not.toMatch(/[٠-٩]/);
    unmount();

    renderToolbar({ resultCount: 87654 }, 'ar');
    expect(counter()).toContain((87654).toLocaleString(ARABIC_DISPLAY_LOCALE));
    expect(counter()).not.toMatch(/[٠-٩]/);
  });

  it('keeps the counter numerals in the Mono class in both languages', () => {
    for (const locale of TEST_LOCALES) {
      const { unmount } = renderToolbar({ resultCount: 12, totalCount: 40 }, locale);
      expect(screen.getByRole('region').querySelectorAll('[aria-live="polite"] .num').length).toBe(2);
      unmount();
    }
  });
});
