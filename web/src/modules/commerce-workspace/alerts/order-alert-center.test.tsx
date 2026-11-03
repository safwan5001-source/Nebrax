// @vitest-environment jsdom
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_SNAPSHOT, type AlertSnapshot } from './contract';
import type { OrderAlertsState } from './use-order-alerts';

const locale = { current: 'ar' };
vi.mock('next-intl', () => ({ useLocale: () => locale.current }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

const path = vi.hoisted(() => ({ current: '/commerce' as string | null }));
vi.mock('next/navigation', () => ({ usePathname: () => path.current }));

const state: { current: OrderAlertsState } = { current: null as never };
vi.mock('./use-order-alerts', () => ({ useOrderAlerts: () => state.current }));

import { OrderAlertCenter } from './order-alert-center';

const pendingItem = (id: string, number: string) => ({ orderId: id, number, createdAt: '2026-11-03T10:00:00Z', reasons: ['new_order', 'awaiting_acceptance'], deliveryMethod: 'standard', paymentMethod: 'cod' });
const live = (over: Partial<AlertSnapshot> = {}): AlertSnapshot => ({ ...EMPTY_SNAPSHOT, connection: 'live', lastSuccessAt: Date.now(), ...over });

function make(over: Partial<OrderAlertsState> = {}): OrderAlertsState {
  return {
    status: 'on',
    config: { enabled: true, mode: 'feed_attention', polling: { feed_ms: 10_000, attention_ms: 60_000, attention_only_ms: 15_000 } },
    snapshot: live(),
    role: 'leader',
    soundState: 'armed',
    soundOwner: true,
    acknowledge: vi.fn().mockResolvedValue({ ok: true, created: true }),
    enableSound: vi.fn().mockResolvedValue('armed'),
    testSound: vi.fn().mockResolvedValue(true),
    ...over,
  };
}

const open = () => fireEvent.click(screen.getByRole('button', { name: /تنبيهات الطلبات|Order alerts/ }));

describe('OrderAlertCenter', () => {
  it('شريط الصوت الثابت يغيب على مساحة الاستقبال (لها زر خاص)، ويبقى في غيرها (H3-5)', () => {
    state.current = make({ soundState: 'locked' });
    render(<OrderAlertCenter />);
    expect(screen.getByTestId('alert-sound-bar')).toBeTruthy();
    cleanup();
    path.current = '/commerce/orders/live';
    render(<OrderAlertCenter />);
    expect(screen.queryByTestId('alert-sound-bar')).toBeNull();
  });

  beforeEach(() => { locale.current = 'ar'; path.current = '/commerce'; state.current = make(); });
  afterEach(cleanup);

  it.each(['off', 'loading'] as const)('الحالة %s: لا يعرض شيئاً (بوابة مغلقة/غير مصرَّح)', (status) => {
    state.current = make({ status });
    const { container } = render(<OrderAlertCenter />);
    expect(container.innerHTML).toBe('');
  });

  it('بلا طلبات: لا شارة ويعرض حالة فارغة ونصي الموثوقية الملزمين', () => {
    render(<OrderAlertCenter />);
    expect(screen.queryByTestId('alert-badge')).toBeNull();
    open();
    expect(screen.getByText('لا طلبات تنتظر الانتباه الآن')).toBeTruthy();
    expect(screen.getByText('تصلك تنبيهات الطلبات الجديدة بينما تبقى هذه الصفحة مفتوحة. للحصول على الصوت، فعّله على هذا الجهاز.')).toBeTruthy();
    expect(screen.getByText('قد يتأخر التنبيه أو لا يصل إذا كانت الصفحة في الخلفية أو كان الجهاز مقفلاً.')).toBeTruthy();
  });

  it('طلبات معلّقة: شارة بالعدد، وصف لكل طلب برقمه وأسبابه ورابط فتح صحيح وزر إقرار مع شرحه', () => {
    const acknowledge = vi.fn().mockResolvedValue({ ok: true, created: true });
    state.current = make({ snapshot: live({ pending: [pendingItem('o-1', 'CORD-1'), pendingItem('o-2', 'CORD-2')], total: 2 }), acknowledge });
    render(<OrderAlertCenter />);
    expect(screen.getByTestId('alert-badge').textContent).toBe('2');
    open();
    const items = screen.getAllByTestId('alert-item');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('CORD-1');
    expect(items[0].textContent).toContain('طلب جديد');
    expect(items[0].textContent).toContain('بانتظار القبول');
    expect(screen.getAllByRole('link', { name: 'فتح الطلب' })[1].getAttribute('href')).toBe('/commerce/orders/o-2');
    expect(screen.getByText(/يُسكت التنبيه على كل الأجهزة والمستخدمين، ولا يغيّر حالة الطلب/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'إقرار الطلب' })[0]);
    expect(acknowledge).toHaveBeenCalledWith('o-1');
  });

  it('الإقرار: تعطيل أثناء الطلب (لا إرسال مكرر)، وفشل عابر يعرض رسالة، وحالة مستقرة (settled) بلا رسالة', async () => {
    let resolve: (v: unknown) => void = () => {};
    const acknowledge = vi.fn()
      .mockImplementationOnce(() => new Promise((r) => { resolve = r; }))
      .mockResolvedValueOnce({ ok: false, settled: false, status: null, reason: null })
      .mockResolvedValueOnce({ ok: false, settled: true, status: 409, reason: 'already_cancelled' });
    state.current = make({ snapshot: live({ pending: [pendingItem('o-1', 'CORD-1')], total: 1 }), acknowledge });
    render(<OrderAlertCenter />);
    open();
    const button = () => screen.getAllByRole('button').find((b) => /إقرار الطلب|جارٍ الإقرار/.test(b.textContent ?? '')) as HTMLButtonElement;

    fireEvent.click(button());
    fireEvent.click(button()); // نقرة ثانية أثناء الطلب
    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(button().disabled).toBe(true);
    expect(button().textContent).toBe('جارٍ الإقرار…');
    await act(async () => { resolve({ ok: true, created: true }); });
    expect(button().textContent).toBe('إقرار الطلب');

    await act(async () => { fireEvent.click(button()); });
    expect(screen.getByTestId('alert-ack-error').textContent).toContain('تعذّر إقرار الطلب');

    await act(async () => { fireEvent.click(button()); });
    expect(screen.queryByTestId('alert-ack-error')).toBeNull(); // تُمسح الرسالة عند المحاولة، والحالة المستقرة لا تُظهر خطأً
  });

  it('الشارة 99+ للأعداد الكبيرة', () => {
    state.current = make({ snapshot: live({ pending: Array.from({ length: 120 }, (_, i) => pendingItem(`o${i}`, `C${i}`)), total: 120 }) });
    render(<OrderAlertCenter />);
    expect(screen.getByTestId('alert-badge').textContent).toBe('99+');
  });

  it('الصوت غير مفعّل: شريط تفعيل دائم يستدعي enableSound، ويختفي عند التسليح', () => {
    const enableSound = vi.fn().mockResolvedValue('armed');
    state.current = make({ soundState: 'locked', enableSound });
    const { rerender } = render(<OrderAlertCenter />);
    const bar = screen.getByTestId('alert-sound-bar');
    expect(bar.textContent).toContain('الصوت غير مفعّل على هذا الجهاز');
    fireEvent.click(bar.querySelector('button') as HTMLButtonElement);
    expect(enableSound).toHaveBeenCalledTimes(1);

    state.current = make({ soundState: 'armed' });
    rerender(<OrderAlertCenter />);
    expect(screen.queryByTestId('alert-sound-bar')).toBeNull();
  });

  it('اختبار التنبيه: نجاح بلا خطأ، وفشل يعرض إرشاد المتصفح', async () => {
    const testSound = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    state.current = make({ testSound });
    render(<OrderAlertCenter />);
    open();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'اختبار التنبيه' })); });
    expect(screen.queryByText(/منع المتصفح تشغيل الصوت/)).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'اختبار التنبيه' })); });
    expect(screen.getByText(/منع المتصفح تشغيل الصوت/)).toBeTruthy();
  });

  it('انقطاع/بيانات قديمة: تحذير مرئي، ونقطة الحالة تتبع الاتصال', () => {
    state.current = make({ snapshot: live({ connection: 'degraded', consecutiveFailures: 2, lastSuccessAt: Date.now() - 120_000 }) });
    render(<OrderAlertCenter />);
    expect(screen.getByTestId('alert-status-dot').className).toContain('bg-negative');
    open();
    expect(screen.getByTestId('alert-stale').textContent).toContain('30 ثانية');
    expect(screen.getByText('انقطاع مؤقت — نعيد المحاولة')).toBeTruthy();
  });

  it('وضع المقيَّد والاقتطاع يظهران، والصوت من تبويب آخر يُوضَّح', () => {
    state.current = make({ snapshot: live({ mode: 'attention_only', truncated: true }), soundOwner: false });
    render(<OrderAlertCenter />);
    open();
    expect(screen.getByText('تعرض هذه القائمة طلبات مخازنك فقط.')).toBeTruthy();
    expect(screen.getByText(/هناك طلبات أكثر مما يمكن عرضه/)).toBeTruthy();
    expect(screen.getByText('الصوت يُشغَّل من تبويب آخر مفتوح على هذا الجهاز.')).toBeTruthy();
  });

  it('الإنجليزية: نصوص LTR وأسماء الأزرار ونصا الموثوقية الملزمان', () => {
    locale.current = 'en';
    state.current = make({ snapshot: live({ pending: [pendingItem('o-9', 'CORD-9')], total: 1 }), soundState: 'locked' });
    render(<OrderAlertCenter />);
    open();
    expect(screen.getByRole('link', { name: 'Open order' }).getAttribute('href')).toBe('/commerce/orders/o-9');
    expect(screen.getByText('New-order alerts reach you while this page stays open. Enable sound on this device to hear them.')).toBeTruthy();
    expect(screen.getByText('Alerts may be delayed or missed if this page is in the background or the device is locked.')).toBeTruthy();
    expect(screen.getByTestId('alert-sound-bar').textContent).toContain('Sound is not enabled on this device');
  });

  it('رقم الطلب يُعرض LTR داخل واجهة RTL (يمنع انعكاس الأرقام)', () => {
    state.current = make({ snapshot: live({ pending: [pendingItem('o-1', 'CORD-2026-00002')], total: 1 }) });
    render(<OrderAlertCenter />);
    open();
    const number = screen.getByText('CORD-2026-00002');
    expect(number.getAttribute('dir')).toBe('ltr');
  });
});
