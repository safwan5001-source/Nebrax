// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportHub } from './ImportHub';

const { api, user, translate } = vi.hoisted(() => ({
  api: vi.fn(),
  user: { current: null as { id: string; role: string; permissions?: string[] } | null },
  translate: Object.assign(
    (key: string, values: Record<string, unknown> = {}) => (Object.keys(values).length ? `${key}:${Object.values(values).join(',')}` : key),
    { raw: () => ({}), rich: (key: string) => key }
  ),
}));

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'ar' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api };
});
vi.mock('@/lib/use-can', () => ({ useCurrentUser: () => user.current }));
vi.mock('lucide-react', () => {
  const iconStub = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) => (typeof name === 'symbol' || name === 'then' || name === '__esModule' ? Reflect.get(target, name) : iconStub),
    has: () => true,
  });
});

const ALL = ['products.manage', 'company.manage', 'partners.manage', 'purchases.manage', 'expenses.manage'];
const jobRow = (patch: Record<string, unknown> = {}) => ({
  id: 'j1', domain: 'product_catalog', status: 'ready', original_filename: 'a.csv', row_count: 10, processed_rows: 0, parent_job_id: null, error_message: null,
  created_at: '2026-03-10T10:00:00Z', target_id: null, ...patch,
});
const jobsPage = (data: unknown[], meta = { current_page: 1, last_page: 1, per_page: 10, total: data.length }) => ({ data, meta });

function setApi(jobs: unknown = jobsPage([]), navState: Record<string, boolean> = {}) {
  api.mockImplementation((path: string) => {
    if (path === '/applications/nav-state') return Promise.resolve({ data: navState });
    if (path.startsWith('/import-jobs')) return typeof jobs === 'function' ? (jobs as (p: string) => unknown)(path) : Promise.resolve(jobs);
    return Promise.resolve({ data: {} });
  });
}
const hrefOf = (name: string) => (screen.getByRole('link', { name }) as HTMLAnchorElement).getAttribute('href');

beforeEach(() => {
  api.mockReset();
  user.current = { id: 'u1', role: 'accountant', permissions: ALL };
  setApi();
});
afterEach(cleanup);

