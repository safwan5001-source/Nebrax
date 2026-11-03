// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertConfig, AttentionRow } from './contract';
import { FakeLocks, createChannelHub } from './test-fakes';

const ack = vi.hoisted(() => ({ acknowledgeOrder: vi.fn() }));
vi.mock('./acknowledge-order', () => ack);

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
    for (const fn of [...Object.values(api), sound.alertSound.syncActive, sound.alertSound.stopAll, ack.acknowledgeOrder]) fn.mockReset();
    ack.acknowledgeOrder.mockResolvedValue({ ok: true, created: true });
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

  it('الإقرار يُسكت فوراً في كل التبويبات ويطلب الخادم مرة واحدة ويحفظ الإسكات للجهاز', async () => {
    const one = renderHook(() => useOrderAlerts());
    const two = renderHook(() => useOrderAlerts());
    await tick(0);
    await tick(0);
    await tick(0);

    await act(async () => { await two.result.current.acknowledge('a'); });
    await tick(0);
    expect(ack.acknowledgeOrder).toHaveBeenCalledTimes(1);
    expect(ack.acknowledgeOrder).toHaveBeenCalledWith('a');
    expect(one.result.current.snapshot.pending).toEqual([]);
    expect(two.result.current.snapshot.pending).toEqual([]);
    expect(window.localStorage.getItem('awj:commerce-alerts:silenced:t1:u1')).toContain('"a"');
  });

  it('الإسكات أثناء طيران الإقرار عابر: لا يُكتب في التخزين الدائم قبل رد الخادم (Codex)', async () => {
    let resolveAck: (v: unknown) => void = () => {};
    ack.acknowledgeOrder.mockImplementation(() => new Promise((r) => { resolveAck = r; }));
    const { result } = renderHook(() => useOrderAlerts());
    await tick(0);
    await tick(0);

    let pendingAck: Promise<unknown> = Promise.resolve();
    act(() => { pendingAck = result.current.acknowledge('a'); });
    expect(result.current.snapshot.pending).toEqual([]); // صمت فوري محلياً
    expect(window.localStorage.getItem('awj:commerce-alerts:silenced:t1:u1') ?? '').not.toContain('"a"');

    await act(async () => {
      resolveAck({ ok: true, settled: true, status: 200, reason: null });
      await pendingAck;
    });
    expect(window.localStorage.getItem('awj:commerce-alerts:silenced:t1:u1')).toContain('"a"'); // يثبت بعد الحسم
  });

  it('فشل الإقرار العابر (شبكة/5xx) يُرجع التنبيه ولا يوهم أن الآخرين أُسكتوا', async () => {
    ack.acknowledgeOrder.mockResolvedValue({ ok: false, settled: false, status: null, reason: null });
    const { result } = renderHook(() => useOrderAlerts());
    await tick(0);
    await tick(0);

    let outcome: unknown;
    await act(async () => { outcome = await result.current.acknowledge('a'); });
    await tick(0);
    expect(outcome).toMatchObject({ ok: false, settled: false });
    expect(result.current.snapshot.pending.map((p) => p.orderId)).toEqual(['a']);
    expect(window.localStorage.getItem('awj:commerce-alerts:silenced:t1:u1') ?? '').not.toContain('"a"');
  });

  it('فشل إقرار بدأ من تبويب متابع يُعيد التنبيه فوراً في كل التبويبات (القائد يعيد الإسقاط) (Codex)', async () => {
    ack.acknowledgeOrder.mockResolvedValue({ ok: false, settled: false, status: null, reason: null });
    const one = renderHook(() => useOrderAlerts());
    const two = renderHook(() => useOrderAlerts());
    await tick(0);
    await tick(0);
    await tick(0);
    const follower = one.result.current.role === 'follower' ? one : two;
    const leader = follower === one ? two : one;
    expect(follower.result.current.snapshot.pending.map((p) => p.orderId)).toEqual(['a']);

    await act(async () => { await follower.result.current.acknowledge('a'); });
    // بلا انتظار دورة استطلاع جديدة (لا تقديم للمؤقّتات): التنبيه عاد في التبويبين.
    expect(leader.result.current.snapshot.pending.map((p) => p.orderId)).toEqual(['a']);
    expect(follower.result.current.snapshot.pending.map((p) => p.orderId)).toEqual(['a']);
  });

  it('إقرار طائر ثم إزالة التأثير: فشله المتأخر لا يعيد الصوت ولا يحدّث اللقطة (Codex)', async () => {
    let resolveAck: (v: unknown) => void = () => {};
    ack.acknowledgeOrder.mockImplementation(() => new Promise((r) => { resolveAck = r; }));
    const { result, unmount } = renderHook(() => useOrderAlerts());
    await tick(0);
    await tick(0);
    await act(async () => { sound.alertSound.arm(); });
    await tick(0);
    expect(result.current.soundOwner).toBe(true); // حامل صوت فعلي: أي render متأخر سيعيد syncActive

    let pendingAck: Promise<unknown> = Promise.resolve();
    act(() => { pendingAck = result.current.acknowledge('a'); });
    unmount();
    sound.alertSound.syncActive.mockClear();

    await act(async () => {
      resolveAck({ ok: false, settled: false, status: null, reason: null }); // فشل عابر بعد الإزالة
      await pendingAck;
    });
    expect(sound.alertSound.syncActive).not.toHaveBeenCalled();
  });

  it('رفض مستقر (404/409: ملغى/غير جاهز) يطلب الحقيقة من الخادم ولا يثبّت إسكاتاً دائماً (Codex)', async () => {
    ack.acknowledgeOrder.mockResolvedValue({ ok: false, settled: true, status: 409, reason: 'already_cancelled' });
    const { result } = renderHook(() => useOrderAlerts());
    await tick(0);
    await tick(0);
    const attentionCalls = api.fetchAttention.mock.calls.length;
    api.fetchAttention.mockResolvedValue({ data: [], meta: { truncated: false, window_hours: 48, limit: 100 } });

    await act(async () => { await result.current.acknowledge('a'); });
    await tick(0);
    expect(result.current.snapshot.pending).toEqual([]);
    expect(api.fetchAttention.mock.calls.length).toBeGreaterThan(attentionCalls); // مصالحة فورية
    expect(window.localStorage.getItem('awj:commerce-alerts:silenced:t1:u1') ?? '').not.toContain('"a"'); // لا أثر دائم بلا إقرار فعلي
  });

  it('رفض مستقر ثم بقاء الطلب معلَّقاً في الخادم: يعود التنبيه بعد انتهاء الإسكات العابر (Codex)', async () => {
    ack.acknowledgeOrder.mockResolvedValue({ ok: false, settled: true, status: 404, reason: null });
    const { result } = renderHook(() => useOrderAlerts());
    await tick(0);
    await tick(0);

    await act(async () => { await result.current.acknowledge('a'); });
    await tick(0);
    expect(result.current.snapshot.pending).toEqual([]); // صمت عابر فوري

    await tick(70_000); // بعد 60ث وعدة دورات استطلاع: الخادم ما زال يقول pending
    expect(result.current.snapshot.pending.map((p) => p.orderId)).toEqual(['a']);
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
