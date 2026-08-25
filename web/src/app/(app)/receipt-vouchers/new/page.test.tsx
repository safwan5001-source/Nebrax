/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReceiptVoucherFormPage from './page';

const { api, push, searchParams, translate } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    new_title: 'New receipt voucher',
    edit_title: 'Edit receipt voucher',
    subtitle: 'Record a customer receipt',
    draft: 'Draft',
    back: 'Back',
    cancel: 'Cancel',
    detail_title: 'Receipt voucher details',
    number: 'Number',
    customer: 'Customer',
    choose_customer: 'Choose a customer',
    date: 'Date',
    method: 'Method',
    cash: 'Cash',
    bank: 'Bank',
    reference: 'Reference',
    reference_hint: 'Cheque or transfer number',
    invoice: 'Invoice',
    on_account: 'On account',
    remaining: 'Remaining',
    invoice_not_found: 'No open invoices for this customer',
    amount: 'Amount',
    notes: 'Notes',
    notes_placeholder: 'Internal note',
    save_draft: 'Save as draft',
    saving: 'Saving…',
    draft_saved: 'Saved',
    draft_updated: 'Updated',
    edit_draft_only: 'Only drafts can be edited.',
    load_failed: 'Could not load the voucher.',
    saveFailed: 'Could not save.',
  };
  const translator = Object.assign((key: string) => strings[key] ?? key, {
    raw: () => ({}),
    rich: (key: string) => strings[key] ?? key,
  });
  return {
    api: vi.fn(),
    push: vi.fn(),
    searchParams: new URLSearchParams(),
    translate: translator,
  };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'en' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => searchParams,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/components/ui/toast', () => {
  const fns = { success: vi.fn(), error: vi.fn() };
  return { useToast: () => fns };
});
vi.mock('@/lib/use-number-preview', () => ({
  useNumberPreview: () => ({ number: 'RV-2026-0007', loading: false }),
}));
vi.mock('lucide-react', () => {
  const iconStub = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) =>
      typeof name === 'symbol' || name === 'then' || name === '__esModule'
        ? Reflect.get(target, name)
        : iconStub,
    has: () => true,
  });
});

const customer = { id: 'pt1', name: 'Al Tumooh Trading Co.', type: 'customer' };
const invoice = {
  id: 'inv1', number: 'INV-2026-0118', remaining: '5750.00',
  payment_status: 'unpaid', status: 'posted', partner_id: 'pt1',
};

function respondWithReferenceData() {
  api.mockImplementation((path: string) => {
    if (path.startsWith('/partners')) return Promise.resolve({ data: [customer] });
    if (path.startsWith('/invoices')) return Promise.resolve({ data: [invoice] });
    return Promise.resolve({ data: {} });
  });
}

describe('ReceiptVoucherFormPage — create', () => {
  afterEach(cleanup);
  beforeEach(() => {
    api.mockReset();
    push.mockReset();
    searchParams.delete('edit');
  });

  it('renders the create heading, the draft status and the generated number', async () => {
    respondWithReferenceData();
    render(<ReceiptVoucherFormPage />);

    expect(screen.getByRole('heading', { name: 'New receipt voucher' })).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(await screen.findByDisplayValue('RV-2026-0007')).toBeTruthy();
  });

  it('offers a way back to the list from both the header and the actions', async () => {
    respondWithReferenceData();
    render(<ReceiptVoucherFormPage />);

    const links = screen.getAllByRole('link').filter((link) => link.getAttribute('href') === '/receipt-vouchers');
    expect(links.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('link', { name: 'Cancel' })).toBeTruthy();
  });

  it('keeps the primary save reachable in a bar pinned to the bottom on mobile', async () => {
    respondWithReferenceData();
    const { container } = render(<ReceiptVoucherFormPage />);

    const bar = container.querySelector('.fixed.bottom-0') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.className).toContain('pb-safe');
    expect(bar.textContent).toContain('Save as draft');
  });

  it('disables saving until a customer is chosen', async () => {
    respondWithReferenceData();
    render(<ReceiptVoucherFormPage />);

    const save = await screen.findByRole('button', { name: 'Save as draft' });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    await userEvent.selectOptions(await screen.findByLabelText('Customer'), 'pt1');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save as draft' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('posts the amount in minor units and routes to the created voucher', async () => {
    respondWithReferenceData();
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/payments' && options?.method === 'POST') {
        return Promise.resolve({ data: { id: 'rv-new' } });
      }
      if (path.startsWith('/partners')) return Promise.resolve({ data: [customer] });
      if (path.startsWith('/invoices')) return Promise.resolve({ data: [invoice] });
      return Promise.resolve({ data: {} });
    });
    render(<ReceiptVoucherFormPage />);

    await userEvent.selectOptions(await screen.findByLabelText('Customer'), 'pt1');
    await userEvent.type(screen.getByLabelText('Amount'), '100.50');
    await userEvent.click(screen.getByRole('button', { name: 'Save as draft' }));

    await waitFor(() => expect(api).toHaveBeenCalledWith('/payments', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({ partner_id: 'pt1', direction: 'received', amount: 10050 }),
    })));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/receipt-vouchers/rv-new'));
  });

  it('fills the amount from the chosen invoice remaining', async () => {
    respondWithReferenceData();
    render(<ReceiptVoucherFormPage />);

    await userEvent.selectOptions(await screen.findByLabelText('Customer'), 'pt1');
    await userEvent.selectOptions(await screen.findByLabelText('Invoice'), 'inv1');

    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('5750.00');
  });

  it('surfaces a save failure as an alert instead of failing silently', async () => {
    respondWithReferenceData();
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/payments' && options?.method === 'POST') return Promise.reject(new Error('boom'));
      if (path.startsWith('/partners')) return Promise.resolve({ data: [customer] });
      if (path.startsWith('/invoices')) return Promise.resolve({ data: [invoice] });
      return Promise.resolve({ data: {} });
    });
    render(<ReceiptVoucherFormPage />);

    await userEvent.selectOptions(await screen.findByLabelText('Customer'), 'pt1');
    await userEvent.type(screen.getByLabelText('Amount'), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Save as draft' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Could not save.');
  });
});

