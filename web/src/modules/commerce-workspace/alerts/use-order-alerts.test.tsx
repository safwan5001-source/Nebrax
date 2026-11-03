// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertConfig, AttentionRow } from './contract';
import { FakeLocks, createChannelHub } from './test-fakes';

const api = vi.hoisted(() => ({
  fetchAlertConfig: vi.fn(),
  fetchFeedHead: vi.fn(),
  fetchFeedPage: vi.fn(),
  fetchAttention: vi.fn(),
}));
vi.mock('./alerts-api', () => api);

const sound = vi.hoisted(() => {
  const listeners = new Set<(e: { type: 'state'; state: string }) => void>();

  return {
    alertSound: {
      state: 'locked' as 'locked' | 'armed',
      subscribe: (cb: (e: { type: 'state'; state: string }) => void) => { listeners.add(cb); return () => listeners.delete(cb); },
      syncActive: vi.fn(),
      stopAll: vi.fn(),
      unlock: vi.fn(),
      playOnce: vi.fn(),
      arm() { this.state = 'armed'; for (const l of listeners) l({ type: 'state', state: 'armed' }); },
    },
  };
});
vi.mock('@/lib/alert-sound', () => sound);

const user = vi.hoisted(() => ({ current: { id: 'u1', tenant_id: 't1', preferences: {} as Record<string, unknown> } as { id: string; tenant_id: string; preferences: Record<string, unknown> } | null, can: true }));
vi.mock('@/lib/use-can', () => ({
  useCurrentUser: () => user.current,
  useCan: () => ({ can: () => user.can, hydrated: true }),
}));

import { useOrderAlerts } from './use-order-alerts';

const cfg = (over: Partial<AlertConfig> = {}): AlertConfig => ({ enabled: true, mode: 'feed_attention', polling: { feed_ms: 10_000, attention_ms: 60_000, attention_only_ms: 15_000 }, ...over });
const row = (id: string): AttentionRow => ({
  order: { id, number: `CORD-${id}`, storefront_id: null, sales_channel_id: null, delivery_method: null, created_at: '2026-11-03T10:00:00Z' },
  payment: { method: 'cod', status: 'awaiting_collection' },
  reasons: ['new_order'],
  alert: { pending: true },
});

