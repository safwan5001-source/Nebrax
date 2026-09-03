/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InvoicesPage from './page';

const { api, translate } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    title: 'Sales Invoices',
    number: 'Number',
    partner: 'Customer',
    date: 'Date',
    due_date: 'Due date',
    total: 'Total',
    subtotal: 'Before tax',
    tax_amount: 'VAT',
    paid_amount: 'Paid',
    remaining: 'Remaining',
    status: 'Status',
    payment_status: 'Payment',
    search: 'Search invoices…',
    search_placeholder: 'Search invoices',
    search_shortcut: 'Press / to focus search.',
    loading_invoices: 'Loading invoices…',
    partner_search: 'Search customers',
    partner_empty: 'No customer',
    create: 'New Invoice',
    empty: 'No invoices',
    empty_hint: 'Create the first sales invoice.',
    no_results: 'No matching results',
    no_results_hint: 'Nothing matches.',
    overdue: 'Overdue',
    clear_filters: 'Clear filters',
    open_full: 'Open invoice',
    preview_title: 'Invoice preview',
    preview_close: 'Close preview',
    preview_loading: 'Loading preview…',
    preview_no_lines: 'No lines',
    preview_more_lines: 'More lines',
    sort_newest: 'Newest first',
    sort_oldest: 'Oldest first',
    sort_due_far: 'Due latest',
    sort_due_near: 'Due soonest',
    sort_total_high: 'Total high',
    sort_total_low: 'Total low',
    sort_remaining_high: 'Remaining high',
    sort_remaining_low: 'Remaining low',
    sort_number: 'Invoice number',
    load_error: 'Could not load invoices.',
    retry: 'Retry',
    view: 'View',
    more_actions: 'More',
    filters: 'Filters',
    actions: 'Actions',
    edit: 'Edit',
    delete: 'Delete',
    posted_locked: 'Posted — locked',
    delete_title: 'Delete invoice',
    delete_confirm: 'Delete invoice',
    retry_cancel: 'Cancel',
    generating_delete: 'Deleting…',
    deleted: 'Deleted',
    delete_failed: 'Delete failed',
    draft: 'Draft',
    posted: 'Posted',
    cancelled: 'Cancelled',
    unpaid: 'Unpaid',
    partial: 'Partial',
    paid: 'Paid',
    searchAndFilter: 'Search and filter',
    sortResults: 'Sort',
    exportCsv: 'Export CSV',
    advancedFilters: 'More filters',
    resultCount: 'results',
    from: 'from',
    to: 'to',
    columns: 'Columns',
    moveColumn: 'Move column',
    moveUp: 'Move up',
    moveDown: 'Move down',
    loading: 'Loading',
    noResults: 'No results',
    clearSearch: 'Clear search',
    searchWithin: 'Search within',
    noMatchingResults: 'No matching results',
    activeFilters: 'Active filters',
    removeFilter: 'Remove filter',
    clearAllFilters: 'Clear all',
    clearFilters: 'Clear filters',
    showResults: 'Show results',
    all: 'All',
    cancel: 'Cancel',
    equals: 'Equals',
    greaterThanOrEqual: 'At least',
    lessThanOrEqual: 'At most',
    resultsNavigation: 'Results',
    perPage: 'Per page',
    previousPage: 'Previous',
    nextPage: 'Next',
    pagePosition: 'Page',
    selectRow: 'Select row',
    selectAllRows: 'Select all',
    financial_summary: 'Financial summary',
    grand_total: 'Total incl. VAT',
    lines: 'Lines',
    description: 'Description',
    qty: 'Qty',
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
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/branch', () => ({
  useBranches: () => ({ branches: [], active: null, activeId: null, setActiveBranchId: vi.fn() }),
}));
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

const posted = {
  id: 'inv-1',
  number: 'INV-2026-0118',
  partner_id: 'p1',
  invoice_date: '2026-06-24',
  due_date: '2026-07-08',
  subtotal: '5000.00',
  tax_amount: '750.00',
  total: '5750.00',
  paid_amount: '0.00',
  remaining: '5750.00',
  status: 'posted',
  payment_status: 'unpaid',
  lines: [{ id: 'l1', product_name: 'Consulting', description: null, quantity: 1, line_total: '5750.00' }],
};

const draft = {
  ...posted,
  id: 'inv-draft',
  number: 'INV-2026-0115',
  status: 'draft',
  due_date: '2026-12-01',
};

function invoicePath(path: string): string {
  return path.split('?')[0];
}

