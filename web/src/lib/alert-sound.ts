/**
 * محرّك صوت التنبيهات المتكرر (COPS-H3-2) — مستقل عن `pos-sound.ts` عمداً.
 *
 * POS يبقى بلا أي تغيير سلوكي (مدير فوري لأحداث قصيرة). هذا المحرّك للتنبيهات التي
 * تحتاج انتباهاً: **تكرار حتى الإقرار الصريح**، وحالة تسليح (`armed`/`locked`) لأن
 * سياسة autoplay تمنع الصوت المسموع المبادَر برمجياً قبل تفاعل المستخدم
 * (MDN Autoplay guide؛ WebKit: play() يجب أن يكون نتيجة مباشرة لـclick/touchend/keydown).
 *
 * قواعد:
 *  - **صوت واحد في أي لحظة**: عدّة مفاتيح نشطة (طلبات متعددة) تتشارك مؤقّتاً واحداً فلا تتراكب الأصوات.
 *  - **لا ادعاء تسليم**: رفض المتصفح (`NotAllowedError`) ⇒ الحالة `locked` ويُخطَر المشتركون ليعرضوا شريط «تفعيل الصوت».
 *  - **سقف تكرار** (`maxRepeats`) كي لا يدوم صوت إلى ما لا نهاية إن لم يُقرّ أحد؛ بلوغه يُخطِر (`exhausted`)
 *    ويبقى التنبيه المرئي (مسؤولية المستهلك).
 *  - كل فشل في المتصفح صامت ولا يرمي.
 *
 * على iOS يتجاهل Safari `HTMLMediaElement.volume`؛ التنبيه هناك بأعلى مستوى للجهاز (حدّ معلن، لا نلتفّ عليه بـWeb Audio).
 */

export type AlertSoundState = 'locked' | 'armed';

export interface AlertClip {
  currentTime: number;
  preload: string;
  volume: number;
  load?: () => void;
  pause: () => void;
  play: () => Promise<void> | void;
}

