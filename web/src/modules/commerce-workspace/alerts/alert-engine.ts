import { hasApiStatus } from '@/lib/api';
import {
  EMPTY_SNAPSHOT,
  STALE_AFTER_MS,
  type AlertConfig,
  type AlertConnection,
  type AlertItem,
  type AlertMode,
  type AlertSnapshot,
  type AttentionResponse,
  type FeedResponse,
} from './contract';

/**
 * محرّك الاستطلاع والمصالحة (COPS-H3-3، ADR-30 §2). **بلا React ولا DOM**: كل شيء مُحقَن (جلب، مؤقّتات، ساعة، رؤية، اتصال، تخزين المؤشّر) فيُختبر بمؤقّتات وهمية.
 *
 * - **الحقيقة = `attention`** (الخادم يحكم `alert.pending`)؛ التغذية **إشارة تغيّر** رخيصة: حدث جديد ⇒ إعادة جلب `attention`. فقد حدث ⇒ تستدركه المصالحة الدورية.
 * - **غير المقيَّد:** كل `feed_ms` (مرئي) استطلاع التغذية من المؤشّر المحفوظ؛ كل `attention_ms` مصالحة حالة. **المقيَّد بمخازن (D-H3-01):** `attention` وحدها كل `attention_only_ms` (لا تغذية له).
 * - **التهيئة (D-H3-02):** بلا مؤشّر محفوظ ⇒ `head_seq` الحالي (لا تصفح تاريخ) ثم `attention` الحالية. لا تنبيه من الأحداث القديمة.
 * - **الاستعادة:** مؤشّر محفوظ ⇒ يكمل منه؛ فجوة > `MAX_FEED_PAGES` صفحات ⇒ قفز إلى `head_seq` مع مصالحة `attention` (لا تمرير تاريخ طويل). `refresh()` فوري عند العودة للتبويب/الشبكة.
 * - **الأخطاء:** تراجع أُسّي 2ث…30ث (مرئي) / حتى 60ث (مخفي)، وعدّاد إخفاقات؛ 403 على التغذية ⇒ ينتقل إلى `attention_only`؛ 401/404 على الإعداد ⇒ يتوقف. النجاح يصفّر.
 * - **التبويب المخفي:** وتيرة أبطأ (×6 حتى 60ث) — أفضل جهد معلن (ADR-30 §5.2)، لا وعد.
 */

export const MAX_FEED_PAGES = 5;
const BACKOFF_STEPS_MS = [2_000, 4_000, 8_000, 16_000, 30_000];
const HIDDEN_FACTOR = 6;
const HIDDEN_CAP_MS = 60_000;

export interface AlertEngineDeps {
  fetchFeedPage: (afterSeq: number) => Promise<FeedResponse>;
  fetchFeedHead: () => Promise<number>;
  fetchAttention: () => Promise<AttentionResponse>;
  loadCursor: () => number | null;
  saveCursor: (seq: number) => void;
  /** معرّفات الطلبات المُسكَتة محلياً (إقرار الجهاز) — تُستبعد من pending. */
  silenced: () => ReadonlySet<string>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  isVisible?: () => boolean;
  isOnline?: () => boolean;
}

export class AlertEngine {
  private snapshotValue: AlertSnapshot = EMPTY_SNAPSHOT;
  private readonly listeners = new Set<(s: AlertSnapshot) => void>();
  private config: AlertConfig | null = null;
  private mode: AlertMode = 'feed_attention';
  private cursor: number | null = null;
  private lastAttentionAt = 0;
  private lastSuccessAt: number | null = null;
  private failures = 0;
  private timer: unknown = null;
  private running = false;
  /** جيل الدورة الجارية (لا `boolean`): دورة قديمة بعد stop/start لا تحجب دورة الجيل الحالي ولا تتركه بلا مؤقّت. */
  private inFlight: number | null = null;
  private rerun = false;
  private rows: AttentionResponse['data'] = [];
  private truncated = false;
  private generation = 0;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;
  private readonly isVisible: () => boolean;
  private readonly isOnline: () => boolean;