function respond(invoices: Array<typeof posted | typeof draft>, detail: unknown = posted) {
  api.mockImplementation((path: string) => {
    if (path === '/partners' || path.startsWith('/partners?')) {
      return Promise.resolve({ data: [{ id: 'p1', name: 'Gulf Trading Co', phone: '0138012345', vat_number: '311111111100003' }] });
    }
    if (invoicePath(path).startsWith('/invoices/inv-')) {
      return Promise.resolve({ data: path.includes('draft') ? draft : detail });
    }
    if (invoicePath(path) === '/invoices' || path.startsWith('/invoices?')) {
      const query = new URLSearchParams(path.split('?')[1] ?? '');
      const search = (query.get('search') ?? '').trim().toLowerCase();
      const data = search
        ? invoices.filter((invoice) => invoice.number.toLowerCase().includes(search))
        : invoices;
      return Promise.resolve({
        data,
        meta: { current_page: 1, last_page: 1, per_page: 25, total: data.length },
      });
    }
    return Promise.resolve({ data: [] });
  });
}

afterEach(cleanup);

describe('Sales invoices workspace', () => {
  beforeEach(() => {
    api.mockReset();
  });

  it('uses the approved screen title and primary create action', async () => {
    respond([posted]);
    render(<InvoicesPage />);

    expect(await screen.findByRole('heading', { name: 'Sales Invoices' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'New Invoice' }).getAttribute('href')).toBe('/invoices/new');
  });

  it('keeps invoice numbers LTR and opens a lightweight preview instead of leaving the list', async () => {
    respond([posted]);
    render(<InvoicesPage />);

    const table = await screen.findByRole('table');
    const number = within(table).getByRole('button', { name: 'INV-2026-0118' });
    expect(number.getAttribute('dir')).toBe('ltr');
    await userEvent.click(number);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(table.querySelector('[data-state="active"]')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open invoice' }).getAttribute('href')).toBe('/invoices/inv-1');
    expect(screen.queryByText('Post invoice')).toBeNull();
    expect(screen.queryByText('Add payment')).toBeNull();
  });

  it('shows overdue as a visual hint on posted unpaid invoices past their due date', async () => {
    respond([posted]);
    render(<InvoicesPage />);
    expect(await screen.findAllByText('Overdue')).not.toHaveLength(0);
  });

  it('distinguishes no-results from a genuinely empty list', async () => {
    respond([]);
    render(<InvoicesPage />);
    expect(await screen.findByText('No invoices')).toBeTruthy();
    expect(screen.getByText('Create the first sales invoice.')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'New Invoice' }).length).toBeGreaterThan(0);
  });

  it('shows a filtered empty state instead of a first-invoice prompt', async () => {
    respond([posted]);
    render(<InvoicesPage />);
    await screen.findByRole('table');
    await userEvent.type(screen.getByRole('searchbox'), 'zzz-no-match');
    expect(await screen.findByText('No matching results')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy();
    expect(screen.queryByText('Create the first sales invoice.')).toBeNull();
  });

  it('keeps draft edit/delete on the list while posted invoices remain locked', async () => {
    respond([draft, posted]);
    render(<InvoicesPage />);
    const table = await screen.findByRole('table');
    const more = within(table).getAllByRole('button', { name: 'More' });

    await userEvent.click(more[0]);
    const draftMenu = await screen.findByRole('menu');
    expect(within(draftMenu).getByRole('menuitem', { name: 'Edit' }).getAttribute('href')).toContain('/invoices/inv-draft/edit');
    expect((within(draftMenu).getByRole('menuitem', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(false);

    await userEvent.keyboard('{Escape}');
    await userEvent.click(more[1]);
    const postedMenu = await screen.findByRole('menu');
    expect((within(postedMenu).getByRole('menuitem', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(postedMenu).getByRole('menuitem', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(postedMenu).getByRole('menuitem', { name: 'Edit' }).getAttribute('title')).toBe('Posted — locked');
  });

  it('opens a local filters dialog from the compact filters control', async () => {
    respond([posted]);
    render(<InvoicesPage />);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeTruthy();
    expect(within(screen.getByRole('dialog', { name: 'Filters' })).getByLabelText('Sort')).toBeTruthy();
  });

  it('surfaces a retryable load error instead of an empty list', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/partners' || path.startsWith('/partners?')) {
        return Promise.resolve({ data: [] });
      }
      if (invoicePath(path) === '/invoices' || path.startsWith('/invoices?')) {
        return Promise.reject(new Error('offline'));
      }
      return Promise.resolve({ data: [] });
    });
    render(<InvoicesPage />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Could not load invoices.')).toBeTruthy();
    expect(screen.queryByText('No invoices')).toBeNull();
  });
});
