// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const locale = vi.hoisted(() => ({ current: 'en' }));
vi.mock('next-intl', () => {
  const t = (key: string) => key;
  return { useLocale: () => locale.current, useTranslations: () => t };
});
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const can = vi.hoisted(() => ({ allowed: new Set<string>() }));
vi.mock('@/lib/use-can', () => ({ useCan: () => ({ hydrated: true, can: (p: string) => can.allowed.has(p) }) }));

const channel = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('../../channel-context', () => ({ useWholesaleChannel: () => channel.value }));

const fetchOrdersMock = vi.hoisted(() => vi.fn());
vi.mock('@/modules/commerce-workspace/orders/orders-api', () => ({ fetchOrders: (...args: unknown[]) => fetchOrdersMock(...args) }));
const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import { PERIOD_PRESETS, membershipsPath, periodFrom } from './api';
import { ReportsSection } from './reports-section';

/** Orders endpoint stub: total by filter; the page `data` deliberately carries amounts that must never be summed. */
function stubOrders(totals: Record<string, number>, fallback = 0) {
  fetchOrdersMock.mockImplementation(async (query: URLSearchParams) => {
    const key = ['lifecycle_status', 'payment_status', 'payment_method', 'delivery_method'].map((k) => query.get(k)).find(Boolean) ?? 'all';
    const total = totals[key] ?? fallback;
    return { data: [{ id: 'o', total: { amount_minor: 99999, currency: 'SAR' } }], meta: { current_page: 1, per_page: 1, total, last_page: total } };
  });
}

const queryOf = (index: number) => fetchOrdersMock.mock.calls[index][0] as URLSearchParams;

