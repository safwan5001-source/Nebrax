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
    silence: vi.fn(),
    enableSound: vi.fn().mockResolvedValue('armed'),
    testSound: vi.fn().mockResolvedValue(true),
    ...over,
  };
}

const open = () => fireEvent.click(screen.getByRole('button', { name: /تنبيهات الطلبات|Order alerts/ }));

describe('OrderAlertCenter', () => {
  beforeEach(() => { locale.current = 'ar'; state.current = make(); });
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

  it('طلبات معلّقة: شارة بالعدد، وصف لكل طلب برقمه وأسبابه ورابط فتح صحيح وزر إسكات', () => {
    const silence = vi.fn();
    state.current = make({ snapshot: live({ pending: [pendingItem('o-1', 'CORD-1'), pendingItem('o-2', 'CORD-2')], total: 2 }), silence });
    render(<OrderAlertCenter />);
    expect(screen.getByTestId('alert-badge').textContent).toBe('2');
    open();
    const items = screen.getAllByTestId('alert-item');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('CORD-1');
    expect(items[0].textContent).toContain('طلب جديد');
    expect(items[0].textContent).toContain('بانتظار القبول');
    expect(screen.getAllByRole('link', { name: 'فتح الطلب' })[1].getAttribute('href')).toBe('/commerce/orders/o-2');
    fireEvent.click(screen.getAllByRole('button', { name: 'إسكات على هذا الجهاز' })[0]);
    expect(silence).toHaveBeenCalledWith('o-1');
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
