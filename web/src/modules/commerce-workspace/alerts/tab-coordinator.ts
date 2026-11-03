import type { AlertSnapshot } from './contract';

/**
 * تنسيق التبويبات على الجهاز الواحد (COPS-H3-3، ADR-30 §3). **قائد استطلاع واحد** + **حامل صوت** منفصل:
 *
 *  - القائد = حامل القفل الحصري (Web Locks؛ سقوط إلى عقد إيجار `localStorage`). يستطلع وحده ويبثّ اللقطة.
 *  - حامل الصوت = التبويب **المرئي والمُسلَّح** (عند التعدد: الأحدث تفاعلاً) — قد لا يكون القائد. يحسبه الجميع من نبضات الحضور نفسها فلا صوتان معاً.
 *  - **تنازل طوعي:** قائد مخفي أو غير مُسلَّح يحرّر القفل ما دام يوجد نظير مرئي ومُسلَّح، فيتولاه (طابور القفل FIFO) وتتبع وتيرة الاستطلاع التبويبَ المرئي.
 *  - إغلاق/انهيار القائد يحرّر القفل (المتصفح) فيتولى أول منتظر. ما لم يُتحقق منه: سلوك كل متصفح عند الانهيار (يُختبر يدوياً — ADR-30 §3).
 *
 * كل التبعيات مُحقنة (أقفال، قناة، ساعة، مؤقّتات) فيُختبر بقفل وقناة وهميين مشتركين بين عدة منسّقين.
 */

export interface LockManagerLike {
  request(name: string, options: { mode: 'exclusive'; signal?: AbortSignal }, callback: () => Promise<void>): Promise<void>;
}

export interface ChannelLike {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  close(): void;
}

export interface PresenceState {
  visible: boolean;
  armed: boolean;
  /** آخر تفاعل مستخدم (ms epoch) — لكسر التعادل عند تعدد المؤهلين. */
  interactedAt: number;
}

export type TabRole = 'leader' | 'follower';

type Message =
  | { type: 'presence'; id: string; state: PresenceState; ts: number }
  | { type: 'snapshot'; id: string; snapshot: AlertSnapshot }
  | { type: 'silence'; id: string; ids: string[] }
  | { type: 'hello'; id: string };

const PRESENCE_EVERY_MS = 3_000;
const PRESENCE_TTL_MS = 10_000;
/** مهلة قبل إعادة طلب القفل بعد تنازل طوعي: > فاصل استطلاع عقد الإيجار (2ث) كي يتولاه النظير المؤهل بدل أن يعيد التبويب نفسه الإمساك به فوراً. */
const YIELD_BACKOFF_MS = 4_000;

export interface TabCoordinatorOptions {
  scope: string;
  tabId: string;
  locks: LockManagerLike | null;
  createChannel: (name: string) => ChannelLike | null;
  getPresence: () => PresenceState;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
}

export class TabCoordinator {
  private role: TabRole = 'follower';
  private started = false;
  private channel: ChannelLike | null = null;
  private abort: AbortController | null = null;
  private releaseLock: (() => void) | null = null;
  private yielded = false;
  private ticker: unknown = null;
  private readonly peers = new Map<string, { state: PresenceState; ts: number }>();
  private lastSnapshot: AlertSnapshot | null = null;
  private readonly roleListeners = new Set<(role: TabRole) => void>();
  private readonly snapshotListeners = new Set<(s: AlertSnapshot) => void>();
  private readonly silenceListeners = new Set<(ids: string[]) => void>();
  private readonly ownerListeners = new Set<(isOwner: boolean) => void>();
  private ownerCache = false;
  private readonly now: () => number;
  private readonly setIntervalFn: (fn: () => void, ms: number) => unknown;
  private readonly clearIntervalFn: (h: unknown) => void;

  constructor(private readonly opts: TabCoordinatorOptions) {
    this.now = opts.now ?? (() => Date.now());
    this.setIntervalFn = opts.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this.clearIntervalFn = opts.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  }

  get currentRole(): TabRole {
    return this.role;
  }

  get lastKnownSnapshot(): AlertSnapshot | null {
    return this.lastSnapshot;
  }

  onRole(cb: (role: TabRole) => void): () => void {
    this.roleListeners.add(cb);
    return () => this.roleListeners.delete(cb);
  }

  onSnapshot(cb: (s: AlertSnapshot) => void): () => void {
    this.snapshotListeners.add(cb);
    return () => this.snapshotListeners.delete(cb);
  }

  onSilence(cb: (ids: string[]) => void): () => void {
    this.silenceListeners.add(cb);
    return () => this.silenceListeners.delete(cb);
  }

  onSoundOwner(cb: (isOwner: boolean) => void): () => void {
    this.ownerListeners.add(cb);
    return () => this.ownerListeners.delete(cb);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.channel = this.opts.createChannel(`awj-commerce-alerts:${this.opts.scope}`);
    if (this.channel) {
      this.channel.onmessage = (event) => this.receive(event.data as Message);
    }
    this.ticker = this.setIntervalFn(() => this.beat(), PRESENCE_EVERY_MS);
    this.post({ type: 'hello', id: this.opts.tabId });
    this.beat();
    void this.acquireLoop();
  }