export interface AlertSoundEngineOptions {
  /** مصدر الملف الافتراضي. */
  source?: string;
  /** فاصل التكرار بالمللي ثانية (≥ 1000). */
  repeatIntervalMs?: number;
  /** أقصى عدد مرات تشغيل متتالية من دون إقرار (≥ 1). */
  maxRepeats?: number;
  /** حقن للاختبار. */
  createAudio?: (source: string) => AlertClip | null;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export type AlertSoundEvent =
  | { type: 'state'; state: AlertSoundState }
  | { type: 'exhausted' };

export const ALERT_SOUND_SOURCES = {
  newOrder: '/sounds/commerce/new-order.wav',
} as const;

export const ALERT_SOUND_DEFAULTS = {
  source: ALERT_SOUND_SOURCES.newOrder,
  repeatIntervalMs: 4_000,
  maxRepeats: 60,
} as const;

function browserAudioFactory(source: string): AlertClip | null {
  if (typeof Audio === 'undefined') return null;
  return new Audio(source);
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 1;
  return Math.max(0, Math.min(100, volume)) / 100;
}

export class AlertSoundEngine {
  private clip: AlertClip | null | undefined;
  private stateValue: AlertSoundState = 'locked';
  private volume = 1;
  private readonly active = new Set<string>();
  /**
   * مفاتيح بلغت سقف التكرار دون إقرار. تبقى هنا حتى `stop(key)` أو خروجها من المجموعة المرغوبة
   * في `syncActive`، كي لا تُعيد المصالحة الدورية للمفاتيح نفسها تشغيل صوت مقيَّد بالسقف.
   */
  private readonly exhausted = new Set<string>();
  private timer: unknown = null;
  private repeats = 0;
  private generation = 0;
  private readonly listeners = new Set<(event: AlertSoundEvent) => void>();
  private readonly source: string;
  private readonly repeatIntervalMs: number;
  private readonly maxRepeats: number;
  private readonly createAudio: (source: string) => AlertClip | null;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(options: AlertSoundEngineOptions = {}) {
    this.source = options.source ?? ALERT_SOUND_DEFAULTS.source;
    this.repeatIntervalMs = Math.max(1_000, options.repeatIntervalMs ?? ALERT_SOUND_DEFAULTS.repeatIntervalMs);
    this.maxRepeats = Math.max(1, Math.floor(options.maxRepeats ?? ALERT_SOUND_DEFAULTS.maxRepeats));
    this.createAudio = options.createAudio ?? browserAudioFactory;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  get state(): AlertSoundState {
    return this.stateValue;
  }

  /** مفاتيح أُنهي تكرارها بالسقف ولم تُقَرّ بعد (نسخة). */
  get exhaustedKeys(): string[] {
    return [...this.exhausted];
  }

  /** المفاتيح النشطة حالياً (نسخة). */
  get activeKeys(): string[] {
    return [...this.active];
  }

  subscribe(listener: (event: AlertSoundEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setVolume(volume: number): void {
    this.volume = clampVolume(volume);
    if (this.clip) this.clip.volume = this.volume;
  }

  /**
   * يجب أن يُستدعى **متزامناً داخل معالج نقر/لمس/مفتاح** (WebKit: play() نتيجة مباشرة لإيماءة).
   * يشغّل الملف بصوت صفر ثم يوقفه؛ النجاح ⇒ `armed`، الرفض ⇒ يبقى `locked`.
   */
  unlock(): Promise<AlertSoundState> {
    const clip = this.clipFor();
    if (!clip) return Promise.resolve(this.stateValue);

    const generation = ++this.generation;
    try {
      clip.volume = 0;
      return Promise.resolve(clip.play())
        .then(() => {
          // تشغيل فعلي (تنبيه) بدأ بعد هذا الفتح ⇒ لا نقطع صوته.
          if (this.generation === generation) {
            clip.pause();
            clip.currentTime = 0;
          }
          clip.volume = this.volume;
          this.setState('armed');
          return this.stateValue;
        })
        .catch((error: unknown) => {
          clip.volume = this.volume;
          // تشغيل آخر قطع هذا الفتح (AbortError) ليس رفض سياسة؛ لا نقلب الحالة.
          if (this.generation === generation) this.markRejected(error);
          return this.stateValue;
        });
    } catch {
      clip.volume = this.volume;
      return Promise.resolve(this.stateValue);
    }
  }

  /** تشغيل مرة واحدة (اختبار التنبيه). يعيد هل قبل المتصفح التشغيل. */
  async playOnce(): Promise<boolean> {
    return this.playClip();
  }

  /** يبدأ/يُبقي تكراراً لهذا المفتاح حتى `stop(key)`/`stopAll()`. المفتاح المكرر لا يضاعف الصوت. */
  startRepeating(key: string): void {
    if (this.active.has(key) || this.exhausted.has(key)) return;
    const wasIdle = this.active.size === 0;
    this.active.add(key);
    if (!wasIdle) return;

    this.repeats = 0;
    this.tick();
  }

  stop(key: string): void {
    this.exhausted.delete(key);
    if (!this.active.delete(key)) return;
    if (this.active.size === 0) this.halt();
  }

  stopAll(): void {
    this.active.clear();
    this.exhausted.clear();
    this.halt();
  }

  /** مزامنة مجموعة النشطة مع مجموعة مرغوبة (الدمج Feed ∪ Attention ينتهي هنا). */
  syncActive(keys: Iterable<string>): void {
    const wanted = new Set(keys);
    for (const key of [...this.active, ...this.exhausted]) {
      if (!wanted.has(key)) this.stop(key);
    }
    for (const key of wanted) this.startRepeating(key);
  }

  private tick = (): void => {
    this.timer = null;
    if (this.active.size === 0) return;

    if (this.repeats >= this.maxRepeats) {
      for (const key of this.active) this.exhausted.add(key);
      this.active.clear();
      this.emit({ type: 'exhausted' });
      return;
    }

    this.repeats += 1;
    void this.playClip();
    this.timer = this.setTimer(this.tick, this.repeatIntervalMs);
  };

  private halt(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    this.repeats = 0;
    try {
      this.clip?.pause();
      if (this.clip) this.clip.currentTime = 0;
    } catch {
      // الإيقاف لا يرمي.
    }
  }

  private async playClip(): Promise<boolean> {
    const clip = this.clipFor();
    if (!clip) return false;

    try {
      this.generation += 1;
      clip.pause();
      clip.currentTime = 0;
      clip.volume = this.volume;
      await Promise.resolve(clip.play());
      this.setState('armed');
      return true;
    } catch (error) {
      // لا نفترض أن الصوت وصل. وحده NotAllowedError يعني أن السياسة تمنعه (⇒ locked).
      this.markRejected(error);
      return false;
    }
  }

  private markRejected(error: unknown): void {
    const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
    if (name === 'NotAllowedError') this.setState('locked');
  }

  private clipFor(): AlertClip | null {
    if (this.clip !== undefined) return this.clip;
    try {
      const clip = this.createAudio(this.source);
      if (clip) {
        clip.preload = 'auto';
        clip.volume = this.volume;
        try {
          clip.load?.();
        } catch {
          // فشل التحميل المسبق لا يمنع المحاولة لاحقاً.
        }
      }
      this.clip = clip;
    } catch {
      this.clip = null;
    }
    return this.clip;
  }

  private setState(state: AlertSoundState): void {
    if (this.stateValue === state) return;
    this.stateValue = state;
    this.emit({ type: 'state', state });
  }

  private emit(event: AlertSoundEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // مستمع معطوب لا يكسر الصوت.
      }
    }
  }
}

/** مثيل واحد لمساحة التجارة؛ لا كائنات Audio موزعة في المكوّنات. */
export const alertSound = new AlertSoundEngine();
