// @vitest-environment jsdom

import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdvancedFilterDialog } from './advanced-filter-dialog';
import { renderIntl } from '@/test-utils/intl';
import type { FilterDefinition } from '@/lib/data-explorer/types';

afterEach(cleanup);

const definitions: FilterDefinition[] = [
  {
    key: 'status',
    label: 'الحالة',
    kind: 'multiSelect',
    options: [
      { value: 'draft', label: 'مسودة' },
      { value: 'posted', label: 'مرحّل' },
    ],
  },
];

describe('AdvancedFilterDialog multiSelect', () => {
  it('returns selected values with the explicit in operator', async () => {
    const onApply = vi.fn();
    renderIntl(
      <AdvancedFilterDialog
        open
        onClose={vi.fn()}
        definitions={definitions}
        filters={[]}
        onApply={onApply}
      />
    );

    await userEvent.click(screen.getByRole('checkbox', { name: 'مسودة' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'مرحّل' }));
    await userEvent.click(screen.getByRole('button', { name: 'عرض النتائج' }));

    expect(onApply).toHaveBeenCalledWith([
      { key: 'status', operator: 'in', value: ['draft', 'posted'], label: 'الحالة' },
    ]);
  });
});
