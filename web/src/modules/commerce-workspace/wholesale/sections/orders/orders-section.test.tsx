// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detailFixture, summaryFixture } from '@/modules/commerce-workspace/orders/test-fixtures';

const locale = vi.hoisted(() => ({ current: 'en' }));
vi.mock('next-intl', () => {
  const t = (key: string) => key;
  t.rich = (key: string) => key;
  return { useLocale: () => locale.current, useTranslations: () => t };
});
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
const nav = vi.hoisted(() => ({ search: '', replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => '/commerce/wholesale/orders',
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock('../../channel-context', () => ({
  useWholesaleChannel: () => ({ channelId: 'ch-w', store: { id: 's-w', name: 'Wholesale Store' }, readiness: 'active' }),
}));
const ordersApi = vi.hoisted(() => ({ fetchOrders: vi.fn(), fetchOrder: vi.fn() }));
vi.mock('@/modules/commerce-workspace/orders/orders-api', () => ordersApi);

import { OrdersSection } from './orders-section';

const page = (rows = [summaryFixture()]) => ({ data: rows, meta: { current_page: 1, per_page: 20, total: rows.length, last_page: 1 } });
const lastQuery = () => ordersApi.fetchOrders.mock.calls.at(-1)![0] as URLSearchParams;
const lastUrl = () => new URL(String(nav.replace.mock.calls.at(-1)![0]), 'http://x');

describe('OrdersSection', () => {
  beforeEach(() => {
    locale.current = 'en';
    nav.search = '';
    nav.replace.mockReset();
    ordersApi.fetchOrders.mockReset().mockResolvedValue(page());
    ordersApi.fetchOrder.mockReset().mockResolvedValue(detailFixture());
  });
  afterEach(cleanup);

  it('loads only the wholesale channel orders (no channel/store filter exposed)', async () => {
    render(<OrdersSection />);
    await waitFor(() => expect(screen.getAllByText('CORD-100').length).toBeGreaterThan(0));
    expect(lastQuery().get('sales_channel_id')).toBe('ch-w');
    expect(lastQuery().has('storefront_id')).toBe(false);
    expect(screen.queryByLabelText('Sales channel')).toBeNull();
    expect(screen.getByText('Channel: Wholesale Store')).toBeTruthy();
  });

  it('writes filters to the URL (keeping the active store) and queries the server again', async () => {
    const { rerender } = render(<OrdersSection />);
    await screen.findAllByText('CORD-100');
    fireEvent.change(screen.getByLabelText('Payment status'), { target: { value: 'collected' } });
    expect(lastUrl().searchParams.get('payment_status')).toBe('collected');
    expect(lastUrl().searchParams.get('store')).toBe('s-w');
    expect(lastUrl().searchParams.has('channel')).toBe(false);
    nav.search = 'payment_status=collected';
    rerender(<OrdersSection />);
    await waitFor(() => expect(lastQuery().get('payment_status')).toBe('collected'));
  });

  it('shows honest empty, filtered-empty and forbidden states', async () => {
    ordersApi.fetchOrders.mockResolvedValue(page([]));
    render(<OrdersSection />);
    expect(await screen.findByText('No orders yet')).toBeTruthy();
    cleanup();
    nav.search = 'payment_status=paid';
    render(<OrdersSection />);
    expect(await screen.findByText('No matching orders')).toBeTruthy();
    cleanup();
    ordersApi.fetchOrders.mockRejectedValue(Object.assign(new Error('x'), { status: 403 }));
    render(<OrdersSection />);
    expect(await screen.findByText(/You do not have permission to view store orders/)).toBeTruthy();
  });

  it('opens a read-only detail drawer with company, VAT, CR and the server cancel verdict', async () => {
    ordersApi.fetchOrder.mockResolvedValue(
      detailFixture({
        contact: { name: 'Najd', company: 'Najd Trading', email: 'b@najd.test', phone: '0500', vat_number: '300000000000003', cr_number: '1010000000' },
        cancel_action: { available: false, blocked_reason: 'payment_collected' },
      }),
    );
    render(<OrdersSection />);
    await screen.findAllByText('CORD-100');
    fireEvent.click(screen.getAllByRole('button', { name: 'Details of order CORD-100' })[0]);
    const sheet = await screen.findByRole('dialog');
    await within(sheet).findByText('Najd Trading');
    expect(ordersApi.fetchOrder).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(within(sheet).getByText('300000000000003')).toBeTruthy();
    expect(within(sheet).getByText('1010000000')).toBeTruthy();
    expect(within(sheet).getByText(/Cancellation is not available/)).toBeTruthy();
    expect(within(sheet).getByText(/Not posted to accounting yet/)).toBeTruthy();
    const link = within(sheet).getByRole('link', { name: /Open full order page/ });
    expect(link.getAttribute('href')).toBe('/commerce/orders/11111111-1111-4111-8111-111111111111?store=s-w');
    // no write control in the drawer
    expect(within(sheet).queryByRole('button', { name: /Cancel order/i })).toBeNull();
  });

  it('says cancellation is available only when the server says so, and hides the verdict when absent', async () => {
    ordersApi.fetchOrder.mockResolvedValue(detailFixture({ cancel_action: { available: true, blocked_reason: null } }));
    render(<OrdersSection />);
    await screen.findAllByText('CORD-100');
    fireEvent.click(screen.getAllByRole('button', { name: 'Details of order CORD-100' })[0]);
    expect(await screen.findByText(/Cancelling this order is available to you/)).toBeTruthy();
    cleanup();
    ordersApi.fetchOrder.mockResolvedValue(detailFixture());
    render(<OrdersSection />);
    await screen.findAllByText('CORD-100');
    fireEvent.click(screen.getAllByRole('button', { name: 'Details of order CORD-100' })[0]);
    expect(await screen.findByText(/No authorised action is shown/)).toBeTruthy();
  });

  it('shows a retryable error when the drawer cannot load', async () => {
    ordersApi.fetchOrder.mockRejectedValue(Object.assign(new Error('x'), { status: 500 }));
    render(<OrdersSection />);
    await screen.findAllByText('CORD-100');
    fireEvent.click(screen.getAllByRole('button', { name: 'Details of order CORD-100' })[0]);
    expect(await screen.findByText('Could not load the order details.')).toBeTruthy();
  });

  it('renders Arabic labels', async () => {
    locale.current = 'ar';
    render(<OrdersSection />);
    await screen.findAllByText('CORD-100');
    expect(screen.getByText(/القناة: Wholesale Store/)).toBeTruthy();
  });
});
