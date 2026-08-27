export type PosSoundEvent =
  | 'scan_success'
  | 'scan_not_found'
  | 'scan_error'
  | 'warning'
  | 'payment_success'
  | 'payment_error';

/** إعدادات feedback المخزنة ضمن sales-config/pos. */
export interface PosFeedbackSettings {
  sound_enabled: boolean;
  scan_sound_enabled: boolean;
  error_sound_enabled: boolean;
  payment_sound_enabled: boolean;
  sound_volume: number;
  haptics_enabled: boolean;
}

export const POS_FEEDBACK_DEFAULTS: PosFeedbackSettings = {
  sound_enabled: true,
  scan_sound_enabled: true,
  error_sound_enabled: true,
  payment_sound_enabled: true,
  sound_volume: 60,
  haptics_enabled: true,
};

interface PosAudioClip {
  currentTime: number;
  muted: boolean;
  preload: string;
  volume: number;
  load?: () => void;
  pause: () => void;
  play: () => Promise<void> | void;
}

interface VibrateNavigator {
  vibrate?: (pattern: number | number[]) => boolean;
}

/** واجهة Web Audio صغيرة قابلة للاختبار؛ لا تغيّر عقد تشغيل HTMLAudio القائم. */
interface PosGainNode {
  gain: { value: number };
  connect: (destination: unknown) => unknown;
}

interface PosMediaElementSourceNode {
  connect: (destination: PosGainNode) => unknown;
}

interface PosAudioContext {
  readonly destination: unknown;
  createGain: () => PosGainNode;
  createMediaElementSource: (clip: PosAudioClip) => PosMediaElementSourceNode;
  resume?: () => Promise<void>;
}

interface PosSoundManagerOptions {
  createAudio?: (source: string) => PosAudioClip | null;
  createAudioContext?: () => PosAudioContext | null;
  getNavigator?: () => VibrateNavigator | undefined;
}

export const POS_SOUND_SOURCES: Readonly<Record<PosSoundEvent, string>> = {
  scan_success: '/sounds/pos/scan-success.wav',
  scan_not_found: '/sounds/pos/scan-not-found.wav',
  scan_error: '/sounds/pos/scan-error.wav',
  warning: '/sounds/pos/warning.wav',
  payment_success: '/sounds/pos/payment-success.wav',
  payment_error: '/sounds/pos/payment-error.wav',
};

const HAPTIC_PATTERNS: Record<PosSoundEvent, number | number[]> = {
  scan_success: 10,
  scan_not_found: [12, 36, 12],
  scan_error: [18, 32, 18],
  warning: [12, 36, 12],
  payment_success: [10, 34, 20],
  payment_error: [18, 36, 18],
};

function isSoundEnabledForEvent(event: PosSoundEvent, settings: PosFeedbackSettings): boolean {
  if (!settings.sound_enabled) return false;

  switch (event) {
    case 'scan_success':
      return settings.scan_sound_enabled;
    case 'scan_not_found':
    case 'scan_error':
    case 'warning':
      return settings.error_sound_enabled;
    case 'payment_success':
    case 'payment_error':
      return settings.payment_sound_enabled;
  }
}

function normalizeVolume(volume: number): number {
  if (!Number.isFinite(volume)) return POS_FEEDBACK_DEFAULTS.sound_volume / 100;

  return Math.max(0, Math.min(100, volume)) / 100;
}

function browserAudioFactory(source: string): PosAudioClip | null {
  if (typeof Audio === 'undefined') return null;

  return new Audio(source);
}

function browserNavigator(): VibrateNavigator | undefined {
  if (typeof navigator === 'undefined') return undefined;

  return navigator;
}

function browserAudioContextFactory(): PosAudioContext | null {
  if (typeof window === 'undefined') return null;

  try {
    const browserWindow = window as typeof window & { webkitAudioContext?: typeof AudioContext };
    const AudioContextConstructor = browserWindow.AudioContext ?? browserWindow.webkitAudioContext;
    return AudioContextConstructor ? new AudioContextConstructor() as unknown as PosAudioContext : null;
  } catch {
    return null;
  }
}

/**
 * طبقة POS مركزية خفيفة: تعيد استخدام عناصر الصوت، وتعيد الصوت إلى بدايته بدلاً
 * من إنشاء طابور جديد مع كل قراءة باركود. كل فشل في المتصفح أو الجهاز صامت ولا
 * يغيّر تدفق البيع.
 */
export class PosSoundManager {
  private readonly clips = new Map<PosSoundEvent, PosAudioClip>();
  private readonly gainNodes = new Map<PosSoundEvent, PosGainNode>();
  private audioContext: PosAudioContext | null | undefined;
  private playbackGeneration = 0;
  private readonly createAudio: (source: string) => PosAudioClip | null;
  private readonly createAudioContext: () => PosAudioContext | null;
  private readonly getNavigator: () => VibrateNavigator | undefined;

