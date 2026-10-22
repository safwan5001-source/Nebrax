/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('next-intl', () => ({
  useLocale: () => 'ar',
  useTranslations: () => (key: string) => key,
}));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/lib/api', () => ({ api: apiMock }));
// الأقسام الثقيلة التي لا علاقة لها بمؤشّر النقد: أغلفة خفيفة تُبقي الاختبار على الصفحة وحدها.
vi.mock('@/components/dashboard/awj-global-search', () => ({ AwjGlobalSearch: () => null }));
vi.mock('@/components/reports/report-filters', () => ({
  ReportFilters: () => null,
  EMPTY_FILTERS: { from: '', to: '', branch_id: '' },
  filtersToQuery: () => '',
}));
vi.mock('@/components/dashboard/sales-chart', () => ({ SalesChart: () => null }));
vi.mock('@/components/dashboard/activity-feed', () => ({ ActivityFeed: () => null }));
vi.mock('@/components/dashboard/registers', () => ({ Registers: () => null }));
vi.mock('@/components/charts/donut', () => ({ Donut: () => null }));
vi.mock('@/components/charts/sparkline', () => ({ Sparkline: () => null }));

import DashboardPage from './page';

const income = { total_revenue: '5000.00', total_expense: '1000.00', net_income: '4000.00' };
const accounts = { data: [{ code: '1130', name: 'العملاء', balance: '777.00' }] };

function respond(cash: () => Promise<unknown>) {
  apiMock.mockImplementation((path?: string) => {
    if (typeof path !== 'string') return Promise.resolve({});
    if (path.startsWith('/reports/income-statement')) return Promise.resolve(income);
    if (path === '/accounts') return Promise.resolve(accounts);
    if (path === '/reports/cash-position') return cash();
    if (path === '/invoices') return Promise.resolve({ data: [] });
    if (path === '/inventory/summary') return Promise.resolve({ total_value: '300.00' });
    return Promise.resolve({});
  });
}

const cashCard = () => screen.getByText('cash').closest('[class*="rounded-2xl"]') as HTMLElement;
const receivablesCard = () => screen.getByText('receivables').closest('[class*="rounded-2xl"]') as HTMLElement;

describe('Dashboard cash KPI isolation (TREASURY-T2)', () => {
  beforeEach(() => apiMock.mockReset());
  afterEach(cleanup);

  it('shows the cash-position total through the same single request', async () => {
    respond(() => Promise.resolve({ balance: '2000.00' }));
    render(<DashboardPage />);

    await waitFor(() => expect(within(cashCard()).getByText(/2[.,]?0/)).toBeTruthy());
    expect(apiMock).toHaveBeenCalledWith('/reports/cash-position');
    expect(within(cashCard()).queryByRole('status')).toBeNull();
  });

  it('keeps the rest of the dashboard loading when the cash request fails, and shows an explicit unavailable state — not zero', async () => {
    respond(() => Promise.reject(Object.assign(new Error('network down'), { status: 500 })));
    render(<DashboardPage />);

    await waitFor(() => expect(within(cashCard()).getByRole('status').textContent).toContain('cash_unavailable'));
    // بقية البطاقات حُمِّلت رغم فشل النقد.
    await waitFor(() => expect(within(receivablesCard()).getByText(/777/)).toBeTruthy());
    // لا صفر مضلِّل في بطاقة النقد.
    expect(within(cashCard()).queryByText('0')).toBeNull();
    expect(within(cashCard()).queryByText('0.00')).toBeNull();
  });

  it('treats a permission denial (403) the same way: isolated and explicit', async () => {
    respond(() => Promise.reject(Object.assign(new Error('forbidden'), { status: 403 })));
    render(<DashboardPage />);

    await waitFor(() => expect(within(cashCard()).getByRole('status').textContent).toContain('cash_unavailable'));
    await waitFor(() => expect(within(receivablesCard()).getByText(/777/)).toBeTruthy());
  });

  it('a malformed response is unavailable, not a zero balance', async () => {
    respond(() => Promise.resolve({ unexpected: true }));
    render(<DashboardPage />);

    await waitFor(() => expect(within(cashCard()).getByRole('status').textContent).toContain('cash_unavailable'));
  });

  it('a genuine zero balance is shown as zero, distinct from unavailable', async () => {
    respond(() => Promise.resolve({ balance: '0.00' }));
    render(<DashboardPage />);

    await waitFor(() => expect(within(cashCard()).queryByRole('status')).toBeNull());
    await waitFor(() => expect(within(cashCard()).getByText('0')).toBeTruthy());
  });
});
