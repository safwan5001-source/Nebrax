// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { summaryFixture } from '@/modules/commerce-workspace/orders/test-fixtures';
import type { ChannelSettings } from '../../channel';

const locale = vi.hoisted(() => ({ current: 'en' }));
vi.mock('next-intl', () => {
  const t = (key: string) => key;
  t.rich = (key: string) => key;
  return { useLocale: () => locale.current, useTranslations: () => t };
});
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const can = vi.hoisted(() => ({ allowed: new Set<string>() }));
vi.mock('@/lib/use-can', () => ({ useCan: () => ({ hydrated: true, can: (p: string) => can.allowed.has(p) }) }));

const channel = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../../channel-context', () => ({ useWholesaleChannel: () => channel.value }));

const ordersApi = vi.hoisted(() => ({ fetchOrders: vi.fn() }));
vi.mock('@/modules/commerce-workspace/orders/orders-api', () => ordersApi);
const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import { OverviewSection } from './overview-section';

const settings = (over: Partial<ChannelSettings> = {}): ChannelSettings => ({
  id: 'ch1',
  name: 'Wholesale',
  type: 'web',
  default_price_list: { id: 'p1', name: 'Gold', is_active: true },
  wholesale_membership_enabled: true,
  wholesale_deployment_enabled: true,
  ...over,
});

function setChannel(readiness: string, data: ChannelSettings | 'error' | 'loading' = settings()) {
  channel.value = {
    channelId: 'ch1',
    store: { id: 's1', name: 'Wholesale Store' },
    readiness,
    settings: data === 'error' ? { status: 'error', kind: 'forbidden' } : data === 'loading' ? { status: 'loading' } : { status: 'ready', data },
  };
}

const memberships = (status: string, total: number, rows: unknown[] = []) => ({ data: rows, meta: { page: 1, per_page: 5, total, last_page: 1 } });

beforeEach(() => {
  locale.current = 'en';
  can.allowed = new Set(['commerce.orders.view', 'commerce.wholesale.manage']);
  ordersApi.fetchOrders.mockReset().mockResolvedValue({ data: [summaryFixture()], meta: { current_page: 1, per_page: 5, total: 12, last_page: 3 } });
  apiMock.mockReset().mockImplementation((path: string) => {
    const status = new URL(path, 'http://x').searchParams.get('status') ?? '';
    if (status === 'pending') {
      return Promise.resolve(memberships(status, 3, [{ id: 'm1', status, applied_at: '2026-10-20T10:00:00+03:00', customer: { display_name: 'Najd Trading', email: 'b@najd.test', phone: null } }]));
    }
    return Promise.resolve(memberships(status, status === 'approved' ? 7 : 2));
  });
});
afterEach(cleanup);

const card = (label: string) => screen.getByText(label).closest('[data-testid="stat-card"]') as HTMLElement;

describe('OverviewSection', () => {
  it('shows real KPIs, latest orders and pending applications when wholesale is active', async () => {
    setChannel('active');
    render(<OverviewSection />);
    await waitFor(() => expect(within(card('Wholesale orders')).getByText('12')).toBeTruthy());
    expect(within(card('Awaiting approval')).getByText('3')).toBeTruthy();
    expect(within(card('Approved buyers')).getByText('7')).toBeTruthy();
    expect(within(card('Suspended buyers')).getByText('2')).toBeTruthy();
    const q = ordersApi.fetchOrders.mock.calls[0][0] as URLSearchParams;
    expect(q.get('sales_channel_id')).toBe('ch1');
    expect(q.get('per_page')).toBe('5');
    expect(await screen.findByText('Najd Trading')).toBeTruthy();
    expect(screen.getByText('CORD-100')).toBeTruthy();
    // pending applications raise a real alert
    expect(screen.getByText('3 membership applications are waiting for review.')).toBeTruthy();
    expect(JSON.stringify([...ordersApi.fetchOrders.mock.calls, ...apiMock.mock.calls])).not.toContain('tenant');
  });

  it.each(['deployment_off', 'channel_not_marked', 'settings_unavailable', 'no_channel', 'loading'])(
    'renders no KPI and sends no data request when readiness is %s',
    (readiness) => {
      setChannel(readiness, readiness === 'settings_unavailable' ? 'error' : settings({ wholesale_deployment_enabled: false, wholesale_membership_enabled: false }));
      render(<OverviewSection />);
      expect(screen.queryAllByTestId('stat-card')).toHaveLength(0);
      expect(ordersApi.fetchOrders).not.toHaveBeenCalled();
      expect(apiMock).not.toHaveBeenCalled();
      expect(screen.getByText('Channel readiness')).toBeTruthy();
    },
  );

  it('never shows a number for a block the viewer has no permission for, and does not request it', async () => {
    can.allowed = new Set(['commerce.orders.view']);
    setChannel('active');
    render(<OverviewSection />);
    await waitFor(() => expect(within(card('Wholesale orders')).getByText('12')).toBeTruthy());
    for (const label of ['Awaiting approval', 'Approved buyers', 'Suspended buyers']) {
      expect(within(card(label)).getByText('No permission to view')).toBeTruthy();
      expect(within(card(label)).queryByText(/^\d+$/)).toBeNull();
    }
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('shows "could not load" instead of a zero when a request fails', async () => {
    setChannel('active');
    ordersApi.fetchOrders.mockRejectedValue(Object.assign(new Error('x'), { status: 500 }));
    render(<OverviewSection />);
    await waitFor(() => expect(within(card('Wholesale orders')).getByText('Could not load')).toBeTruthy());
    expect(within(card('Wholesale orders')).queryByText('0')).toBeNull();
  });

  it('builds the checklist from real settings, with textual states and links to the right sections', () => {
    setChannel('deployment_off', settings({ wholesale_deployment_enabled: false, wholesale_membership_enabled: false, default_price_list: null }));
    render(<OverviewSection />);
    expect(screen.getAllByText('(Not done)')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Price lists' }).getAttribute('href')).toBe('/commerce/wholesale/price-lists?store=s1');
    expect(screen.getByRole('link', { name: 'Wholesale settings' }).getAttribute('href')).toBe('/commerce/wholesale/settings?store=s1');
    expect(screen.getByText('No price list is assigned to the wholesale channel.')).toBeTruthy();
  });

  it('flags unreadable settings instead of guessing the state', () => {
    setChannel('settings_unavailable', 'error');
    render(<OverviewSection />);
    expect(screen.getAllByText('(Unknown)')).toHaveLength(3);
    expect(screen.getByText(/Channel settings could not be read/)).toBeTruthy();
  });

  it('renders in Arabic', async () => {
    locale.current = 'ar';
    setChannel('active');
    render(<OverviewSection />);
    expect(await screen.findByText('جاهزية القناة')).toBeTruthy();
  });
});