  constructor(options: PosSoundManagerOptions = {}) {
    this.createAudio = options.createAudio ?? browserAudioFactory;
    this.createAudioContext = options.createAudioContext ?? browserAudioContextFactory;
    this.getNavigator = options.getNavigator ?? browserNavigator;
  }

  /** تحميل العناصر محلياً مرة واحدة بعد دخول صفحة POS، من دون تشغيلها. */
  preload(): void {
    for (const event of Object.keys(POS_SOUND_SOURCES) as PosSoundEvent[]) {
      const clip = this.clipFor(event);
      try {
        clip?.load?.();
      } catch {
        // فشل التحميل لا يوقف الكاشير ولا يتطلب تنبيهاً تقنياً.
      }
    }
  }

  /**
   * محاولة صامتة لفك قيد autoplay من تفاعل موثوق. لا نعتمد على نجاحها؛ play()
   * اللاحق يظل محمياً بفشل آمن في Safari وiOS والمتصفحات المقيدة.
   */
  unlock(): void {
    const clip = this.clipFor('scan_success');
    if (!clip) return;

    try {
      const gain = this.gainFor('scan_success', clip);
      if (gain) gain.gain.value = 0;
      void this.audioContext?.resume?.().catch(() => {});

      const previousVolume = clip.volume;
      const playbackGeneration = this.playbackGeneration;
      clip.volume = 0;
      void Promise.resolve(clip.play())
        .then(() => {
          if (this.playbackGeneration !== playbackGeneration) return;
          clip.pause();
          clip.currentTime = 0;
          if (gain) gain.gain.value = 1;
          clip.volume = previousVolume;
        })
        .catch(() => {
          if (this.playbackGeneration === playbackGeneration) {
            if (gain) gain.gain.value = 1;
            clip.volume = previousVolume;
          }
        });
    } catch {
      // المتصفح غير الداعم أو autoplay الممنوع لا يؤثر في بقية POS.
    }
  }

  play(event: PosSoundEvent, settings: PosFeedbackSettings): void {
    if (isSoundEnabledForEvent(event, settings)) {
      this.playClip(event, settings.sound_volume);
    }

    if (settings.haptics_enabled) {
      this.vibrate(event);
    }
  }

  private playClip(event: PosSoundEvent, volume: number): void {
    const clip = this.clipFor(event);
    if (!clip) return;

    try {
      // لا ننتظر صوتاً سابقاً ولا ننشئ عنصراً جديداً: آخر حدث هو الذي يُسمع.
      this.playbackGeneration += 1;
      clip.pause();
      clip.currentTime = 0;
      const normalizedVolume = normalizeVolume(volume);
      const gain = this.gainFor(event, clip);
      if (gain) {
        // Safari على iPhone يتجاهل HTMLMediaElement.volume؛ GainNode يبقي
        // مستوى صوت POS قابلاً للتحكم مع بقاء عنصر الصوت نفسه ومساراته.
        gain.gain.value = normalizedVolume;
        clip.volume = 1;
      } else {
        clip.volume = normalizedVolume;
      }
      void Promise.resolve(clip.play()).catch(() => {});
    } catch {
      // الصوت مكمل فقط؛ لا نرمي استثناءً ولا نقطع تدفق البيع.
    }
  }

  private gainFor(event: PosSoundEvent, clip: PosAudioClip): PosGainNode | null {
    const existing = this.gainNodes.get(event);
    if (existing) return existing;

    const context = this.contextFor();
    if (!context) return null;

    try {
      const source = context.createMediaElementSource(clip);
      const gain = context.createGain();
      source.connect(gain);
      gain.connect(context.destination);
      this.gainNodes.set(event, gain);
      return gain;
    } catch {
      // بعض البيئات تمنع ربط عنصر HTMLAudio بالسياق؛ نعود إلى volume القائم.
      return null;
    }
  }

  private vibrate(event: PosSoundEvent): void {
    try {
      this.getNavigator()?.vibrate?.(HAPTIC_PATTERNS[event]);
    } catch {
      // الاهتزاز اختياري وقد يمنعه الجهاز أو المتصفح.
    }
  }

  private contextFor(): PosAudioContext | null {
    if (this.audioContext === undefined) this.audioContext = this.createAudioContext();
    return this.audioContext;
  }

  private clipFor(event: PosSoundEvent): PosAudioClip | null {
    const existing = this.clips.get(event);
    if (existing) return existing;

    try {
      const clip = this.createAudio(POS_SOUND_SOURCES[event]);
      if (!clip) return null;
      clip.preload = 'auto';
      this.clips.set(event, clip);
      return clip;
    } catch {
      return null;
    }
  }
}

/** مثيل واحد لتطبيق POS؛ لا توجد Audio objects موزعة في المكوّنات. */
export const posSound = new PosSoundManager();

export function supportsPosHaptics(): boolean {
  try {
    return typeof browserNavigator()?.vibrate === 'function';
  } catch {
    return false;
  }
}
