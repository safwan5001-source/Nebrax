// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isStoreAgnosticCommercePath } from '@/modules/commerce-workspace/active-store';
import CommerceOrdersPage from './page';
import CommerceOrderDetailPage from './[id]/page';

const user = vi.hoisted(() => ({ value: { role: 'owner', permissions: ['*'] } as { role: string; permissions?: string[] } | null }));
vi.mock('@/lib/auth', () => ({ currentUser: () => user.value }));
vi.mock('next-intl', () => {
  const t = (key: string) => key;
  t.rich = (key: string) => key;
  return { useLocale: () => 'ar', useTranslations: () => t };
});
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/commerce/orders',
  useSearchParams: () => new URLSearchParams(''),
  useParams: () => ({ id: '11111111-1111-4111-8111-111111111111' }),
}));
vi.mock('@/modules/commerce-workspace/store-context', () => ({ useOptionalCommerceStoreContext: () => null }));
const fetchOrdersMock = vi.hoisted(() => vi.fn());
const fetchOrderMock = vi.hoisted(() => vi.fn());
vi.mock('@/modules/commerce-workspace/orders/orders-api', () => ({
  fetchOrders: (...a: unknown[]) => fetchOrdersMock(...a),
  fetchOrder: (...a: unknown[]) => fetchOrderMock(...a),
}));

describe('commerce orders pages', () => {
  beforeEach(() => {
    fetchOrdersMock.mockReset();
    fetchOrderMock.mockReset();
    fetchOrdersMock.mockResolvedValue({ data: [], meta: { current_page: 1, per_page: 20, total: 0, last_page: 1 } });
    fetchOrderMock.mockRejectedValue({ status: 404 });
  });
  afterEach(cleanup);

  it('the orders workspace is store-agnostic so "all stores" is reachable without picking a store first', () => {
    expect(isStoreAgnosticCommercePath('/commerce/orders')).toBe(true);
    expect(isStoreAgnosticCommercePath('/commerce/orders/11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(isStoreAgnosticCommercePath('/commerce/delivery')).toBe(false);
  });

  it('the list page requests data for owners', async () => {
    render(<CommerceOrdersPage />);
    expect(await screen.findByText('لا توجد طلبات')).toBeTruthy();
    expect(fetchOrdersMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['staff without the permission', { role: 'staff', permissions: [] as string[] }],
    ['accountant with payments.manage only', { role: 'accountant', permissions: ['payments.manage', 'commerce.manage'] }],
    ['signed-out', null],
  ])('%s sees a permission state and no request is sent (list and detail)', (_name, viewer) => {
    user.value = viewer;
    const list = render(<CommerceOrdersPage />);
    expect(screen.getByText('لا تملك صلاحية عرض طلبات المتجر.')).toBeTruthy();
    list.unmount();
    render(<CommerceOrderDetailPage />);
    expect(screen.getByText('لا تملك صلاحية عرض طلبات المتجر.')).toBeTruthy();
    expect(fetchOrdersMock).not.toHaveBeenCalled();
    expect(fetchOrderMock).not.toHaveBeenCalled();
    user.value = { role: 'owner', permissions: ['*'] };
  });

  it('a custom role holding commerce.orders.view can open the list', async () => {
    user.value = { role: 'orders_clerk', permissions: ['commerce.orders.view'] };
    render(<CommerceOrdersPage />);
    expect(await screen.findByText('لا توجد طلبات')).toBeTruthy();
    user.value = { role: 'owner', permissions: ['*'] };
  });

  it('the detail page loads the order by id from the route and shows not-found for a 404', async () => {
    render(<CommerceOrderDetailPage />);
    expect(await screen.findByText('الطلب غير موجود')).toBeTruthy();
    expect(fetchOrderMock).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
  });
});
