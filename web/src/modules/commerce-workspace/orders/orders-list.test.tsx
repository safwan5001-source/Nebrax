// @vitest-environment jsdom
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { summaryFixture } from './test-fixtures';
import { OrdersList } from './orders-list';

const locale = vi.hoisted(() => ({ current: 'ar' }));
vi.mock('next-intl', () => {
  const t = (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key);
  t.rich = (key: string) => key;
  return { useLocale: () => locale.current, useTranslations: () => t };
});
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const nav = vi.hoisted(() => ({ search: '', replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => '/commerce/orders',
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const fetchOrdersMock = vi.hoisted(() => vi.fn());
vi.mock('./orders-api', () => ({ fetchOrders: (...a: unknown[]) => fetchOrdersMock(...a) }));

const store = vi.hoisted(() => ({
  value: null as null | Record<string, unknown>,
  select: vi.fn(),
}));
vi.mock('@/modules/commerce-workspace/store-context', () => ({
  useOptionalCommerceStoreContext: () => store.value,
}));

const stores = [
  { id: 's1', name: 'زهور طيبة', salesChannelId: 'c1', isActive: true },
  { id: 's2', name: 'زهور الرشد', salesChannelId: 'c2', isActive: true },
];

function setStore(selected: string | null) {
  store.value = { catalog: { status: 'ready', stores }, selectedStoreId: selected, setSelectedStoreId: store.select };
}
const lastQuery = () => (fetchOrdersMock.mock.calls.at(-1)![0] as URLSearchParams);
const page = (rows = [summaryFixture()], meta = { current_page: 1, per_page: 20, total: rows.length, last_page: 1 }) => ({ data: rows, meta });

describe('OrdersList', () => {
  beforeEach(() => {
    locale.current = 'ar';
    nav.search = '';
    nav.replace.mockReset();
    store.select.mockReset();
    fetchOrdersMock.mockReset();
    fetchOrdersMock.mockResolvedValue(page());
    setStore('s1');
    window.sessionStorage.clear();
  });
  afterEach(cleanup);

  it('loads the list for the active store and renders the order columns', async () => {
    render(<OrdersList />);
    await waitFor(() => expect(screen.getAllByText('CORD-100').length).toBeGreaterThan(0));
    expect(lastQuery().get('storefront_id')).toBe('s1');
    expect(lastQuery().get('sort')).toBe('created_at');
    expect(lastQuery().get('direction')).toBe('desc');
    expect(lastQuery().get('per_page')).toBe('20');
    expect(screen.getAllByText('زهور طيبة').length).toBeGreaterThan(0);
    expect(screen.getAllByText('بانتظار التحصيل').length).toBeGreaterThan(0);
    expect(screen.getAllByText('مؤكَّد').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/115/).length).toBeGreaterThan(0);
  });

  it('links each order to its detail page carrying the active store', async () => {
    render(<OrdersList />);
    await waitFor(() => screen.getAllByText('CORD-100'));
    const link = screen.getAllByText('CORD-100')[0].closest('a')!;
    expect(link.getAttribute('href')).toBe('/commerce/orders/11111111-1111-4111-8111-111111111111?store=s1');
  });

  it('shows all stores when the scope is all, without a storefront_id', async () => {
    nav.search = 'scope=all';
    render(<OrdersList />);
    await waitFor(() => expect(fetchOrdersMock).toHaveBeenCalled());
    expect(lastQuery().has('storefront_id')).toBe(false);
  });

  it('treats an unresolved store (selection required) as all stores', async () => {
    setStore(null);
    render(<OrdersList />);
    await waitFor(() => expect(fetchOrdersMock).toHaveBeenCalled());
    expect(lastQuery().has('storefront_id')).toBe(false);
  });

  it('choosing a specific store updates the workspace store; choosing all stores keeps it and sets scope=all', async () => {
    render(<OrdersList />);
    await waitFor(() => expect(fetchOrdersMock).toHaveBeenCalled());
    const select = screen.getByLabelText('المتجر');
    fireEvent.change(select, { target: { value: 's2' } });
    expect(store.select).toHaveBeenCalledWith('s2');
    fireEvent.change(select, { target: { value: '' } });
    expect(String(nav.replace.mock.calls.at(-1)![0])).toContain('scope=all');
    expect(store.select).toHaveBeenCalledTimes(1);
  });

  it('keeps the store param in the URL when filters change and resets the page', async () => {
    nav.search = 'store=s1&page=3';
    render(<OrdersList />);
    await waitFor(() => expect(fetchOrdersMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('حالة الدفع'), { target: { value: 'paid' } });
    const url = String(nav.replace.mock.calls.at(-1)![0]);
    expect(url).toContain('payment_status=paid');
    expect(url).toContain('store=s1');
    expect(url).not.toContain('page=');
  });

  it('sends payment, method, delivery, channel and date filters from the URL as separate server params', async () => {
    nav.search = 'channel=22222222-2222-4222-8222-222222222222&payment_status=paid&payment_method=online&delivery_method=pickup&from=2026-10-01&to=2026-10-31&sort=-total&page=2&per_page=50';
    fetchOrdersMock.mockResolvedValue(page([summaryFixture()], { current_page: 2, per_page: 50, total: 120, last_page: 3 }));
    render(<OrdersList />);
    await waitFor(() => expect(fetchOrdersMock).toHaveBeenCalled());
    const q = lastQuery();
    expect(Object.fromEntries(q.entries())).toMatchObject({
      sales_channel_id: '22222222-2222-4222-8222-222222222222', payment_status: 'paid', payment_method: 'online', delivery_method: 'pickup',
      from: '2026-10-01', to: '2026-10-31', sort: 'total', direction: 'desc', page: '2', per_page: '50', storefront_id: 's1',
    });
  });

  it('debounces the search and never sends fewer than 2 characters', async () => {
    vi.useFakeTimers();
    try {
      render(<OrdersList />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      const input = screen.getByLabelText('بحث');
      fireEvent.change(input, { target: { value: 'س' } });
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      expect(lastQuery().has('q')).toBe(false);
      expect(screen.getByText('اكتب حرفين على الأقل للبحث.')).toBeTruthy();

      const callsBefore = fetchOrdersMock.mock.calls.length;
      fireEvent.change(input, { target: { value: 'سارة' } });
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      expect(String(nav.replace.mock.calls.at(-1)?.[0] ?? '')).not.toContain('q=%D8%B3%D8%A7%D8%B1%D8%A9');
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      expect(String(nav.replace.mock.calls.at(-1)![0])).toContain('q=%D8%B3%D8%A7%D8%B1%D8%A9');
      expect(fetchOrdersMock.mock.calls.length).toBe(callsBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it('paginates on the server and changes page size', async () => {
    fetchOrdersMock.mockResolvedValue(page([summaryFixture()], { current_page: 1, per_page: 20, total: 45, last_page: 3 }));
    render(<OrdersList />);
    await waitFor(() => screen.getAllByText('CORD-100'));
    const next = screen.getAllByRole('button').find((b) => /next/i.test(b.getAttribute('aria-label') ?? ''));
    expect(next).toBeTruthy();
    fireEvent.click(next!);
    expect(String(nav.replace.mock.calls.at(-1)![0])).toContain('page=2');
  });

  it('sorts on the server from the header and from the sort control', async () => {
    render(<OrdersList />);
    await waitFor(() => screen.getAllByText('CORD-100'));
    fireEvent.change(screen.getByLabelText('الترتيب'), { target: { value: 'total' } });
    expect(String(nav.replace.mock.calls.at(-1)![0])).toContain('sort=total');
    fireEvent.click(screen.getByRole('button', { name: 'الإجمالي' }));
    expect(nav.replace).toHaveBeenCalled();
  });

  it('shows an empty state, and a filtered-empty state with a clear action', async () => {
    fetchOrdersMock.mockResolvedValue(page([]));
    const { unmount } = render(<OrdersList />);
    await waitFor(() => expect(screen.getByText('لا توجد طلبات')).toBeTruthy());
    unmount();
    nav.search = 'payment_status=paid';
    render(<OrdersList />);
    await waitFor(() => expect(screen.getByText('لا نتائج مطابقة')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'مسح التصفية' }));
    expect(String(nav.replace.mock.calls.at(-1)![0])).not.toContain('payment_status');
  });

  it('shows a loading state before data arrives', async () => {
    let resolve!: (v: unknown) => void;
    fetchOrdersMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<OrdersList />);
    expect(document.querySelector('[aria-busy="true"], [role="status"]')).toBeTruthy();
    await act(async () => resolve(page()));
    await waitFor(() => screen.getAllByText('CORD-100'));
  });

  it.each([
    [{ status: 403 }, /لا تملك صلاحية عرض طلبات المتجر/],
    [{ status: 422 }, /رفض معاملات البحث/],
    [new TypeError('Failed to fetch'), /تعذّر الاتصال بالخادم/],
    [{ status: 500 }, /تعذّر تحميل الطلبات/],
  ])('maps %j to a clear message', async (error, message) => {
    fetchOrdersMock.mockRejectedValue(error);
    render(<OrdersList />);
    await waitFor(() => expect(screen.getAllByText(message).length).toBeGreaterThan(0));
  });

  it('offers retry after a failure and reloads', async () => {
    fetchOrdersMock.mockRejectedValueOnce(new TypeError('x')).mockResolvedValue(page());
    render(<OrdersList />);
    const retry = await screen.findByRole('button', { name: 'إعادة المحاولة' });
    fireEvent.click(retry);
    await waitFor(() => screen.getAllByText('CORD-100'));
  });

  it('ignores a stale response when filters change quickly', async () => {
    let first!: (v: unknown) => void;
    fetchOrdersMock.mockReturnValueOnce(new Promise((r) => { first = r; })).mockResolvedValue(page([summaryFixture({ number: 'CORD-NEW' })]));
    const { rerender } = render(<OrdersList />);
    nav.search = 'payment_status=paid';
    rerender(<OrdersList />);
    await waitFor(() => screen.getAllByText('CORD-NEW'));
    await act(async () => first(page([summaryFixture({ number: 'CORD-OLD' })])));
    expect(screen.queryByText('CORD-OLD')).toBeNull();
  });

  it('exposes no write actions', async () => {
    render(<OrdersList />);
    await waitFor(() => screen.getAllByText('CORD-100'));
    const names = [...screen.getAllByRole('button'), ...screen.getAllByRole('link')].map((el) => (el.textContent ?? '') + (el.getAttribute('aria-label') ?? ''));
    for (const word of ['قبول', 'إلغاء', 'تحصيل', 'شحن', 'تجهيز', 'فاتورة']) {
      expect(names.some((n) => n.includes(word)), word).toBe(false);
    }
    expect(document.querySelector('form')).toBeNull();
  });

  it('renders in English with LTR-safe phone numbers and translated statuses', async () => {
    locale.current = 'en';
    render(<OrdersList />);
    await waitFor(() => screen.getAllByText('CORD-100'));
    expect(screen.getAllByText('Awaiting collection').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Store')).toBeTruthy();
    const phone = screen.getAllByText('0500000001')[0];
    expect(phone.getAttribute('dir')).toBe('ltr');
  });

  it('renders a mobile card record per order alongside the desktop table', async () => {
    render(<OrdersList />);
    await waitFor(() => screen.getAllByText('CORD-100'));
    expect(document.querySelectorAll('table').length).toBeGreaterThan(0);
    expect(screen.getAllByText('CORD-100').length).toBeGreaterThanOrEqual(2);
  });

  it('remembers the list query for returning from the detail page', async () => {
    nav.search = 'payment_status=paid&page=2';
    render(<OrdersList />);
    await waitFor(() => expect(fetchOrdersMock).toHaveBeenCalled());
    expect(window.sessionStorage.getItem('awj-commerce-orders-list-query')).toBe('payment_status=paid&page=2');
  });

  it('lists channels from the store catalog as an independent filter', async () => {
    render(<OrdersList />);
    await waitFor(() => expect(fetchOrdersMock).toHaveBeenCalled());
    const channel = screen.getByLabelText('قناة البيع');
    expect(within(channel).getAllByRole('option').map((o) => o.textContent)).toEqual(['كل القنوات', 'زهور طيبة', 'زهور الرشد']);
  });
});
