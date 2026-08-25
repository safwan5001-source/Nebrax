// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExpensesPage from './page';

const { api, translate } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    title: 'Expenses',
    create: 'New expense',
    manage_categories: 'Manage categories',
    number: 'Number',
    account: 'Expense account',
    category: 'Category',
    vendor_name: 'Vendor',
    date: 'Date',
    payment_method: 'Payment method',
    total: 'Total',
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
    empty: 'No expenses yet',
    search: 'Search…',
    load_error: 'Could not load expenses.',
    filter_date_from: 'Date — from',
    filter_date_to: 'Date — to',
    filter_amount_min: 'Total — minimum',
    filter_amount_max: 'Total — maximum',
    sort_date_desc: 'Newest first',
    sort_date_asc: 'Oldest first',
    sort_total_desc: 'Amount: highest',
    sort_total_asc: 'Amount: lowest',
    actions: 'Actions',
    'method.cash': 'Cash',
    'method.bank': 'Bank transfer',
    'method.credit': 'Credit',
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

const baseExpense = {
  id: 'ex1', number: 'EXP-2026-0001', account_name: 'Utilities', category_name: 'Rent & utilities',
  vendor_name: 'Saudi Electricity Co.', expense_date: '2026-06-15', payment_method: 'bank',
  total: '820.00', status: 'draft',
};

function respondWith(expenses: unknown[]) {
  api.mockImplementation(() => Promise.resolve({ data: expenses }));
}

function respondWithError() {
  api.mockImplementation(() => Promise.reject(new Error('network down')));
}

async function firstMobileRecord() {
  const list = await screen.findByRole('list');
  return within(list).getAllByRole('listitem')[0];
}

describe('ExpensesPage', () => {
  afterEach(cleanup);

  beforeEach(() => {
    api.mockReset();
  });

  it('renders the header with category management and a primary create action', async () => {
    respondWith([baseExpense]);
    render(<ExpensesPage />);

    expect(screen.getByRole('heading', { name: 'Expenses' })).toBeTruthy();
    expect(await screen.findByRole('link', { name: /New expense/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Manage categories/ })).toBeTruthy();
  });

  it('shows a busy state before the data resolves', () => {
    api.mockImplementation(() => new Promise(() => {}));
    render(<ExpensesPage />);

    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
  });

  it('shows an error state on API failure, with a working retry', async () => {
    respondWithError();
    render(<ExpensesPage />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();

    respondWith([baseExpense]);
    await userEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect((await screen.findAllByText('EXP-2026-0001')).length).toBeGreaterThan(0);
  });

  it('shows the empty state when there are genuinely no expenses', async () => {
    respondWith([]);
    render(<ExpensesPage />);

    expect(await screen.findByText('No expenses yet')).toBeTruthy();
  });

  it('orders the mobile record: number, then category, then amount, then status', async () => {
    respondWith([baseExpense]);
    render(<ExpensesPage />);

    const record = await firstMobileRecord();
    const text = record.textContent ?? '';
    expect(text.indexOf('EXP-2026-0001')).toBeLessThan(text.indexOf('Rent & utilities'));
    expect(text.indexOf('Rent & utilities')).toBeLessThan(text.indexOf('820.00'));
    expect(text.indexOf('820.00')).toBeLessThan(text.indexOf('Draft'));
  });

  it('falls back to the expense account as the subtitle when no category or vendor is set', async () => {
    respondWith([{ ...baseExpense, category_name: null, vendor_name: null }]);
    render(<ExpensesPage />);

    const record = await firstMobileRecord();
    expect(within(record).getByText('Utilities')).toBeTruthy();
  });

  it('offers posting only for a draft expense', async () => {
    respondWith([baseExpense, { ...baseExpense, id: 'ex2', number: 'EXP-2026-0002', status: 'posted' }]);
    render(<ExpensesPage />);

    await screen.findAllByText('EXP-2026-0001');
    // زرّ واحد لكل مستوى عرض (سطح المكتب + الجوال) لسجلٍّ واحدٍ مسودة، ولا شيء لغيره.
    expect(screen.getAllByRole('button', { name: 'Post' }).length).toBe(2);
  });

  it('posts a draft expense', async () => {
    respondWith([baseExpense]);
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/expenses/ex1/post' && options?.method === 'POST') return Promise.resolve({});
      return Promise.resolve({ data: [baseExpense] });
    });
    render(<ExpensesPage />);

    await screen.findAllByText('EXP-2026-0001');
    const postButtons = screen.getAllByRole('button', { name: 'Post' });
    await userEvent.click(postButtons[0]);

    expect(api).toHaveBeenCalledWith('/expenses/ex1/post', expect.objectContaining({ method: 'POST' }));
  });
});