  constructor(private readonly deps: AlertEngineDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.isVisible = deps.isVisible ?? (() => (typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'));
    this.isOnline = deps.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  }

  get snapshot(): AlertSnapshot {
    return this.snapshotValue;
  }

  subscribe(listener: (s: AlertSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(config: AlertConfig): void {
    if (this.running) this.stop();
    this.running = true;
    this.config = config;
    this.mode = config.mode;
    this.cursor = this.mode === 'feed_attention' ? this.deps.loadCursor() : null;
    this.lastAttentionAt = 0;
    this.failures = 0;
    this.generation += 1;
    this.rerun = false;
    this.publish('connecting');
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    this.generation += 1;
    this.cancelTimer();
    this.rerun = false;
    this.snapshotValue = { ...EMPTY_SNAPSHOT };
    this.emit();
  }

  /** مصالحة فورية (عودة للتبويب/الشبكة/تغيّر الإسكات). تُدمج مع دورة جارية بدل أن تتوازى. */
  refresh(): void {
    if (!this.running) return;
    this.failures = 0;
    this.lastAttentionAt = 0; // تُجبر مصالحة الحالة في الدورة التالية
    this.cancelTimer();
    this.schedule(0);
  }

  /** إعادة حساب pending من الصفوف الحالية بعد تغيّر الإسكات المحلي — بلا طلب شبكة. */
  reproject(): void {
    if (!this.running) return;
    this.publish(this.snapshotValue.connection);
  }

  // ───────────────────────── الدورة ─────────────────────────

  private schedule(delay: number): void {
    if (!this.running) return;
    this.cancelTimer();
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.cycle();
    }, delay);
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private async cycle(): Promise<void> {
    if (!this.running || this.config === null) return;
    if (this.inFlight === this.generation) {
      this.rerun = true;
      return;
    }
    if (!this.isOnline()) {
      this.publish('offline');
      this.schedule(this.nextDelay());
      return;
    }

    const generation = this.generation;
    this.inFlight = generation;
    try {
      await this.poll();
      if (generation !== this.generation) return;
      this.failures = 0;
      this.lastSuccessAt = this.now();
      this.publish('live');
    } catch (error) {
      if (generation !== this.generation) return;
      if (hasApiStatus(error, 401) || hasApiStatus(error, 404)) {
        // جلسة منتهية/قدرة معطّلة: لا طرق التفاف؛ نتوقف (api() يتولى توجيه 401).
        this.running = false;
        this.cancelTimer();
        this.snapshotValue = { ...EMPTY_SNAPSHOT };
        this.emit();
        return;
      }
      this.failures += 1;
      this.publish('degraded');
    } finally {
      // لا نمسح علامة جيل أحدث بدأ أثناء طيراننا.
      if (this.inFlight === generation) this.inFlight = null;
    }

    if (!this.running || generation !== this.generation) return;
    const delay = this.rerun ? 0 : this.nextDelay();
    this.rerun = false;
    this.schedule(delay);
  }

  private async poll(): Promise<void> {
    const cfg = this.config as AlertConfig;
    const nowMs = this.now();

    if (this.mode === 'attention_only') {
      await this.reconcileAttention();
      return;
    }

    let changed = false;
    if (this.cursor === null) {
      // تهيئة (D-H3-02): الرأس الحالي لا التاريخ، ثم الحالة الحالية.
      this.cursor = await this.deps.fetchFeedHead();
      this.deps.saveCursor(this.cursor);
      changed = true;
    } else {
      try {
        changed = await this.drainFeed();
      } catch (error) {
        if (hasApiStatus(error, 403)) {
          // المقيَّد بمخازن لا تغذية له (D-H3-01) ⇒ attention وحدها.
          this.mode = 'attention_only';
          await this.reconcileAttention();
          return;
        }
        throw error;
      }
    }

    if (changed || nowMs - this.lastAttentionAt >= cfg.polling.attention_ms) {
      await this.reconcileAttention();
    }
  }

  /** يستهلك أحداث التغذية من المؤشّر؛ يعيد هل وُجد جديد. فجوة طويلة ⇒ قفز إلى الرأس. */
  private async drainFeed(): Promise<boolean> {
    let changed = false;
    for (let page = 0; page < MAX_FEED_PAGES; page += 1) {
      const res = await this.deps.fetchFeedPage(this.cursor as number);
      if (res.data.length > 0) {
        changed = true;
        this.cursor = res.meta.next_after_seq;
        this.deps.saveCursor(this.cursor);
      }
      if (!res.meta.has_more) return changed;
      if (page === MAX_FEED_PAGES - 1) {
        // فجوة طويلة: لا نمرّر التاريخ؛ الحالة هي الحقيقة.
        this.cursor = res.meta.head_seq;
        this.deps.saveCursor(this.cursor);
        return true;
      }
    }

    return changed;
  }

  private async reconcileAttention(): Promise<void> {
    const res = await this.deps.fetchAttention();
    this.rows = Array.isArray(res.data) ? res.data : [];
    this.truncated = Boolean(res.meta?.truncated);
    this.lastAttentionAt = this.now();
  }

  private nextDelay(): number {
    const cfg = this.config as AlertConfig;
    const base = this.mode === 'attention_only' ? cfg.polling.attention_only_ms : cfg.polling.feed_ms;
    if (this.failures > 0) {
      const step = BACKOFF_STEPS_MS[Math.min(this.failures - 1, BACKOFF_STEPS_MS.length - 1)];
      const cap = this.isVisible() ? BACKOFF_STEPS_MS[BACKOFF_STEPS_MS.length - 1] : HIDDEN_CAP_MS;
      return Math.min(Math.max(step, 0), cap);
    }

    return this.isVisible() ? base : Math.min(base * HIDDEN_FACTOR, HIDDEN_CAP_MS);
  }

  // ───────────────────────── اللقطة ─────────────────────────

  private publish(connection: AlertConnection): void {
    const silenced = this.deps.silenced();
    const pending: AlertItem[] = this.rows
      .filter((row) => row.alert?.pending === true && !silenced.has(row.order.id))
      .map((row) => ({
        orderId: row.order.id,
        number: row.order.number,
        createdAt: row.order.created_at,
        reasons: row.reasons,
        deliveryMethod: row.order.delivery_method,
        paymentMethod: row.payment?.method ?? null,
      }));

    this.snapshotValue = {
      connection,
      lastSuccessAt: this.lastSuccessAt,
      consecutiveFailures: this.failures,
      pending,
      total: this.rows.length,
      truncated: this.truncated,
      mode: this.mode,
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(this.snapshotValue);
      } catch {
        // مستمع معطوب لا يكسر الاستطلاع.
      }
    }
  }
}

/** هل اللقطة قديمة (> 30ث بلا نجاح)؟ — ADR-30 §5.1/§5.3. */
export function isStale(snapshot: AlertSnapshot, nowMs: number): boolean {
  if (snapshot.connection === 'idle') return false;

  return snapshot.lastSuccessAt === null || nowMs - snapshot.lastSuccessAt > STALE_AFTER_MS;
}
