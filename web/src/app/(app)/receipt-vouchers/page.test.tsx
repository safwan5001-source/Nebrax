// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReceiptVouchersPage from './page';

const { api, translate } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    title: 'Receipt vouchers',
    subtitle: 'Collect a customer payment then post it after review.',
    create: 'Add receipt voucher',
    number: 'Voucher number',
    customer: 'Customer',
    date: 'Date',
    method: 'Collection method',
    cash: 'Cash',
    bank: 'Bank transfer',
    amount: 'Amount',
    status: 'Status',
    draft: 'Draft',
    posted: 'Posted',
    cancelled: 'Cancelled',
    post: 'Post',
    view: 'View',
    edit: 'Edit',
    duplicate: 'Duplicate',
    delete: 'Delete',
    draft_action_only: 'Available for drafts only.',
    empty: 'No receipt vouchers.',
    search: 'Search…',
    load_list_failed: 'Could not load the receipt voucher list.',
    confirm_delete: 'Delete this draft receipt voucher?',
    confirm_post: 'Post this receipt voucher?',
    filter_date_from: 'Date — from',
    filter_date_to: 'Date — to',
    filter_amount_min: 'Amount — minimum',
    filter_amount_max: 'Amount — maximum',
    sort_date_desc: 'Newest first',
    sort_date_asc: 'Oldest first',
    sort_amount_desc: 'Amount: highest',
    sort_amount_asc: 'Amount: lowest',
    actions: 'Actions',
  };
  const translator = Object.assign((key: string) => strings[key] ?? key, {
    raw: () => ({}),
    rich: (key: string, values: Record<string, unknown> = {}) =>
      Object.values(values).filter((value) => typeof value !== 'function').join(' ') || (strings[key] ?? key),
  });
  return { api: vi.fn(), translate: translator };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'en' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
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

const baseVoucher = {
  id: 'rv1', number: 'RCV-2026-0001', partner_name: 'Al Tumooh Trading Co.',
  method: 'bank', payment_date: '2026-06-10', amount: '2450.00', status: 'posted',
};

function respondWith(vouchers: unknown[]) {
  api.mockImplementation(() => Promise.resolve({ data: vouchers }));
}

function respondWithError() {
  api.mockImplementation(() => Promise.reject(new Error('network down')));
}

async function firstMobileRecord() {
  const list = await screen.findByRole('list');
  return within(list).getAllByRole('listitem')[0];
}

describe('ReceiptVouchersPage', () => {
  afterEach(cleanup);

  beforeEach(() => {
    api.mockReset();
  });

  it('renders the header with a primary create action', async () => {
    respondWith([baseVoucher]);
    render(<ReceiptVouchersPage />);

    expect(screen.getByRole('heading', { name: 'Receipt vouchers' })).toBeTruthy();
    expect(await screen.findByRole('link', { name: /Add receipt voucher/ })).toBeTruthy();
  });

  it('shows a busy state before the data resolves', () => {
    api.mockImplementation(() => new Promise(() => {}));
    render(<ReceiptVouchersPage />);

    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
  });

  it('shows an error state on API failure, with a working retry', async () => {
    respondWithError();
    render(<ReceiptVouchersPage />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();

    respondWith([baseVoucher]);
    await userEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect((await screen.findAllByText('RCV-2026-0001')).length).toBeGreaterThan(0);
  });

  it('shows the empty state when there are genuinely no vouchers', async () => {
    respondWith([]);
    render(<ReceiptVouchersPage />);

    expect(await screen.findByText('No receipt vouchers.')).toBeTruthy();
  });

  it('orders the mobile record: number, then customer, then amount, then status', async () => {
    respondWith([baseVoucher]);
    render(<ReceiptVouchersPage />);

    const record = await firstMobileRecord();
    const text = record.textContent ?? '';
    expect(text.indexOf('RCV-2026-0001')).toBeLessThan(text.indexOf('Al Tumooh Trading Co.'));
    expect(text.indexOf('Al Tumooh Trading Co.')).toBeLessThan(text.indexOf('2,450.00'));
    expect(text.indexOf('2,450.00')).toBeLessThan(text.indexOf('Posted'));
  });

  it('offers posting only for a draft voucher', async () => {
    respondWith([baseVoucher, { ...baseVoucher, id: 'rv2', number: 'RCV-2026-0002', status: 'draft' }]);
    render(<ReceiptVouchersPage />);

    await screen.findAllByText('RCV-2026-0002');
    // زرّ واحد لكل مستوى عرض (سطح المكتب + الجوال) لسجلٍّ واحدٍ مسودة.
    expect(screen.getAllByRole('button', { name: 'Post' }).length).toBe(2);
  });

  it('posts a draft voucher after confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    respondWith([{ ...baseVoucher, status: 'draft' }]);
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/payments/rv1/post' && options?.method === 'POST') return Promise.resolve({});
      return Promise.resolve({ data: [{ ...baseVoucher, status: 'draft' }] });
    });
    render(<ReceiptVouchersPage />);

    await screen.findAllByText('RCV-2026-0001');
    const postButtons = screen.getAllByRole('button', { name: 'Post' });
    await userEvent.click(postButtons[0]);

    expect(api).toHaveBeenCalledWith('/payments/rv1/post', expect.objectContaining({ method: 'POST' }));
    confirmSpy.mockRestore();
  });
});