describe('ImportHub (IMP-H8-S1)', () => {
  it('offers the standard path for every entity and the assistant path only where one exists', async () => {
    render(<ImportHub />);
    await waitFor(() => expect(api).toHaveBeenCalledWith('/applications/nav-state'));

    expect(hrefOf('standard: entity_products')).toBe('/products/import');
    expect(hrefOf('secondary_workbook: entity_products')).toBe('/products/workbook-import');
    expect(hrefOf('assistant: entity_products')).toBe('/products/ai-import');
    expect(hrefOf('standard: entity_customers')).toBe('/partners/import');
    expect(hrefOf('standard: entity_suppliers')).toBe('/suppliers/import');
    expect(hrefOf('standard: entity_stocktake_counts')).toBe('/stocktaking');
    // لا رابط مساعد وهمي لغير المنتجات
    expect(screen.queryByRole('link', { name: 'assistant: entity_customers' })).toBeNull();
    expect(screen.getAllByText('assistant_unavailable').length).toBe(11);
  });

  it('hides an entity the user cannot manage, and one whose application is off', async () => {
    user.current = { id: 'u1', role: 'staff', permissions: ['partners.manage', 'products.manage'] };
    setApi(jobsPage([]), { 'inventory.core': false });
    render(<ImportHub />);
    await waitFor(() => expect(screen.queryByRole('link', { name: 'standard: entity_stock_permits' })).toBeNull());

    expect(screen.getByRole('link', { name: 'standard: entity_customers' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'standard: entity_products' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'standard: entity_purchases' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'standard: entity_expenses' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'standard: entity_price_list_items' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'standard: entity_inventory_openings' })).toBeNull();
  });

  it('shows an empty state when the user can import nothing, and stays usable if capability state fails', async () => {
    user.current = { id: 'u1', role: 'staff', permissions: ['products.view'] };
    render(<ImportHub />);
    await waitFor(() => expect(screen.getByText('entities_empty')).toBeTruthy());

    cleanup();
    user.current = { id: 'u1', role: 'accountant', permissions: ALL };
    api.mockImplementation((path: string) => (path === '/applications/nav-state' ? Promise.reject(new Error('net')) : Promise.resolve(jobsPage([]))));
    render(<ImportHub />);
    await waitFor(() => expect(screen.getByRole('link', { name: 'standard: entity_stock_permits' })).toBeTruthy());
  });

  it('lists runs and offers resume only for unfinished runs of a known wizard', async () => {
    setApi(jobsPage([
      jobRow({ id: 'r1', status: 'ready', original_filename: 'ready.csv' }),
      jobRow({ id: 'r2', status: 'completed', original_filename: 'done.csv', processed_rows: 10 }),
      jobRow({ id: 'r3', status: 'processing', domain: 'stocktake_count', target_id: 'st-7', original_filename: 'count.csv' }),
      jobRow({ id: 'r4', status: 'ready', domain: 'partner_master', original_filename: 'partners.csv' }),
      jobRow({ id: 'r5', status: 'failed', original_filename: 'bad.csv', error_message: 'boom' }),
    ]));
    render(<ImportHub />);
    await waitFor(() => expect(screen.getByText('ready.csv')).toBeTruthy());

    const row = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;
    expect((within(row('ready.csv')).getByRole('link', { name: 'resume' }) as HTMLAnchorElement).getAttribute('href')).toBe('/products/import?job=r1');
    expect((within(row('count.csv')).getByRole('link', { name: 'resume' }) as HTMLAnchorElement).getAttribute('href')).toBe('/stocktaking/st-7/import?job=r3');
    expect(within(row('done.csv')).queryByRole('link', { name: 'resume' })).toBeNull();
    expect(within(row('partners.csv')).queryByRole('link', { name: 'resume' })).toBeNull();
    expect(within(row('partners.csv')).getByText('resume_from_page')).toBeTruthy();
    expect(within(row('bad.csv')).getByText('boom')).toBeTruthy();
    expect(within(row('done.csv')).getByText('10 / 10')).toBeTruthy();
  });

  it('sends the filters and page to the server, and returns to the first page when a filter changes', async () => {
    setApi(jobsPage([jobRow()], { current_page: 1, last_page: 3, per_page: 10, total: 25 }));
    const user$ = userEvent.setup();
    render(<ImportHub />);
    await waitFor(() => expect(screen.getByText('a.csv')).toBeTruthy());
    const last = () => String(api.mock.calls.filter((call) => String(call[0]).startsWith('/import-jobs')).at(-1)?.[0]);
    expect(last()).toBe('/import-jobs?page=1&per_page=10');

    await user$.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(last()).toContain('page=2'));
    await user$.selectOptions(screen.getByLabelText('filter_status'), 'failed');
    await waitFor(() => expect(last()).toBe('/import-jobs?page=1&per_page=10&status=failed'));
    await user$.selectOptions(screen.getByLabelText('filter_domain'), 'expense_import');
    await waitFor(() => expect(last()).toBe('/import-jobs?page=1&per_page=10&status=failed&domain=expense_import'));
  });

  it('shows the empty states and a retryable error for the history', async () => {
    setApi(jobsPage([]));
    const user$ = userEvent.setup();
    render(<ImportHub />);
    await waitFor(() => expect(screen.getByText('history_empty')).toBeTruthy());
    expect(screen.getByText('history_empty_hint')).toBeTruthy();
    await user$.selectOptions(screen.getByLabelText('filter_status'), 'failed');
    await waitFor(() => expect(screen.getByText('history_empty_filtered')).toBeTruthy());

    cleanup();
    const { ApiError } = await import('@/lib/api');
    let fail = true;
    api.mockImplementation((path: string) => {
      if (path === '/applications/nav-state') return Promise.resolve({ data: {} });
      if (fail) return Promise.reject(new ApiError(500, 'تعذّر', null));
      return Promise.resolve(jobsPage([jobRow()]));
    });
    render(<ImportHub />);
    await waitFor(() => expect(screen.getByText('تعذّر')).toBeTruthy());
    fail = false;
    await user$.click(screen.getByRole('button', { name: /retry|nebrax|try/i }));
    await waitFor(() => expect(screen.getByText('a.csv')).toBeTruthy());
  });
});
