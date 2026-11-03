import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { AlertEngine, MAX_FEED_PAGES, isStale, type AlertEngineDeps } from './alert-engine';
import type { AlertConfig, AttentionResponse, AttentionRow, FeedResponse } from './contract';

const config = (over: Partial<AlertConfig> = {}): AlertConfig => ({
  enabled: true,
  mode: 'feed_attention',
  polling: { feed_ms: 10_000, attention_ms: 60_000, attention_only_ms: 15_000 },
  ...over,
});

const row = (id: string, pending = true): AttentionRow => ({
  order: { id, number: `CORD-${id}`, storefront_id: 's1', sales_channel_id: 'c1', delivery_method: 'standard', created_at: '2026-11-03T10:00:00Z' },
  payment: { method: 'cod', status: 'awaiting_collection' },
  reasons: ['new_order'],
  alert: { pending },
});

const attention = (...rows: AttentionRow[]): AttentionResponse => ({ data: rows, meta: { truncated: false, window_hours: 48, limit: 100 } });
const page = (events: number, next: number, hasMore = false, head = next): FeedResponse => ({
  data: Array.from({ length: events }, (_, i) => ({ seq: next - events + i + 1, type: 'order.placed', occurred_at: null, order: { id: `o${i}`, number: null } })),
  meta: { after_seq: 0, next_after_seq: next, has_more: hasMore, limit: 100, head_seq: head },
});

