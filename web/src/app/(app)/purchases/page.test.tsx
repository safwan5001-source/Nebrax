// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PurchasesPage from './page';

const { api, translate } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    title: 'Purchases',
    create: 'New purchase',
    number: 'Number',
    supplier: 'Supplier',
    date: 'Date',
    total: 'Total',
    status: 'Status',
    payment_status: 'Payment',
    remaining: 'Remaining',
    view: 'Preview',
    edit: 'Edit',
    delete: 'Delete',
    posted_locked: 'Posted invoices cannot be edited or deleted.',
    empty: 'No purchases',
    load_error: 'Could not load purchase invoices.',
    delete_title: 'Delete purchase draft',
    delete_confirm: 'This permanently deletes document',
    cancel: 'Cancel',
    deleted: 'Draft deleted.',
    sort_date_desc: 'Newest first',
    sort_date_asc: 'Oldest first',
    sort_due_desc: 'Due date: furthest',
    sort_due_asc: 'Due date: nearest',
    sort_total_desc: 'Total: highest',
    sort_total_asc: 'Total: lowest',
    sort_remaining_desc: 'Remaining: highest',
    sort_remaining_asc: 'Remaining: lowest',
    search_placeholder: 'Search purchases…',
    classification: 'Classification',
  };
  const statusStrings: Record<string, string> = { draft: 'Draft', posted: 'Posted', cancelled: 'Cancelled', unpaid: 'Unpaid', partial: 'Partial', paid: 'Paid' };
  const translator = Object.assign((key: string) => strings[key] ?? key, {
    raw: () => ({}),
    rich: (key: string, values: Record<string, unknown> = {}) =>
      Object.values(values).filter((value) => typeof value !== 'function').join(' ') || (strings[key] ?? key),
  });
  const statusTranslator = Object.assign((key: string) => statusStrings[key] ?? key, { raw: () => ({}) });
  return { api: vi.fn(), translate: { purchases: translator, status: statusTranslator } };
});

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (translate as Record<string, (key: string) => string>)[namespace] ?? translate.purchases,
  useLocale: () => 'en',
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
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

const basePurchase = {
  id: 'pu1', number: 'PUR-2026-0001', partner_id: 'sup1', classification_id: null,
  purchase_date: '2026-06-01', due_date: '2026-07-01',
  total: '1150.00', remaining: '575.00', status: 'posted', payment_status: 'partial',
};
const baseSupplier = { id: 'sup1', name: 'Gulf Industrial Supplies', phone: '0501234567', vat_number: '300000000000003' };

function respondWith(purchases: unknown[], meta?: Record<string, unknown>) {
  api.mockImplementation((path: string) => {
    if (path === '/partners') return Promise.resolve({ data: [baseSupplier] });
    if (path.startsWith('/classifications')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: purchases, meta: meta ?? { current_page: 1, last_page: 1, per_page: 25, total: purchases.length } });
  });
}

function respondWithError() {
  api.mockImplementation((path: string) => {
    if (path === '/partners') return Promise.resolve({ data: [baseSupplier] });
    if (path.startsWith('/classifications')) return Promise.resolve({ data: [] });
    return Promise.reject(new Error('network down'));
  });
}

async function firstMobileRecord() {
  const list = await screen.findByRole('list');
  return within(list).getAllByRole('listitem')[0];
}

describe('PurchasesPage', () => {
  afterEach(cleanup);

  beforeEach(() => {
    api.mockReset();
  });

  it('renders the header with a primary create action', async () => {
    respondWith([basePurchase]);
    render(<PurchasesPage />);

    expect(screen.getByRole('heading', { name: 'Purchases' })).toBeTruthy();
    expect(await screen.findByRole('link', { name: /New purchase/ })).toBeTruthy();
  });

  it('shows a busy state before the data resolves', () => {
    api.mockImplementation(() => new Promise(() => {}));
    render(<PurchasesPage />);

    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
  });

  it('shows an error state on API failure, with a working retry', async () => {
    respondWithError();
    render(<PurchasesPage />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();

    respondWith([basePurchase]);
    await userEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect((await screen.findAllByText('PUR-2026-0001')).length).toBeGreaterThan(0);
  });

  it('shows the empty state when there are genuinely no purchases', async () => {
    respondWith([]);
    render(<PurchasesPage />);

    expect(await screen.findByText('No purchases')).toBeTruthy();
  });

  it('orders the mobile record: number, then supplier, then total, then status', async () => {
    respondWith([basePurchase]);
    render(<PurchasesPage />);

    const record = await firstMobileRecord();
    const text = record.textContent ?? '';
    expect(text.indexOf('PUR-2026-0001')).toBeLessThan(text.indexOf('Gulf Industrial Supplies'));
    expect(text.indexOf('Gulf Industrial Supplies')).toBeLessThan(text.indexOf('1,150.00'));
    expect(text.indexOf('1,150.00')).toBeLessThan(text.indexOf('Posted'));
  });

  it('shows both the total and the remaining balance in the mobile record', async () => {
    respondWith([basePurchase]);
    render(<PurchasesPage />);

    const record = within(await firstMobileRecord());
    expect(record.getByText('1,150.00', { exact: false })).toBeTruthy();
    expect(record.getByText('575.00', { exact: false })).toBeTruthy();
  });

  it('locks edit and delete for a posted purchase', async () => {
    respondWith([basePurchase]);
    render(<PurchasesPage />);

    await screen.findAllByText('PUR-2026-0001');
    const editButtons = screen.getAllByRole('button', { name: 'Edit' });
    for (const button of editButtons) expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('lets a draft purchase be deleted after confirmation', async () => {
    respondWith([{ ...basePurchase, status: 'draft', payment_status: 'unpaid' }]);
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/partners') return Promise.resolve({ data: [baseSupplier] });
      if (path.startsWith('/classifications')) return Promise.resolve({ data: [] });
      if (path === '/purchases/pu1' && options?.method === 'DELETE') return Promise.resolve({});
      return Promise.resolve({ data: [{ ...basePurchase, status: 'draft', payment_status: 'unpaid' }], meta: { current_page: 1, last_page: 1, per_page: 25, total: 1 } });
    });
    render(<PurchasesPage />);

    await screen.findAllByText('PUR-2026-0001');
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    await userEvent.click(deleteButtons[0]);

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(api).toHaveBeenCalledWith('/purchases/pu1', expect.objectContaining({ method: 'DELETE' }));
  });
});
