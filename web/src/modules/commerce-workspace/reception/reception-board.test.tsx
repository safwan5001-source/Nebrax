// @vitest-environment jsdom
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_SNAPSHOT, type AlertSnapshot } from '../alerts/contract';
import type { OrderAlertsState } from '../alerts/use-order-alerts';
import { summaryFixture } from '../orders/test-fixtures';

const locale = { current: 'ar' };
vi.mock('next-intl', () => {
  const t = (key: string) => key;
  t.rich = (key: string) => key;
  return { useLocale: () => locale.current, useTranslations: () => t };
});
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('../store-context', () => ({ useOptionalCommerceStoreContext: () => ({ selectedStoreId: 's1' }) }));

const alertsState: { current: OrderAlertsState } = { current: null as never };
vi.mock('../alerts/use-order-alerts', () => ({ useOrderAlerts: () => alertsState.current }));
const api = vi.hoisted(() => ({ fetchBoard: vi.fn() }));
vi.mock('./reception-api', () => api);

import { ReceptionBoard } from './reception-board';

const live = (over: Partial<AlertSnapshot> = {}): AlertSnapshot => ({ ...EMPTY_SNAPSHOT, connection: 'live', lastSuccessAt: Date.now(), ...over });
const pendingItem = (id: string, number: string) => ({ orderId: id, number, createdAt: '2026-11-03T10:00:00Z', reasons: ['new_order'], deliveryMethod: 'standard', paymentMethod: 'cod' });
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
const order = (id: string, number: string, status: string, over = {}) => summaryFixture({ id, number, operational_status: status, created_at: new Date(Date.now() - 5 * 60_000).toISOString(), ...over });
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

