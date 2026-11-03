// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertConfig, AttentionRow } from './contract';
import { FakeLocks, createChannelHub } from './test-fakes';

const ack = vi.hoisted(() => ({ acknowledgeOrder: vi.fn() }));
vi.mock('./acknowledge-order', () => ack);
const api = vi.hoisted(() => ({ fetchAlertConfig: vi.fn(), fetchFeedHead: vi.fn(), fetchFeedPage: vi.fn(), fetchAttention: vi.fn() }));
vi.mock('./alerts-api', () => api);
const sound = vi.hoisted(() => ({
  alertSound: { state: 'locked', subscribe: () => () => {}, syncActive: vi.fn(), stopAll: vi.fn(), unlock: vi.fn(), playOnce: vi.fn() },
}));
vi.mock('@/lib/alert-sound', () => sound);
vi.mock('@/lib/use-can', () => ({
  useCurrentUser: () => ({ id: 'u1', tenant_id: 't1', preferences: {} }),
  useCan: () => ({ can: () => true, hydrated: true }),
}));

import { OrderAlertsProvider } from './order-alerts-provider';
import { useOrderAlerts } from './use-order-alerts';

const cfg: AlertConfig = { enabled: true, mode: 'feed_attention', polling: { feed_ms: 10_000, attention_ms: 60_000, attention_only_ms: 15_000 } };
const row = (id: string): AttentionRow => ({
  order: { id, number: `CORD-${id}`, storefront_id: null, sales_channel_id: null, delivery_method: null, created_at: '2026-11-03T10:00:00Z' },
  payment: { method: 'cod', status: 'awaiting_collection' },
  reasons: ['new_order'],
  alert: { pending: true },
});

function Consumer({ id }: { id: string }) {
  const alerts = useOrderAlerts();

  return <output data-testid={id}>{`${alerts.status}:${alerts.role}:${alerts.snapshot.pending.length}`}</output>;
}

describe('OrderAlertsProvider (COPS-H3-5)', () => {
  const locks = new FakeLocks();
  const hub = createChannelHub();

  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    for (const fn of Object.values(api)) fn.mockReset();
    api.fetchAlertConfig.mockResolvedValue(cfg);
    api.fetchFeedHead.mockResolvedValue(7);
    api.fetchFeedPage.mockResolvedValue({ data: [], meta: { after_seq: 7, next_after_seq: 7, has_more: false, limit: 100, head_seq: 7 } });
    api.fetchAttention.mockResolvedValue({ data: [row('a')], meta: { truncated: false, window_hours: 48, limit: 100 } });
    Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
    (globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel = function (name: string) { return hub(name); } as unknown as typeof BroadcastChannel;
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('مستهلكان تحت مزوّد واحد يتشاركان محرّكاً واحداً: إعداد واحد وتهيئة واحدة واستطلاع واحد', async () => {
    render(
      <OrderAlertsProvider>
        <Consumer id="a" />
        <Consumer id="b" />
      </OrderAlertsProvider>,
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(screen.getByTestId('a').textContent).toBe('on:leader:1');
    expect(screen.getByTestId('b').textContent).toBe('on:leader:1'); // الحالة نفسها، لا قائد/متابع داخل التبويب الواحد
    expect(api.fetchAlertConfig).toHaveBeenCalledTimes(1);
    expect(api.fetchFeedHead).toHaveBeenCalledTimes(1);
    expect(api.fetchAttention).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(api.fetchFeedPage).toHaveBeenCalledTimes(1); // دورة استطلاع واحدة لا اثنتان
  });

  it('خارج المزوّد يبقى السلوك القديم: مثيل خاص بالمستهلك', async () => {
    render(<Consumer id="solo" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId('solo').textContent).toBe('on:leader:1');
    expect(api.fetchAlertConfig).toHaveBeenCalledTimes(1);
  });
});
