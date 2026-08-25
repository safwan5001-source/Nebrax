// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SupplierPaymentsPage from './page';

const { api, translate } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    number: 'Number',
    partner: 'Partner',
    method: 'Method',
    cash: 'Cash',
    bank: 'Bank',
    date: 'Date',
    amount: 'Amount',
    status: 'Status',
  };
  const supplierStrings: Record<string, string> = {
    title: 'Supplier payments',
    create: 'New payment voucher',
    search: 'Search vouchers…',
    empty: 'No supplier payments',
    supplier: 'Supplier',
    load_error: 'Could not load supplier payments.',
    filter_date_from: 'Date — from',
    filter_date_to: 'Date — to',
    filter_amount_min: 'Amount — minimum',
    filter_amount_max: 'Amount — maximum',
    sort_date_desc: 'Newest first',
    sort_date_asc: 'Oldest first',
    sort_amount_desc: 'Amount: highest',
    sort_amount_asc: 'Amount: lowest',
  };
  const statusStrings: Record<string, string> = { draft: 'Draft', posted: 'Posted', cancelled: 'Cancelled' };
  const mk = (dict: Record<string, string>) => Object.assign((key: string) => dict[key] ?? key, {
    raw: () => ({}),
    rich: (key: string, values: Record<string, unknown> = {}) =>
      Object.values(values).filter((value) => typeof value !== 'function').join(' ') || (dict[key] ?? key),
  });
  return {
    api: vi.fn(),
    translate: { payments: mk(strings), supplierPayments: mk(supplierStrings), status: mk(statusStrings) },
  };
});

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (translate as Record<string, (key: string) => string>)[namespace] ?? translate.payments,
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
vi.mock('@/components/payments/payment-dialog', () => ({ PaymentDialog: () => null }));
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

const basePayment = {
  id: 'pm1', number: 'PMT-2026-0001', partner_id: 'sup1', method: 'bank',
  status: 'posted', payment_date: '2026-06-05', amount: '3100.00',
};
const baseSupplier = { id: 'sup1', name: 'Riyadh Steel Works' };

function respondWith(payments: unknown[]) {
  api.mockImplementation((path: string) => {
    if (path === '/partners?type=supplier') return Promise.resolve({ data: [baseSupplier] });
    return Promise.resolve({ data: payments });
  });
}

function respondWithError() {
  api.mockImplementation((path: string) => {
    if (path === '/partners?type=supplier') return Promise.resolve({ data: [baseSupplier] });
    return Promise.reject(new Error('network down'));
  });
}

async function firstMobileRecord() {
  const list = await screen.findByRole('list');
  return within(list).getAllByRole('listitem')[0];
}

describe('SupplierPaymentsPage', () => {
  afterEach(cleanup);

  beforeEach(() => {
    api.mockReset();
  });

  it('renders the header with a primary create action', async () => {
    respondWith([basePayment]);
    render(<SupplierPaymentsPage />);

    expect(screen.getByRole('heading', { name: 'Supplier payments' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'New payment voucher' })).toBeTruthy();
  });

  it('shows a busy state before the data resolves', () => {
    api.mockImplementation(() => new Promise(() => {}));
    render(<SupplierPaymentsPage />);

    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
  });

  it('shows an error state on API failure, with a working retry', async () => {
    respondWithError();
    render(<SupplierPaymentsPage />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();

    respondWith([basePayment]);
    await userEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect((await screen.findAllByText('PMT-2026-0001')).length).toBeGreaterThan(0);
  });

  it('shows the empty state when there are genuinely no supplier payments', async () => {
    respondWith([]);
    render(<SupplierPaymentsPage />);

    expect(await screen.findByText('No supplier payments')).toBeTruthy();
  });

  it('orders the mobile record: number, then supplier, then amount, then status', async () => {
    respondWith([basePayment]);
    render(<SupplierPaymentsPage />);

    const record = await firstMobileRecord();
    const text = record.textContent ?? '';
    expect(text.indexOf('PMT-2026-0001')).toBeLessThan(text.indexOf('Riyadh Steel Works'));
    expect(text.indexOf('Riyadh Steel Works')).toBeLessThan(text.indexOf('3,100.00'));
    expect(text.indexOf('3,100.00')).toBeLessThan(text.indexOf('Posted'));
  });

  it('shows the collection method as secondary detail in the mobile record', async () => {
    respondWith([basePayment]);
    render(<SupplierPaymentsPage />);

    const record = within(await firstMobileRecord());
    expect(record.getByText('Method')).toBeTruthy();
    expect(record.getByText('Bank')).toBeTruthy();
  });

  it('opens the new payment voucher dialog', async () => {
    respondWith([basePayment]);
    render(<SupplierPaymentsPage />);

    await screen.findAllByText('PMT-2026-0001');
    // لا شيء يُلقي خطأً عند فتح الحوار — التحقق الفعلي من محتواه في اختبارات `PaymentDialog` نفسه.
    await userEvent.click(screen.getByRole('button', { name: 'New payment voucher' }));
  });
});