describe('ReportsSection', () => {
  beforeEach(() => {
    locale.current = 'en';
    can.allowed = new Set(['commerce.orders.view', 'commerce.wholesale.manage']);
    channel.value = { readiness: 'active', channelId: 'c1', store: { id: 's1', name: 'S' } };
    fetchOrdersMock.mockReset();
    apiMock.mockReset();
    stubOrders({ all: 12, confirmed: 10, cancelled: 2, paid: 4, collected: 3, cod: 7, online: 4, standard: 9, pickup: 3 });
    apiMock.mockImplementation(async (path: string) => {
      const status = new URL(path, 'http://x').searchParams.get('status');
      return { data: [], meta: { total: { pending: 2, approved: 5, rejected: 1, suspended: 0 }[status as string] ?? 0 } };
    });
  });
  afterEach(cleanup);

  it('sends nothing without commerce.orders.view', () => {
    can.allowed = new Set();
    render(<ReportsSection />);
    expect(screen.getByText('You do not have access to this section')).toBeTruthy();
    expect(fetchOrdersMock).not.toHaveBeenCalled();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it.each(['deployment_off', 'channel_not_marked', 'settings_unavailable'])('shows a gate and requests nothing when readiness is %s', (readiness) => {
    channel.value = { readiness, channelId: 'c1', store: { id: 's1', name: 'S' } };
    render(<ReportsSection />);
    expect(fetchOrdersMock).not.toHaveBeenCalled();
    expect(apiMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('stat-card')).toBeNull();
  });

  it('counts every order query from meta.total of a one-row page scoped to the wholesale channel', async () => {
    render(<ReportsSection />);
    await waitFor(() => expect(screen.getByText('12')).toBeTruthy());
    expect(fetchOrdersMock.mock.calls.length).toBe(1 + 2 + 5 + 3 + 2);
    for (let i = 0; i < fetchOrdersMock.mock.calls.length; i += 1) {
      expect(queryOf(i).get('sales_channel_id')).toBe('c1');
      expect(queryOf(i).get('per_page')).toBe('1');
      expect(queryOf(i).has('tenant_id')).toBe(false);
    }
    const filters = fetchOrdersMock.mock.calls.map((_, i) => ['lifecycle_status', 'payment_status', 'payment_method', 'delivery_method'].map((k) => queryOf(i).get(k)).filter(Boolean)[0]);
    expect(filters).toEqual(expect.arrayContaining([undefined, 'confirmed', 'cancelled', 'pending', 'awaiting_collection', 'collected', 'paid', 'cod', 'pay_on_pickup', 'online', 'standard', 'pickup']));
  });

  it('shows the server counts as text next to the bars', async () => {
    render(<ReportsSection />);
    await waitFor(() => expect(screen.getByText('Cash on delivery')).toBeTruthy());
    const row = screen.getByText('Cash on delivery').closest('[data-testid="count-row"]') as HTMLElement;
    expect(within(row).getByText('7 orders')).toBeTruthy();
    expect(screen.getByText('Paid online').closest('[data-testid="count-row"]')!.textContent).toContain('4 orders');
  });

  it('never sums or displays order amounts (page rows carry 999.99 each)', async () => {
    render(<ReportsSection />);
    await waitFor(() => expect(screen.getByText('12')).toBeTruthy());
    expect(document.body.textContent).not.toMatch(/999|99,999|SAR|⃁/);
  });

  it('applies the period preset as a `from` date and re-queries; "all" sends none', async () => {
    render(<ReportsSection />);
    await waitFor(() => expect(screen.getByText('12')).toBeTruthy());
    expect(queryOf(0).get('from')).toBe(periodFrom('30'));
    fetchOrdersMock.mockClear();
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'all' } });
    await waitFor(() => expect(fetchOrdersMock).toHaveBeenCalled());
    expect(queryOf(0).has('from')).toBe(false);
    fetchOrdersMock.mockClear();
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '7' } });
    await waitFor(() => expect(fetchOrdersMock).toHaveBeenCalled());
    expect(queryOf(0).get('from')).toBe(periodFrom('7'));
  });

  it('reads buyer counts from the memberships endpoint (meta.total) and gates them by commerce.wholesale.manage', async () => {
    render(<ReportsSection />);
    await waitFor(() => expect(screen.getByText('5 buyers')).toBeTruthy());
    const paths = apiMock.mock.calls.map((call) => call[0] as string);
    expect(paths).toHaveLength(4);
    expect(paths[0].startsWith(membershipsPath('c1'))).toBe(true);
    expect(apiMock.mock.calls.every((call) => call[1] === undefined)).toBe(true);

    cleanup();
    apiMock.mockClear();
    can.allowed = new Set(['commerce.orders.view']);
    render(<ReportsSection />);
    await waitFor(() => expect(screen.getByText('You cannot view buyers')).toBeTruthy());
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('isolates a failing metric and offers retry without blanking the rest', async () => {
    fetchOrdersMock.mockImplementation(async (query: URLSearchParams) => {
      if (query.get('delivery_method')) throw Object.assign(new Error('x'), { status: 500 });
      return { data: [], meta: { current_page: 1, per_page: 1, total: 3, last_page: 3 } };
    });
    render(<ReportsSection />);
    await waitFor(() => expect(screen.getByText('Could not load the data.')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByText('Confirmed')).toBeTruthy();
  });

  it('lists revenue, top-N and posting status as deferred with their exact blockers, no controls', async () => {
    render(<ReportsSection />);
    await waitFor(() => expect(screen.getByText('12')).toBeTruthy());
    const panels = screen.getAllByTestId('deferred-capability');
    expect(panels).toHaveLength(3);
    expect(panels[0].textContent).toMatch(/no amount-aggregation endpoint scoped to a sales channel/);
    expect(panels[0].textContent).toMatch(/Summing one page of orders is not a valid total/);
    expect(panels[1].textContent).toMatch(/aggregating order lines/);
    expect(panels[2].textContent).toMatch(/neither shows nor filters by posting status/);
    for (const panel of panels) expect(panel.querySelector('input,button,select')).toBeNull();
    expect(screen.getByRole('link', { name: /Open AWJ reports/ }).getAttribute('href')).toBe('/reports');
  });

  it('renders in Arabic', async () => {
    locale.current = 'ar';
    render(<ReportsSection />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('التقارير والتحليلات');
    await waitFor(() => expect(screen.getByText('الدفع عند التسليم')).toBeTruthy());
  });
});

describe('periodFrom', () => {
  it('returns local calendar dates and null for all-time', () => {
    const now = new Date(2026, 2, 5, 10, 0, 0);
    expect(periodFrom('all', now)).toBeNull();
    expect(periodFrom('7', now)).toBe('2026-02-26');
    expect(periodFrom('30', now)).toBe('2026-02-03');
    expect(PERIOD_PRESETS).toEqual(['all', '7', '30', '90']);
  });
});