const tick = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe('useOrderAlerts (COPS-H3-3)', () => {
  const locks = new FakeLocks();
  const hub = createChannelHub();

  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    user.current = { id: 'u1', tenant_id: 't1', preferences: {} };
    user.can = true;
    sound.alertSound.state = 'locked';
    for (const fn of [...Object.values(api), sound.alertSound.syncActive, sound.alertSound.stopAll]) fn.mockReset();
    api.fetchAlertConfig.mockResolvedValue(cfg());
    api.fetchFeedHead.mockResolvedValue(7);
    api.fetchFeedPage.mockResolvedValue({ data: [], meta: { after_seq: 7, next_after_seq: 7, has_more: false, limit: 100, head_seq: 7 } });
    api.fetchAttention.mockResolvedValue({ data: [row('a')], meta: { truncated: false, window_hours: 48, limit: 100 } });
    Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
    (globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel = function (name: string) { return hub(name); } as unknown as typeof BroadcastChannel;
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('بوابة مغلقة (enabled=false): لا استطلاع ولا صوت', async () => {
    api.fetchAlertConfig.mockResolvedValue(cfg({ enabled: false }));
    const { result } = renderHook(() => useOrderAlerts());
    await tick(30_000);
    expect(result.current.status).toBe('off');
    expect(api.fetchFeedHead).not.toHaveBeenCalled();
    expect(api.fetchAttention).not.toHaveBeenCalled();
    expect(sound.alertSound.syncActive).not.toHaveBeenCalled();
  });

  it('بلا صلاحية أو بتفضيل شخصي موقوف: لا يطلب حتى الإعداد', async () => {
    user.can = false;
    renderHook(() => useOrderAlerts());
    await tick(1_000);
    expect(api.fetchAlertConfig).not.toHaveBeenCalled();
    cleanup();

    user.can = true;
    user.current = { id: 'u1', tenant_id: 't1', preferences: { commerce_alerts: { enabled: false } } };
    renderHook(() => useOrderAlerts());
    await tick(1_000);
    expect(api.fetchAlertConfig).not.toHaveBeenCalled();
  });

  it('مفعّل: قائد يهيّئ من الرأس ثم الحالة، يظهر pending، والصوت لا يعمل قبل التسليح (يبقى locked)', async () => {
    const { result } = renderHook(() => useOrderAlerts());
    await tick(0);
    await tick(0);
    expect(result.current.status).toBe('on');
    expect(result.current.role).toBe('leader');
    expect(api.fetchFeedHead).toHaveBeenCalledTimes(1);
    expect(result.current.snapshot.pending.map((p) => p.orderId)).toEqual(['a']);
    expect(result.current.soundState).toBe('locked');
    // غير مُسلَّح ⇒ لا حامل صوت ⇒ stopAll وليس syncActive بمفاتيح.
    expect(sound.alertSound.syncActive).not.toHaveBeenCalledWith(['a']);
  });

  it('بعد التسليح والتبويب مرئي: حامل الصوت يزامن المفاتيح المعلّقة', async () => {
    const { result } = renderHook(() => useOrderAlerts());
    await tick(0);
    await tick(0);
    await act(async () => { sound.alertSound.arm(); });
    await tick(0);
    expect(result.current.soundOwner).toBe(true);
    expect(sound.alertSound.syncActive).toHaveBeenLastCalledWith(['a']);
  });

  it('تبويبان: واحد فقط يستطلع، والآخر يعرض اللقطة نفسها (قائد واحد لكل جهاز)', async () => {
    const one = renderHook(() => useOrderAlerts());
    const two = renderHook(() => useOrderAlerts());
    await tick(0);
    await tick(0);
    await tick(0);

    const leaders = [one.result.current.role, two.result.current.role].filter((r) => r === 'leader');
    expect(leaders).toHaveLength(1);
    expect(api.fetchFeedHead).toHaveBeenCalledTimes(1);
    expect(api.fetchAttention).toHaveBeenCalledTimes(1);
    expect(one.result.current.snapshot.pending.map((p) => p.orderId)).toEqual(['a']);
    expect(two.result.current.snapshot.pending.map((p) => p.orderId)).toEqual(['a']);
  });

  it('الإسكات المحلي يزيل الطلب من pending في كل التبويبات ويُحفظ للجهاز', async () => {
    const one = renderHook(() => useOrderAlerts());
    const two = renderHook(() => useOrderAlerts());
    await tick(0);
    await tick(0);
    await tick(0);

    await act(async () => { two.result.current.silence('a'); });
    await tick(0);
    expect(one.result.current.snapshot.pending).toEqual([]);
    expect(two.result.current.snapshot.pending).toEqual([]);
    expect(window.localStorage.getItem('awj:commerce-alerts:silenced:t1:u1')).toContain('"a"');
  });

  it('عند الإزالة (unmount) يتوقف الاستطلاع ويُصمَت الصوت', async () => {
    const { unmount } = renderHook(() => useOrderAlerts());
    await tick(0);
    await tick(0);
    const calls = api.fetchFeedPage.mock.calls.length + api.fetchAttention.mock.calls.length;
    unmount();
    expect(sound.alertSound.stopAll).toHaveBeenCalled();
    await tick(120_000);
    expect(api.fetchFeedPage.mock.calls.length + api.fetchAttention.mock.calls.length).toBe(calls);
  });

  it('عنوان التبويب يحمل عدد المعلّق ويُستعاد عند الإزالة', async () => {
    document.title = 'الطلبات';
    const { unmount } = renderHook(() => useOrderAlerts());
    await tick(0);
    await tick(0);
    expect(document.title).toBe('(1) الطلبات');
    unmount();
    expect(document.title).toBe('الطلبات');
  });

  it('فشل جلب الإعداد ⇒ off بصمت (لا استطلاع)', async () => {
    api.fetchAlertConfig.mockRejectedValue(new Error('x'));
    const { result } = renderHook(() => useOrderAlerts());
    await tick(1_000);
    expect(result.current.status).toBe('off');
    expect(api.fetchAttention).not.toHaveBeenCalled();
  });
});
