// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => ({
    select_customer: 'Select customer',
    customer_search: 'Search customers',
    no_customers: 'No customers',
    add_customer: 'Add customer',
    customer_name: 'Customer name',
    customer_phone: 'Customer phone',
    back: 'Back',
    add_and_select: 'Add and select',
  })[key] ?? key,
}));
vi.mock('@/lib/api', () => ({ api: mocks.api, ApiError: class ApiError extends Error {} }));
vi.mock('@/components/pos/pos-dialog', () => ({
  PosDialog: ({ open, title, children }: { open: boolean; title: string; children: React.ReactNode }) => open ? <section aria-label={title}>{children}</section> : null,
}));

import { CustomerPickerDialog } from './customer-picker';

describe('CustomerPickerDialog', () => {
  beforeEach(() => {
    mocks.api.mockResolvedValue({
      data: [
        { id: 'customer-1', name: 'Walk-in · Cash', type: 'customer' },
        { id: 'supplier-1', name: 'Supplier', type: 'supplier' },
      ],
    });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('يعرض العملاء المسجلين فقط ويعيد مرجع العميل المختار', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<CustomerPickerDialog open onSelect={onSelect} onClose={onClose} />);

    const customer = await screen.findByRole('button', { name: 'Walk-in · Cash' });
    expect(screen.queryByRole('button', { name: 'Supplier' })).toBeNull();

    fireEvent.click(customer);

    expect(onSelect).toHaveBeenCalledWith({ id: 'customer-1', name: 'Walk-in · Cash' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