describe('ReceiptVoucherFormPage — edit', () => {
  afterEach(cleanup);
  beforeEach(() => {
    api.mockReset();
    push.mockReset();
    searchParams.set('edit', 'rv-1');
  });

  it('shows the edit heading and prefills the draft', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/payments/rv-1') {
        return Promise.resolve({ data: {
          status: 'draft', direction: 'received', partner_id: 'pt1', method: 'bank',
          reference: 'CHQ-9', payment_date: '2026-06-20', amount: '5750.00', notes: 'From branch',
          invoice_id: 'inv1', allocations: [],
        } });
      }
      if (path.startsWith('/partners')) return Promise.resolve({ data: [customer] });
      if (path.startsWith('/invoices')) return Promise.resolve({ data: [invoice] });
      return Promise.resolve({ data: {} });
    });
    render(<ReceiptVoucherFormPage />);

    expect(screen.getByRole('heading', { name: 'Edit receipt voucher' })).toBeTruthy();
    expect(await screen.findByDisplayValue('CHQ-9')).toBeTruthy();
    expect(screen.getByDisplayValue('From branch')).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText('Customer') as HTMLSelectElement).value).toBe('pt1'));
  });

  it('does not offer a number preview when editing an existing voucher', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/payments/rv-1') {
        return Promise.resolve({ data: {
          status: 'draft', direction: 'received', partner_id: 'pt1', method: 'cash',
          payment_date: '2026-06-20', amount: '10.00', allocations: [],
        } });
      }
      if (path.startsWith('/partners')) return Promise.resolve({ data: [customer] });
      return Promise.resolve({ data: [] });
    });
    render(<ReceiptVoucherFormPage />);

    await waitFor(() => expect(screen.queryByDisplayValue('RV-2026-0007')).toBeNull());
  });

  it('refuses a posted voucher with a visible reason rather than loading it', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/payments/rv-1') {
        return Promise.resolve({ data: {
          status: 'posted', direction: 'received', partner_id: 'pt1', method: 'cash',
          payment_date: '2026-06-20', amount: '10.00', allocations: [],
        } });
      }
      if (path.startsWith('/partners')) return Promise.resolve({ data: [customer] });
      return Promise.resolve({ data: [] });
    });
    render(<ReceiptVoucherFormPage />);

    expect((await screen.findByRole('alert')).textContent).toContain('Only drafts can be edited.');
  });

  it('updates over PUT rather than creating a second voucher', async () => {
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/payments/rv-1' && options?.method === 'PUT') {
        return Promise.resolve({ data: { id: 'rv-1' } });
      }
      if (path === '/payments/rv-1') {
        return Promise.resolve({ data: {
          status: 'draft', direction: 'received', partner_id: 'pt1', method: 'cash',
          payment_date: '2026-06-20', amount: '10.00', allocations: [],
        } });
      }
      if (path.startsWith('/partners')) return Promise.resolve({ data: [customer] });
      return Promise.resolve({ data: [] });
    });
    render(<ReceiptVoucherFormPage />);

    await waitFor(() => expect((screen.getByLabelText('Customer') as HTMLSelectElement).value).toBe('pt1'));
    await userEvent.click(screen.getByRole('button', { name: 'Save as draft' }));

    await waitFor(() => expect(api).toHaveBeenCalledWith('/payments/rv-1', expect.objectContaining({ method: 'PUT' })));
  });
});
