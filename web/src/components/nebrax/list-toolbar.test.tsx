/* @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ListToolbar } from './list-toolbar';
import type { FilterDefinition } from '@/lib/data-explorer/types';

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

function renderToolbar(overrides: Partial<React.ComponentProps<typeof ListToolbar>> = {}) {
  return render(
    <ListToolbar
      search=""
      onSearchChange={noop}
      searchPlaceholder="ابحث"
      definitions={definitions}
      filters={[]}
      onFilterChange={noop}
      onRemoveFilter={noop}
      onClearFilters={noop}
      {...overrides}
    />
  );
}

describe('ListToolbar', () => {
  it('exposes search, quick filters and advanced filtering in one bar', () => {
    renderToolbar({ onOpenAdvanced: noop });

    expect(screen.getByRole('searchbox', { name: 'بحث' })).toBeTruthy();
    expect(screen.getByLabelText('الحالة')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'فلترة متقدمة' })).toBeTruthy();
  });

  it('reports typed search text to the page', async () => {
    const onSearchChange = vi.fn();
    renderToolbar({ onSearchChange });

    await userEvent.type(screen.getByRole('searchbox', { name: 'بحث' }), 'ن');
    expect(onSearchChange).toHaveBeenCalledWith('ن');
  });

  it('renders the sort control only when the page defines one, and reports the chosen key', async () => {
    const { unmount } = renderToolbar();
    expect(screen.queryByLabelText('ترتيب الفواتير')).toBeNull();
    unmount();

    const onChange = vi.fn();
    renderToolbar({
      sort: {
        value: '-invoice_date',
        onChange,
        label: 'ترتيب الفواتير',
        options: [
          { value: '-invoice_date', label: 'الأحدث أولًا' },
          { value: 'total', label: 'الإجمالي: الأقل' },
        ],
      },
    });

    await userEvent.selectOptions(screen.getByLabelText('ترتيب الفواتير'), 'total');
    expect(onChange).toHaveBeenCalledWith('total');
  });

  it('states the result count, and the filtered-of-total count when they differ', () => {
    const { unmount } = renderToolbar({ resultCount: 12, countUnit: 'فاتورة' });
    expect(screen.getByText('12 فاتورة')).toBeTruthy();
    unmount();

    renderToolbar({ resultCount: 12, totalCount: 40 });
    expect(screen.getByText('12 من أصل 40')).toBeTruthy();
  });

  it('lets an active filter be removed individually or cleared as a whole', async () => {
    const onRemoveFilter = vi.fn();
    const onClearFilters = vi.fn();
    renderToolbar({
      filters: [{ key: 'status', operator: 'eq', value: 'draft', label: 'الحالة' }],
      onRemoveFilter,
      onClearFilters,
    });

    await userEvent.click(screen.getByRole('button', { name: 'إزالة الفلتر الحالة: draft' }));
    expect(onRemoveFilter).toHaveBeenCalledWith('status');

    await userEvent.click(screen.getByRole('button', { name: 'مسح الكل' }));
    expect(onClearFilters).toHaveBeenCalledOnce();
  });
});