describe('ReceptionBoard (COPS-H3-5)', () => {
  beforeEach(() => {
    locale.current = 'ar';
    alertsState.current = make();
    api.fetchBoard.mockReset();
    api.fetchBoard.mockResolvedValue({
      orders: [order('o1', 'CORD-1', 'awaiting_acceptance'), order('o2', 'CORD-2', 'accepted'), order('o3', 'CORD-3', 'preparing'), order('o4', 'CORD-4', 'ready'), order('o5', 'CORD-5', 'out_for_delivery'), order('o6', 'CORD-6', 'delivered')],
      truncated: false,
    });
  });
  afterEach(cleanup);

  it('يوزّع الطلبات على الأعمدة الخمسة من حالات الخادم ويعرض عمر الطلب', async () => {
    render(<ReceptionBoard />);
    await flush();
    const inCol = (key: string) => Array.from(screen.getByTestId(`board-col-${key}`).querySelectorAll('[data-testid="board-card"]')).map((n) => n.getAttribute('data-order-id'));
    expect(inCol('new')).toEqual(['o1']);
    expect(inCol('accepted')).toEqual(['o2', 'o3']);
    expect(inCol('ready')).toEqual(['o4']);
    expect(inCol('dispatch')).toEqual(['o5']);
    expect(inCol('done')).toEqual(['o6']);
    expect(screen.getAllByTestId('board-elapsed')[0].textContent).toContain('5');
  });

  it('طلب مقبول ينتظر التنبيه يظهر في «جديد» بشارة وزر إقرار، والإقرار يمرّ عبر مركز التنبيه المشترك وحده', async () => {
    const acknowledge = vi.fn().mockResolvedValue({ ok: true, created: true });
    alertsState.current = make({ acknowledge, snapshot: live({ pending: [pendingItem('o2', 'CORD-2')] }) });
    render(<ReceptionBoard />);
    await flush();
    const newCol = screen.getByTestId('board-col-new');
    expect(newCol.querySelector('[data-order-id="o2"]')).not.toBeNull();
    expect(screen.getAllByTestId('board-new-badge')).toHaveLength(1);
    expect(screen.getByTestId('board-pending-count').textContent).toContain('1');
    await act(async () => { fireEvent.click(newCol.querySelector('[data-order-id="o2"] button:not([data-testid])')!); await Promise.resolve(); });
    expect(acknowledge).toHaveBeenCalledWith('o2');
  });

  it('فشل إقرار عابر يعرض الخطأ ويمكّن المحاولة من جديد؛ الرفض المستقر لا يعرض خطأ إقرار', async () => {
    const acknowledge = vi.fn().mockResolvedValue({ ok: false, settled: false, status: 500, reason: null });
    alertsState.current = make({ acknowledge, snapshot: live({ pending: [pendingItem('o2', 'CORD-2')] }) });
    render(<ReceptionBoard />);
    await flush();
    await act(async () => { fireEvent.click(screen.getByTestId('board-col-new').querySelector('[data-order-id="o2"] button:not([data-testid])')!); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByTestId('board-ack-error')).toBeTruthy();
  });

  it('بوابة التنبيه مغلقة: إشعار واضح، لا زر صوت، والتحديث اليدوي يجلب فقط', async () => {
    alertsState.current = make({ status: 'off', snapshot: EMPTY_SNAPSHOT });
    render(<ReceptionBoard />);
    await flush();
    expect(screen.getByTestId('board-alerts-off')).toBeTruthy();
    expect(screen.queryByTestId('board-sound-enable')).toBeNull();
    expect(screen.getByTestId('board-connection').textContent).toContain('غير مفعّل');
    expect(api.fetchBoard).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(screen.getByTestId('board-refresh')); await Promise.resolve(); });
    expect(api.fetchBoard).toHaveBeenCalledTimes(2);
  });

  it('الصوت غير مسلَّح: زر تفعيل بنقرة، ويُستدعى من نفس معالج النقر', async () => {
    const enableSound = vi.fn().mockResolvedValue('armed');
    alertsState.current = make({ soundState: 'locked', enableSound });
    render(<ReceptionBoard />);
    await flush();
    fireEvent.click(screen.getByTestId('board-sound-enable'));
    expect(enableSound).toHaveBeenCalledTimes(1);
  });

  it('انقطاع الاتصال يظهر تحذيراً، والاتصال الحي يعرض «متصل» مع نصّي الموثوقية الملزمين', async () => {
    alertsState.current = make({ snapshot: live({ connection: 'offline' }) });
    render(<ReceptionBoard />);
    await flush();
    expect(screen.getByTestId('board-stale')).toBeTruthy();
    cleanup();
    alertsState.current = make();
    render(<ReceptionBoard />);
    await flush();
    expect(screen.getByTestId('board-connection').textContent).toContain('متصل');
    expect(screen.getByText(/قد يتأخر التنبيه أو لا يصل/)).toBeTruthy();
  });

  it('تغيّر revision اللقطة المشتركة يعيد جلب اللوحة بعد مهلة الدمج دون أي استطلاع آخر', async () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<ReceptionBoard />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(api.fetchBoard).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); }); // دقائق بلا تغيّر ⇒ لا جلب
      expect(api.fetchBoard).toHaveBeenCalledTimes(1);
      alertsState.current = make({ snapshot: live({ revision: 3 }) });
      rerender(<ReceptionBoard />);
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
      expect(api.fetchBoard).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('فشل التحميل الأول ⇒ حالة خطأ مع إعادة محاولة', async () => {
    api.fetchBoard.mockRejectedValueOnce(new Error('x'));
    render(<ReceptionBoard />);
    await flush();
    await flush();
    expect(screen.getByRole('button', { name: /retry|إعادة المحاولة/ })).toBeTruthy();
  });

  it('الإنجليزية: أسماء الأعمدة ونصوص الاتجاه', async () => {
    locale.current = 'en';
    render(<ReceptionBoard />);
    await flush();
    expect(screen.getAllByText('Recently finished').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Out for delivery/).length).toBeGreaterThan(0);
  });
});