  stop(): void {
    this.started = false;
    if (this.ticker !== null) this.clearIntervalFn(this.ticker);
    this.ticker = null;
    this.abort?.abort();
    this.releaseLock?.();
    this.releaseLock = null;
    if (this.channel) {
      this.channel.onmessage = null;
      this.channel.close();
    }
    this.channel = null;
    this.peers.clear();
    this.setRole('follower');
  }

  /** يُستدعى عند تغيّر الحضور المحلي (رؤية/تسليح/تفاعل). */
  presenceChanged(): void {
    this.beat();
  }

  publishSnapshot(snapshot: AlertSnapshot): void {
    this.lastSnapshot = snapshot;
    if (this.role === 'leader') this.post({ type: 'snapshot', id: this.opts.tabId, snapshot });
  }

  broadcastSilence(ids: string[]): void {
    this.post({ type: 'silence', id: this.opts.tabId, ids });
  }

  /** هل هذا التبويب حامل الصوت الآن؟ (يحسبه كل تبويب بالقاعدة نفسها من الحضور). */
  isSoundOwner(): boolean {
    const me = { id: this.opts.tabId, state: this.opts.getPresence() };
    const nowMs = this.now();
    const fresh = [...this.peers.entries()].filter(([, p]) => nowMs - p.ts <= PRESENCE_TTL_MS).map(([id, p]) => ({ id, state: p.state }));
    const eligible = [me, ...fresh].filter((c) => c.state.visible && c.state.armed);
    if (eligible.length === 0) return false;
    eligible.sort((a, b) => b.state.interactedAt - a.state.interactedAt || (a.id < b.id ? -1 : 1));

    return eligible[0].id === this.opts.tabId;
  }

  // ───────────────────────── داخلي ─────────────────────────

  private async acquireLoop(): Promise<void> {
    const locks = this.opts.locks;
    if (!locks) {
      // لا أقفال ولا إيجار: كل تبويب قائد نفسه (أضعف عزل — يُعلن؛ الأجهزة المتعددة تتضاعف طلباتها).
      this.setRole('leader');
      return;
    }
    while (this.started) {
      this.abort = new AbortController();
      try {
        await locks.request(`awj-commerce-alerts:${this.opts.scope}`, { mode: 'exclusive', signal: this.abort.signal }, () => new Promise<void>((resolve) => {
          this.releaseLock = resolve;
          this.setRole('leader');
          this.evaluateYield();
        }));
      } catch {
        // AbortError عند الإيقاف؛ غيره نكمل الحلقة بمحاولة جديدة بعد توقف قصير لا يدور بسرعة.
        if (!this.started) break;
        await new Promise((r) => setTimeout(r, 1_000));
      }
      this.releaseLock = null;
      this.setRole('follower');
      if (this.yielded) {
        // تنازل طوعي: لا نعيد الطلب فوراً (عقد الإيجار يمنح الحرّ متزامناً بلا طابور FIFO فيُعيد المتنازل نفسه الإمساك في حلقة مجهرية).
        this.yielded = false;
        await new Promise<void>((resolve) => setTimeout(resolve, YIELD_BACKOFF_MS));
      }
    }
  }

  private beat(): void {
    this.post({ type: 'presence', id: this.opts.tabId, state: this.opts.getPresence(), ts: this.now() });
    this.refreshOwner();
    this.evaluateYield();
  }

  private evaluateYield(): void {
    if (this.role !== 'leader' || this.releaseLock === null) return;
    const mine = this.opts.getPresence();
    if (mine.visible && mine.armed) return;
    const nowMs = this.now();
    const better = [...this.peers.values()].some((p) => nowMs - p.ts <= PRESENCE_TTL_MS && p.state.visible && p.state.armed);
    if (better) {
      const release = this.releaseLock;
      this.releaseLock = null;
      this.yielded = true;
      release();
    }
  }

  private receive(message: Message): void {
    if (!message || typeof message !== 'object' || message.id === this.opts.tabId) return;
    switch (message.type) {
      case 'presence':
        this.peers.set(message.id, { state: message.state, ts: this.now() });
        this.refreshOwner();
        this.evaluateYield();
        break;
      case 'snapshot':
        this.lastSnapshot = message.snapshot;
        if (this.role === 'follower') for (const cb of [...this.snapshotListeners]) cb(message.snapshot);
        break;
      case 'silence':
        for (const cb of [...this.silenceListeners]) cb(message.ids);
        break;
      case 'hello':
        this.post({ type: 'presence', id: this.opts.tabId, state: this.opts.getPresence(), ts: this.now() });
        if (this.role === 'leader' && this.lastSnapshot) this.post({ type: 'snapshot', id: this.opts.tabId, snapshot: this.lastSnapshot });
        break;
    }
  }

  private refreshOwner(): void {
    const owner = this.isSoundOwner();
    if (owner !== this.ownerCache) {
      this.ownerCache = owner;
      for (const cb of [...this.ownerListeners]) cb(owner);
    }
  }

  private setRole(role: TabRole): void {
    if (this.role === role) return;
    this.role = role;
    for (const cb of [...this.roleListeners]) cb(role);
  }

  private post(message: Message): void {
    try {
      this.channel?.postMessage(message);
    } catch {
      // القناة المغلقة/غير القابلة للنسخ لا تكسر التنسيق.
    }
  }
}
