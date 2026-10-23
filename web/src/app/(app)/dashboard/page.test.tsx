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

type Reply = () => Promise<unknown>;

function respond(cash: Reply, receivables: Reply = () => Promise.resolve({ balance: '777.00' })) {
  apiMock.mockImplementation((path?: string) => {
    if (typeof path !== 'string') return Promise.resolve({});
    if (path.startsWith('/reports/income-statement')) return Promise.resolve(income);
    if (path === '/reports/cash-position') return cash();
    if (path === '/reports/receivables-position') return receivables();
    if (path === '/invoices') return Promise.resolve({ data: [] });
    if (path === '/inventory/summary') return Promise.resolve({ total_value: '300.00' });
    return Promise.resolve({});
  });
}

const fail = (status: number) => () => Promise.reject(Object.assign(new Error(`http ${status}`), { status }));
const card = (label: string) => screen.getByText(label).closest('[class*="rounded-2xl"]') as HTMLElement;
const cashCard = () => card('cash');
const receivablesCard = () => card('receivables');

describe('Dashboard cash and receivables KPI isolation (TREASURY-T2)', () => {
  beforeEach(() => apiMock.mockReset());
  afterEach(cleanup);

  it('shows both totals, each through one request, and no longer loads the account list', async () => {
    respond(() => Promise.resolve({ balance: '2000.00' }));
    render(<DashboardPage />);

    await waitFor(() => expect(within(cashCard()).getByText(/2[.,]?0/)).toBeTruthy());
    await waitFor(() => expect(within(receivablesCard()).getByText(/777/)).toBeTruthy());
    expect(apiMock).toHaveBeenCalledWith('/reports/cash-position');
    expect(apiMock).toHaveBeenCalledWith('/reports/receivables-position');
    expect(apiMock).not.toHaveBeenCalledWith('/accounts');
    expect(within(cashCard()).queryByRole('status')).toBeNull();
    expect(within(receivablesCard()).queryByRole('status')).toBeNull();
  });

  for (const [name, reply] of [
    ['a network/server failure (500)', fail(500)],
    ['a permission denial (403)', fail(403)],
    ['a malformed response', () => Promise.resolve({ unexpected: true })],
    ['an empty response', () => Promise.resolve(null)],
  ] as const) {
    it(`cash: ${name} is isolated and explicit — the other cards still load and no zero is shown`, async () => {
      respond(reply);
      render(<DashboardPage />);

      await waitFor(() => expect(within(cashCard()).getByRole('status').textContent).toContain('kpi_unavailable'));
      await waitFor(() => expect(within(receivablesCard()).getByText(/777/)).toBeTruthy());
      expect(within(cashCard()).queryByText('0')).toBeNull();
      expect(within(cashCard()).queryByText('0.00')).toBeNull();
    });

    it(`receivables: ${name} is isolated and explicit — cash and the rest still load and no zero is shown`, async () => {
      respond(() => Promise.resolve({ balance: '2000.00' }), reply);
      render(<DashboardPage />);

      await waitFor(() => expect(within(receivablesCard()).getByRole('status').textContent).toContain('kpi_unavailable'));
      await waitFor(() => expect(within(cashCard()).getByText(/2[.,]?0/)).toBeTruthy());
      expect(within(receivablesCard()).queryByText('0')).toBeNull();
      expect(within(receivablesCard()).queryByText('0.00')).toBeNull();
    });
  }

  it('both KPIs failing leaves the rest of the dashboard (inventory, revenue) loaded', async () => {
    respond(fail(500), fail(403));
    render(<DashboardPage />);

    await waitFor(() => expect(within(cashCard()).getByRole('status')).toBeTruthy());
    await waitFor(() => expect(within(receivablesCard()).getByRole('status')).toBeTruthy());
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/inventory/summary'));
    expect(screen.getAllByRole('status')).toHaveLength(2);
  });

  it('a genuine zero is shown as zero for each KPI, distinct from unavailable', async () => {
    respond(() => Promise.resolve({ balance: '0.00' }), () => Promise.resolve({ balance: '0.00' }));
    render(<DashboardPage />);

    await waitFor(() => expect(within(cashCard()).queryByRole('status')).toBeNull());
    await waitFor(() => expect(within(cashCard()).getByText('0')).toBeTruthy());
    await waitFor(() => expect(within(receivablesCard()).queryByRole('status')).toBeNull());
    await waitFor(() => expect(within(receivablesCard()).getByText('0')).toBeTruthy());
  });

  it('a negative receivable (customer credit) keeps its sign', async () => {
    respond(() => Promise.resolve({ balance: '10.00' }), () => Promise.resolve({ balance: '-200.00' }));
    render(<DashboardPage />);

    await waitFor(() => expect(within(receivablesCard()).getByText(/-\s?200/)).toBeTruthy());
  });
});
