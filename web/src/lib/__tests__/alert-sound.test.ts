import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALERT_SOUND_DEFAULTS,
  ALERT_SOUND_SOURCES,
  AlertSoundEngine,
  type AlertClip,
  type AlertSoundEvent,
} from '@/lib/alert-sound';

class FakeClip implements AlertClip {
  currentTime = 0;
  preload = '';
  volume = 1;
  loadCalls = 0;
  pauseCalls = 0;
  playCalls = 0;
  volumesAtPlay: number[] = [];
  /** يُحقن لمحاكاة سياسة autoplay. */
  rejectWith: { name: string } | null = null;

  load() { this.loadCalls += 1; }
  pause() { this.pauseCalls += 1; }
  play() {
    this.playCalls += 1;
    this.volumesAtPlay.push(this.volume);
    if (this.rejectWith) return Promise.reject(this.rejectWith);
    return Promise.resolve();
  }
}

function setup(options: ConstructorParameters<typeof AlertSoundEngine>[0] = {}) {
  const clip = new FakeClip();
  const created: string[] = [];
  const engine = new AlertSoundEngine({
    createAudio: (src) => { created.push(src); return clip; },
    repeatIntervalMs: 4_000,
    ...options,
  });
  const events: AlertSoundEvent[] = [];
  engine.subscribe((e) => events.push(e));
  return { clip, engine, events, created };
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('محرّك صوت التنبيهات (COPS-H3-2)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('الأصل الصوتي موجود وأحادي 16 بت وأقل من 100KB', () => {
    const asset = join(process.cwd(), 'public', ALERT_SOUND_SOURCES.newOrder.replace(/^\//, ''));
    expect(existsSync(asset)).toBe(true);
    const wav = readFileSync(asset);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.length).toBeLessThan(100_000);
  });

  it('يبدأ مقفلاً ولا ينشئ صوتاً قبل أول استعمال', () => {
    const { engine, created } = setup();
    expect(engine.state).toBe('locked');
    expect(created).toEqual([]);
  });

  it('unlock يشغّل بصوت صفر ثم يوقف ويُسلّح ويستعيد مستوى الصوت', async () => {
    const { engine, clip, events } = setup();
    engine.setVolume(40);
    const state = await engine.unlock();
    expect(state).toBe('armed');
    expect(clip.volumesAtPlay).toEqual([0]);
    expect(clip.pauseCalls).toBeGreaterThan(0);
    expect(clip.volume).toBeCloseTo(0.4);
    expect(events).toEqual([{ type: 'state', state: 'armed' }]);
  });

  it('unlock مرفوضاً (NotAllowedError) يبقى مقفلاً بلا استثناء', async () => {
    const { engine, clip, events } = setup();
    clip.rejectWith = { name: 'NotAllowedError' };
    await expect(engine.unlock()).resolves.toBe('locked');
    expect(events).toEqual([]);
  });

  it('تشغيل مرفوض بعد التسليح يعيد الحالة إلى locked ويُخطر', async () => {
    const { engine, clip, events } = setup();
    await engine.unlock();
    clip.rejectWith = { name: 'NotAllowedError' };
    await expect(engine.playOnce()).resolves.toBe(false);
    expect(engine.state).toBe('locked');
    expect(events.at(-1)).toEqual({ type: 'state', state: 'locked' });
  });

  it('AbortError (قطعه تشغيل آخر) لا يقلب الحالة إلى locked', async () => {
    const { engine, clip } = setup();
    await engine.unlock();
    clip.rejectWith = { name: 'AbortError' };
    await expect(engine.playOnce()).resolves.toBe(false);
    expect(engine.state).toBe('armed');
  });

  it('يكرّر كل فاصل حتى الإيقاف ولا يتراكب بتعدد المفاتيح', async () => {
    const { engine, clip } = setup();
    await engine.unlock();
    clip.playCalls = 0;

    engine.startRepeating('o1');
    engine.startRepeating('o2');
    engine.startRepeating('o1'); // مكرر
    expect(clip.playCalls).toBe(1);
    vi.advanceTimersByTime(4_000);
    expect(clip.playCalls).toBe(2);
    vi.advanceTimersByTime(8_000);
    expect(clip.playCalls).toBe(4);
    expect(engine.activeKeys).toEqual(['o1', 'o2']);
  });

  it('الصوت يستمر ما بقي مفتاح نشط ويتوقف عند آخر إقرار', async () => {
    const { engine, clip } = setup();
    await engine.unlock();
    clip.playCalls = 0;
    engine.startRepeating('o1');
    engine.startRepeating('o2');
    engine.stop('o1');
    vi.advanceTimersByTime(4_000);
    expect(clip.playCalls).toBe(2);
    engine.stop('o2');
    vi.advanceTimersByTime(60_000);
    expect(clip.playCalls).toBe(2);
    expect(engine.activeKeys).toEqual([]);
  });

  it('stopAll يلغي المؤقّت فوراً', async () => {
    const { engine, clip } = setup();
    await engine.unlock();
    clip.playCalls = 0;
    engine.startRepeating('a');
    engine.stopAll();
    vi.advanceTimersByTime(30_000);
    expect(clip.playCalls).toBe(1);
  });

  it('syncActive يضيف المطلوب ويزيل المُقَرّ', async () => {
    const { engine } = setup();
    await engine.unlock();
    engine.syncActive(['a', 'b']);
    expect(engine.activeKeys).toEqual(['a', 'b']);
    engine.syncActive(['b', 'c']);
    expect(engine.activeKeys.sort()).toEqual(['b', 'c']);
    engine.syncActive([]);
    expect(engine.activeKeys).toEqual([]);
  });

  it('يبلغ سقف التكرار فيتوقف ويُخطر exhausted بلا تشغيل إضافي', async () => {
    const { engine, clip, events } = setup({ maxRepeats: 3 });
    await engine.unlock();
    clip.playCalls = 0;
    engine.startRepeating('a');
    for (let i = 0; i < 10; i++) { await vi.advanceTimersByTimeAsync(4_000); }
    expect(clip.playCalls).toBe(3);
    expect(events.at(-1)).toEqual({ type: 'exhausted' });
    expect(engine.activeKeys).toEqual([]);
  });

  it('المفتاح الذي بلغ السقف لا يُعاد تشغيله بمصالحة دورية بلا إقرار', async () => {
    const { engine, clip } = setup({ maxRepeats: 1 });
    await engine.unlock();
    clip.playCalls = 0;
    engine.syncActive(['a']);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(clip.playCalls).toBe(1);
    expect(engine.exhaustedKeys).toEqual(['a']);

    engine.syncActive(['a']); // مصالحة تالية بالمفتاح نفسه ما زال غير مُقَرّ
    engine.startRepeating('a');
    vi.advanceTimersByTime(60_000);
    expect(clip.playCalls).toBe(1);
    expect(engine.activeKeys).toEqual([]);
  });

  it('طلب جديد يبدأ بعد استنفاد قديم، والإقرار/الخروج من المجموعة يصفّران حالة الاستنفاد', async () => {
    const { engine, clip } = setup({ maxRepeats: 1 });
    await engine.unlock();
    engine.syncActive(['a']);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(engine.exhaustedKeys).toEqual(['a']);

    clip.playCalls = 0;
    engine.syncActive(['a', 'b']); // b جديد: يبدأ؛ a يبقى صامتاً
    expect(engine.activeKeys).toEqual(['b']);
    expect(clip.playCalls).toBe(1);

    engine.syncActive(['b']); // a أُقرّ/خرج من attention
    expect(engine.exhaustedKeys).toEqual([]);
    engine.stopAll();
    engine.syncActive(['a']); // طلب جديد بالمعرّف نفسه لاحقاً يُسمع من جديد
    expect(engine.activeKeys).toEqual(['a']);
  });

  it('رفض autoplay لا يستهلك ميزانية التكرار، فيُسمع التنبيه المعلّق بعد نجاح unlock', async () => {
    const { engine, clip } = setup({ maxRepeats: 2 });
    clip.rejectWith = { name: 'NotAllowedError' };
    engine.startRepeating('a');
    for (let i = 0; i < 10; i++) { await vi.advanceTimersByTimeAsync(4_000); }
    expect(engine.exhaustedKeys).toEqual([]);
    expect(engine.activeKeys).toEqual(['a']);
    expect(engine.state).toBe('locked');

    // المستخدم يفعّل الصوت: unlock ينجح، والتكرار القائم يُسمَع في الدورة التالية.
    clip.rejectWith = null;
    await engine.unlock();
    clip.playCalls = 0;
    await vi.advanceTimersByTimeAsync(4_000);
    expect(clip.playCalls).toBe(1);
    expect(clip.volumesAtPlay.at(-1)).toBeGreaterThan(0);
    expect(engine.state).toBe('armed');
  });

  it('اكتمال تشغيل جلسة موقوفة لا يستهلك ميزانية جلسة جديدة', async () => {
    const { engine, clip } = setup({ maxRepeats: 2 });
    await engine.unlock();
    clip.playCalls = 0;
    engine.startRepeating('old');
    engine.stopAll();            // قبل أن يكتمل وعد play() الأول
    engine.startRepeating('new');
    await flush();               // يكتمل تشغيل 'old' الآن
    await vi.advanceTimersByTimeAsync(4_000);
    // 'new' عُزف مرتين فقط حتى الآن ولم يُنهَك سقفه (2) بتشغيل 'old'.
    expect(engine.exhaustedKeys).toEqual([]);
    expect(engine.activeKeys).toEqual(['new']);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(engine.exhaustedKeys).toEqual(['new']);
  });

  it('مفتاح يصل بعد آخر تشغيل مسموح لغيره يحصل على ميزانيته كاملة', async () => {
    const { engine, clip } = setup({ maxRepeats: 1 });
    await engine.unlock();
    clip.playCalls = 0;
    engine.startRepeating('old');
    await flush();                 // قُبل تشغيل 'old' الوحيد المسموح
    engine.startRepeating('new');  // قبل نبضة المؤقّت التالية
    await vi.advanceTimersByTimeAsync(4_000);
    expect(engine.exhaustedKeys).toEqual(['old']);
    expect(engine.activeKeys).toEqual(['new']);
    expect(clip.playCalls).toBe(2); // 'new' سُمع مرة
    await vi.advanceTimersByTimeAsync(4_000);
    expect(engine.exhaustedKeys.sort()).toEqual(['new', 'old']);
    expect(clip.playCalls).toBe(2);
  });

  it('تكرار في حالة locked يحاول ولا يرمي ويبقى المشتركون على علم', async () => {
    const { engine, clip, events } = setup();
    clip.rejectWith = { name: 'NotAllowedError' };
    engine.startRepeating('a');
    await flush();
    expect(engine.state).toBe('locked');
    expect(engine.activeKeys).toEqual(['a']);
    expect(events).toEqual([]); // كان مقفلاً أصلاً: لا تغيّر حالة
  });

  it('مستمع يرمي لا يكسر المحرّك', async () => {
    const { engine } = setup();
    engine.subscribe(() => { throw new Error('boom'); });
    await expect(engine.unlock()).resolves.toBe('armed');
  });

  it('بلا Audio في البيئة: كل شيء صامت', async () => {
    const engine = new AlertSoundEngine({ createAudio: () => null });
    await expect(engine.unlock()).resolves.toBe('locked');
    await expect(engine.playOnce()).resolves.toBe(false);
    engine.startRepeating('a');
    engine.stopAll();
  });

  it('createAudio يرمي ⇒ صامت', async () => {
    const engine = new AlertSoundEngine({ createAudio: () => { throw new Error('x'); } });
    await expect(engine.playOnce()).resolves.toBe(false);
  });

  it('الإعدادات الافتراضية معقولة وفاصل أدنى ثانية', () => {
    expect(ALERT_SOUND_DEFAULTS.repeatIntervalMs).toBeGreaterThanOrEqual(1_000);
    const { engine, clip } = setup({ repeatIntervalMs: 10 });
    void engine.unlock();
    clip.playCalls = 0;
    engine.startRepeating('a');
    vi.advanceTimersByTime(900);
    expect(clip.playCalls).toBe(1); // رُفع الفاصل إلى 1000
  });
});

describe('حارس معماري: مصدرا Audio فقط', () => {
  it('لا `new Audio(` في المصدر خارج pos-sound.ts وalert-sound.ts', () => {
    const root = join(process.cwd(), 'src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx)$/.test(name) || /\.test\./.test(name)) continue;
        if (/\/lib\/(pos-sound|alert-sound)\.ts$/.test(full)) continue;
        if (/new Audio\(/.test(readFileSync(full, 'utf8'))) offenders.push(full);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