describe('AlertEngine (COPS-H3-3)', () => {
  let cursor: number | null;
  let silenced: Set<string>;
  let visible: boolean;
  let online: boolean;
  let deps: AlertEngineDeps & {
    fetchFeedPage: ReturnType<typeof vi.fn>;
    fetchFeedHead: ReturnType<typeof vi.fn>;
    fetchAttention: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
    cursor = null;
    silenced = new Set();
    visible = true;
    online = true;
    deps = {
      fetchFeedPage: vi.fn().mockResolvedValue(page(0, 0)),
      fetchFeedHead: vi.fn().mockResolvedValue(42),
      fetchAttention: vi.fn().mockResolvedValue(attention()),
      loadCursor: () => cursor,
      saveCursor: (n) => { cursor = n; },
      silenced: () => silenced,
      isVisible: () => visible,
      isOnline: () => online,
    };
  });
  afterEach(() => { vi.useRealTimers(); });

  const run = async (engine: AlertEngine, ms = 0) => { await vi.advanceTimersByTimeAsync(ms); };

  it('يهيّئ من الرأس لا من التاريخ ثم يجلب الحالة الحالية ولا يمرّر الأحداث القديمة (D-H3-02)', async () => {
    deps.fetchAttention.mockResolvedValue(attention(row('a'), row('b', false)));
    const engine = new AlertEngine(deps);
    engine.start(config());
    await run(engine);

    expect(deps.fetchFeedHead).toHaveBeenCalledTimes(1);
    expect(deps.fetchFeedPage).not.toHaveBeenCalled();
    expect(cursor).toBe(42);
    expect(engine.snapshot.connection).toBe('live');
    // pending بحكم الخادم فقط: b غير pending فلا ينبَّه، لكنه يُحتسب في total.
    expect(engine.snapshot.pending.map((p) => p.orderId)).toEqual(['a']);
    expect(engine.snapshot.total).toBe(2);
    engine.stop();
  });

  it('مؤشّر محفوظ ⇒ يكمل منه، وحدث جديد يستدعي إعادة جلب الحالة، وبلا جديد لا يطلب الحالة قبل موعدها', async () => {
    cursor = 10;
    const engine = new AlertEngine(deps);
    engine.start(config());
    await run(engine); // الدورة الأولى: الحالة تُجلب دائماً عند البدء
    expect(deps.fetchFeedHead).not.toHaveBeenCalled();
    expect(deps.fetchFeedPage).toHaveBeenCalledWith(10);
    expect(deps.fetchAttention).toHaveBeenCalledTimes(1);

    await run(engine, 10_000); // لا أحداث ولا حان موعد المصالحة
    expect(deps.fetchFeedPage).toHaveBeenCalledTimes(2);
    expect(deps.fetchAttention).toHaveBeenCalledTimes(1);

    deps.fetchFeedPage.mockResolvedValueOnce(page(2, 12));
    deps.fetchAttention.mockResolvedValue(attention(row('new')));
    await run(engine, 10_000);
    expect(cursor).toBe(12);
    expect(deps.fetchAttention).toHaveBeenCalledTimes(2);
    expect(engine.snapshot.pending.map((p) => p.orderId)).toEqual(['new']);
    engine.stop();
  });

  it('المصالحة الدورية تلتقط ما فاتته التغذية (حدث مفقود)', async () => {
    cursor = 5;
    const engine = new AlertEngine(deps);
    engine.start(config());
    await run(engine);
    deps.fetchAttention.mockResolvedValue(attention(row('missed')));
    await run(engine, 60_000); // يمرّ موعد attention_ms بلا أي حدث تغذية
    expect(engine.snapshot.pending.map((p) => p.orderId)).toEqual(['missed']);
    engine.stop();
  });

  it('فجوة أطول من الحد ⇒ قفز إلى head_seq مع مصالحة الحالة بدل تمرير التاريخ', async () => {
    cursor = 1;
    deps.fetchFeedPage.mockResolvedValue(page(100, 101, true, 9999));
    const engine = new AlertEngine(deps);
    engine.start(config());
    await run(engine);

    expect(deps.fetchFeedPage).toHaveBeenCalledTimes(MAX_FEED_PAGES);
    expect(cursor).toBe(9999);
    expect(deps.fetchAttention).toHaveBeenCalled();
    engine.stop();
  });

  it('المقيَّد بمخازن (attention_only) لا يستدعي التغذية أبداً (D-H3-01)', async () => {
    const engine = new AlertEngine(deps);
    engine.start(config({ mode: 'attention_only' }));
    await run(engine, 30_000);

    expect(deps.fetchFeedHead).not.toHaveBeenCalled();
    expect(deps.fetchFeedPage).not.toHaveBeenCalled();
    expect(deps.fetchAttention.mock.calls.length).toBeGreaterThanOrEqual(2); // كل 15ث
    expect(engine.snapshot.mode).toBe('attention_only');
    engine.stop();
  });

  it('403 على التغذية ينتقل تلقائياً إلى attention_only', async () => {
    cursor = 3;
    deps.fetchFeedPage.mockRejectedValue(new ApiError(403, 'forbidden', {}));
    deps.fetchAttention.mockResolvedValue(attention(row('z')));
    const engine = new AlertEngine(deps);
    engine.start(config());
    await run(engine);

    expect(engine.snapshot.mode).toBe('attention_only');
    expect(engine.snapshot.pending.map((p) => p.orderId)).toEqual(['z']);
    expect(engine.snapshot.connection).toBe('live');
    engine.stop();
  });

  it('الإخفاق ⇒ degraded وتراجع أُسّي ثم يعود live ويصفّر العدّاد عند النجاح (الاستعادة)', async () => {
    cursor = 1;
    const boom = new ApiError(500, 'x', {});
    deps.fetchFeedPage.mockRejectedValue(boom);
    const engine = new AlertEngine(deps);
    engine.start(config());
    await run(engine);
    expect(engine.snapshot.connection).toBe('degraded');
    expect(engine.snapshot.consecutiveFailures).toBe(1);

    await run(engine, 2_000);
    expect(engine.snapshot.consecutiveFailures).toBe(2);
    await run(engine, 4_000);
    expect(engine.snapshot.consecutiveFailures).toBe(3);

    // عودة الخدمة: النجاح التالي (بعد 8ث) يعيد live ويصفّر.
    deps.fetchFeedPage.mockResolvedValue(page(0, 1));
    deps.fetchAttention.mockResolvedValue(attention(row('back')));
    await run(engine, 8_000);
    expect(engine.snapshot.connection).toBe('live');
    expect(engine.snapshot.consecutiveFailures).toBe(0);
    expect(engine.snapshot.pending.map((p) => p.orderId)).toEqual(['back']);
    engine.stop();
  });

  it('بلا شبكة: offline بلا طلبات، وعند refresh() بعد العودة يصالح فوراً', async () => {
    cursor = 1;
    online = false;
    const engine = new AlertEngine(deps);
    engine.start(config());
    await run(engine);
    expect(engine.snapshot.connection).toBe('offline');
    expect(deps.fetchFeedPage).not.toHaveBeenCalled();

    online = true;
    deps.fetchAttention.mockResolvedValue(attention(row('later')));
    engine.refresh();
    await run(engine);
    expect(engine.snapshot.connection).toBe('live');
    expect(engine.snapshot.pending.map((p) => p.orderId)).toEqual(['later']);
    engine.stop();
  });

  it('التبويب المخفي يبطّئ الوتيرة (أفضل جهد) ويعود للمعتاد عند الظهور', async () => {
    cursor = 1;
    visible = false;
    const engine = new AlertEngine(deps);
    engine.start(config());
    await run(engine);
    const afterFirst = deps.fetchFeedPage.mock.calls.length;
    await run(engine, 30_000); // أقل من 60ث
    expect(deps.fetchFeedPage.mock.calls.length).toBe(afterFirst);
    await run(engine, 30_000);
    expect(deps.fetchFeedPage.mock.calls.length).toBe(afterFirst + 1);

    visible = true;
    engine.refresh();
    await run(engine);
    expect(deps.fetchFeedPage.mock.calls.length).toBe(afterFirst + 2);
    engine.stop();
  });

  it('reproject يستبعد المُسكَت دون أي طلب شبكة، وإسكات جهاز لا يمسّ الصفوف', async () => {
    deps.fetchAttention.mockResolvedValue(attention(row('a'), row('b')));
    const engine = new AlertEngine(deps);
    engine.start(config());
    await run(engine);
    const calls = deps.fetchAttention.mock.calls.length;

    silenced.add('a');
    engine.reproject();
    expect(engine.snapshot.pending.map((p) => p.orderId)).toEqual(['b']);
    expect(engine.snapshot.total).toBe(2);
    expect(deps.fetchAttention.mock.calls.length).toBe(calls);
    engine.stop();
  });

  it('401/404 يوقف المحرّك ولا يعيد المحاولة', async () => {
    cursor = 1;
    deps.fetchFeedPage.mockRejectedValue(new ApiError(401, 'x', {}));
    const engine = new AlertEngine(deps);
    engine.start(config());
    await run(engine);
    const calls = deps.fetchFeedPage.mock.calls.length;
    await run(engine, 120_000);
    expect(deps.fetchFeedPage.mock.calls.length).toBe(calls);
    expect(engine.snapshot.connection).toBe('idle');
  });

  it('لا طلبات متوازية: refresh أثناء دورة جارية يُدمج بدورة تالية واحدة', async () => {
    cursor = 1;
    let resolveFeed: (v: FeedResponse) => void = () => {};
    deps.fetchFeedPage.mockImplementation(() => new Promise<FeedResponse>((r) => { resolveFeed = r; }));
    const engine = new AlertEngine(deps);
    engine.start(config());
    await run(engine);
    engine.refresh();
    engine.refresh();
    await run(engine);
    expect(deps.fetchFeedPage).toHaveBeenCalledTimes(1);
    resolveFeed(page(0, 1));
    deps.fetchFeedPage.mockResolvedValue(page(0, 1));
    await run(engine);
    expect(deps.fetchFeedPage.mock.calls.length).toBeLessThanOrEqual(3);
    engine.stop();
  });

  it('stop يلغي كل شيء ويصفّر اللقطة', async () => {
    deps.fetchAttention.mockResolvedValue(attention(row('a')));
    const engine = new AlertEngine(deps);
    engine.start(config());
    await run(engine);
    engine.stop();
    const calls = deps.fetchAttention.mock.calls.length;
    await run(engine, 300_000);
    expect(deps.fetchAttention.mock.calls.length).toBe(calls);
    expect(engine.snapshot.pending).toEqual([]);
    expect(engine.snapshot.connection).toBe('idle');
  });

  it('isStale: أكثر من 30ث بلا نجاح، ولا تُعدّ idle قديمة', () => {
    const base = { connection: 'live' as const, lastSuccessAt: 1_000, consecutiveFailures: 0, pending: [], total: 0, truncated: false, mode: 'feed_attention' as const };
    expect(isStale(base, 20_000)).toBe(false);
    expect(isStale(base, 40_000)).toBe(true);
    expect(isStale({ ...base, lastSuccessAt: null }, 1)).toBe(true);
    expect(isStale({ ...base, connection: 'idle' }, 999_999)).toBe(false);
  });
});
