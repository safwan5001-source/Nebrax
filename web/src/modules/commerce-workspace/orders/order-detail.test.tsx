// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detailFixture } from './test-fixtures';
import { OrderDetailView } from './order-detail';

const locale = vi.hoisted(() => ({ current: 'ar' }));
vi.mock('next-intl', () => {
  const t = (key: string) => key;
  t.rich = (key: string) => key;
  return { useLocale: () => locale.current, useTranslations: () => t };
});
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
const fetchOrderMock = vi.hoisted(() => vi.fn());
vi.mock('./orders-api', () => ({ fetchOrder: (...a: unknown[]) => fetchOrderMock(...a) }));
vi.mock('@/modules/commerce-workspace/store-context', () => ({
  useOptionalCommerceStoreContext: () => ({ selectedStoreId: 's1' }),
}));

describe('OrderDetailView', () => {
  beforeEach(() => {
    locale.current = 'ar';
    fetchOrderMock.mockReset();
    window.sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear(); // الوحدة تحفظ استعلام القائمة؛ لا تُسرَّب لملفات اختبار أخرى في العامل نفسه.
  });

  it('shows number, status and payment status as independent badges, customer, items and total', async () => {
    fetchOrderMock.mockResolvedValue(detailFixture());
    render(<OrderDetailView id="o1" />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'CORD-100' })).toBeTruthy());
    expect(screen.getAllByText('مؤكَّد').length).toBeGreaterThan(0);
    expect(screen.getAllByText('بانتظار التحصيل').length).toBeGreaterThan(0);
    expect(screen.getAllByText('وردة جورية').length).toBeGreaterThan(0);
    expect(screen.getAllByText('مبروك').length).toBeGreaterThan(0);
    expect(screen.getAllByText('buyer@example.test').length).toBeGreaterThan(0);
    expect(screen.getAllByText('الدمام').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/115/).length).toBeGreaterThan(0);
  });

  it('warns clearly when the order is not posted to accounting, including cash on delivery', async () => {
    fetchOrderMock.mockResolvedValue(detailFixture());
    render(<OrderDetailView id="o1" />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('هذا الطلب لم يُرحَّل محاسبياً');
    expect(screen.getAllByText('غير مُرحَّل محاسبياً').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/الدفع عند الاستلام: التحصيل المسجَّل لا يُنشئ سنداً/).length).toBeGreaterThan(0);
  });

  it('does not treat a collected payment as proof of a ledger entry', async () => {
    fetchOrderMock.mockResolvedValue(
      detailFixture({ payment: { ...detailFixture().payment, status: 'collected', collected_at: '2026-10-21T09:00:00+03:00' } }),
    );
    render(<OrderDetailView id="o1" />);
    await screen.findByRole('alert');
    expect(screen.getAllByText('تم التحصيل').length).toBeGreaterThan(0);
    expect(screen.queryByText('مُرحَّل محاسبياً')).toBeNull();
    expect(screen.getAllByText('غير مُرحَّل محاسبياً').length).toBeGreaterThan(0);
  });

  it('shows the posting and an invoice link only when a posting exists', async () => {
    fetchOrderMock.mockResolvedValue(
      detailFixture({
        payment: { ...detailFixture().payment, method: 'online', status: 'paid', paid_at: '2026-10-21T09:00:00+03:00' },
        accounting: { posted: true, invoice_id: 'inv-9', payment_id: 'pay-9', accounting_date: '2026-10-21', amount: { amount_minor: 11500, currency: 'SAR' } },
      }),
    );
    render(<OrderDetailView id="o1" />);
    await waitFor(() => expect(screen.getAllByText('مُرحَّل محاسبياً').length).toBeGreaterThan(0));
    expect(screen.queryByRole('alert')).toBeNull();
    const link = screen.getAllByRole('link', { name: 'فتح الفاتورة' })[0];
    expect(link.getAttribute('href')).toBe('/invoices/inv-9');
  });

  it('lists online payment attempts with review reasons', async () => {
    fetchOrderMock.mockResolvedValue(
      detailFixture({
        payment: {
          ...detailFixture().payment,
          method: 'online',
          status: 'pending',
          attempts: [
            { id: 'a1', capture_status: 'captured', amount: { amount_minor: 11500, currency: 'SAR' }, captured: { amount_minor: 11500, currency: 'SAR' }, review_reasons: ['late_capture'], captured_at: null, created_at: '2026-10-21T09:00:00+03:00' },
          ],
        },
      }),
    );
    render(<OrderDetailView id="o1" />);
    await waitFor(() => expect(screen.getAllByText(/late_capture/).length).toBeGreaterThan(0));
    expect(screen.getAllByText('captured').length).toBeGreaterThan(0);
  });

  it('shows gift, schedule and pickup information when present', async () => {
    fetchOrderMock.mockResolvedValue(
      detailFixture({
        delivery_method: 'pickup',
        gift: { recipient_name: 'ليلى', recipient_phone: '0511111111', sender_display_name: 'أحمد', hide_sender: true, message: 'كل عام وأنتم بخير' },
        schedule: { method: 'standard', date: '2026-10-25', slot: { label: 'مساءً', label_en: 'Evening', start_time: '17:00', end_time: '20:00' }, timezone: 'Asia/Riyadh' },
      }),
    );
    render(<OrderDetailView id="o1" />);
    await waitFor(() => expect(screen.getAllByText(/استلام من المتجر/).length).toBeGreaterThan(0));
    expect(screen.getAllByText('كل عام وأنتم بخير').length).toBeGreaterThan(0);
    expect(screen.getAllByText('مخفي عن المستلم').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2026-10-25').length).toBeGreaterThan(0);
    expect(screen.queryByText('شارع الخليج')).toBeNull();
  });

  it('the back link restores the saved list query and keeps the active store', async () => {
    window.sessionStorage.setItem('awj-commerce-orders-list-query', 'payment_status=paid&page=2');
    fetchOrderMock.mockResolvedValue(detailFixture());
    render(<OrderDetailView id="o1" />);
    await screen.findByRole('alert');
    const back = screen.getAllByRole('link').find((a) => a.getAttribute('href')?.startsWith('/commerce/orders?'))!;
    expect(back.getAttribute('href')).toBe('/commerce/orders?payment_status=paid&page=2&store=s1');
  });

  it.each([
    [{ status: 404 }, 'الطلب غير موجود'],
    [{ status: 403 }, 'لا تملك صلاحية عرض طلبات المتجر.'],
  ])('renders a dedicated state for %j', async (error, title) => {
    fetchOrderMock.mockRejectedValue(error);
    render(<OrderDetailView id="o1" />);
    await waitFor(() => expect(screen.getByText(title)).toBeTruthy());
    expect(screen.getByRole('link', { name: 'العودة إلى الطلبات' })).toBeTruthy();
  });

  it('shows a network error with retry that reloads', async () => {
    fetchOrderMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(detailFixture());
    render(<OrderDetailView id="o1" />);
    expect(await screen.findByText(/تعذّر الاتصال بالخادم/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry|إعادة المحاولة/ })); // ErrorState يترجم عبر مزوّد next-intl
    await waitFor(() => expect(screen.getByRole('heading', { name: 'CORD-100' })).toBeTruthy());
  });

  it('exposes no write actions and renders in English', async () => {
    locale.current = 'en';
    fetchOrderMock.mockResolvedValue(detailFixture());
    render(<OrderDetailView id="o1" />);
    await screen.findByRole('alert');
    expect(screen.getAllByText('Awaiting collection').length).toBeGreaterThan(0);
    const names = screen.queryAllByRole('button').map((b) => b.textContent ?? '');
    for (const word of ['Cancel', 'Accept', 'Collect', 'Ship', 'Invoice']) expect(names.some((n) => n.includes(word))).toBe(false);
    expect(document.querySelector('form')).toBeNull();
  });

  it('the header advertises cancellation only for an order that can still be cancelled (not for a cancelled one)', async () => {
    locale.current = 'en';
    fetchOrderMock.mockResolvedValue(detailFixture({ cancel_action: { available: true, blocked_reason: null } }));
    const { unmount } = render(<OrderDetailView id="o1" />);
    await screen.findByRole('alert');
    expect(screen.getAllByText(/can be cancelled from this screen/).length).toBe(1);
    unmount();
    fetchOrderMock.mockResolvedValue(
      detailFixture({
        status: 'confirmed',
        lifecycle_status: 'cancelled',
        cancel_action: { available: false, blocked_reason: 'already_cancelled' },
      }),
    );
    render(<OrderDetailView id="o1" />);
    await screen.findAllByText('Cancelled');
    expect(screen.queryAllByText(/can be cancelled from this screen/).length).toBe(0);
    expect(screen.getAllByText(/Read only/).length).toBe(1);
  });
});
