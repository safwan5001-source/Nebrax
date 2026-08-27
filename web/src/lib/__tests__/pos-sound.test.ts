import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { POS_FEEDBACK_DEFAULTS, POS_SOUND_SOURCES, PosSoundManager, type PosFeedbackSettings } from '@/lib/pos-sound';

class FakeAudio {
  currentTime = 0;
  muted = false;
  preload = '';
  volume = 1;
  loadCalls = 0;
  pauseCalls = 0;
  playCalls = 0;

  load() { this.loadCalls += 1; }
  pause() { this.pauseCalls += 1; }
  play() { this.playCalls += 1; return Promise.resolve(); }
}

const enabled: PosFeedbackSettings = { ...POS_FEEDBACK_DEFAULTS, haptics_enabled: false };

describe('مدير صوت POS', () => {
  it('يربط كل حدث بملف صوت مملوك ومعبأ في الواجهة مع عمق ستيريو آمن أحادياً', () => {
    expect(Object.keys(POS_SOUND_SOURCES)).toEqual([
      'scan_success',
      'scan_not_found',
      'scan_error',
      'warning',
      'payment_success',
      'payment_error',
    ]);

    const expectedDurations = {
      scan_success: 104,
      scan_not_found: 194,
      scan_error: 174,
      warning: 176,
      payment_success: 312,
      payment_error: 256,
    } as const;

    for (const [event, source] of Object.entries(POS_SOUND_SOURCES) as Array<[keyof typeof expectedDurations, string]>) {
      const asset = join(process.cwd(), 'public', source.replace(/^\//, ''));
      expect(existsSync(asset)).toBe(true);

      const wav = readFileSync(asset);
      const sampleRate = wav.readUInt32LE(24);
      const channels = wav.readUInt16LE(22);
      const bitsPerSample = wav.readUInt16LE(34);
      const durationMs = (wav.readUInt32LE(40) / (sampleRate * channels * (bitsPerSample / 8))) * 1_000;

      expect(sampleRate).toBe(44_100);
      expect(channels).toBe(2);
      expect(bitsPerSample).toBe(16);
      expect(wav.length).toBeLessThan(60_000);
      expect(durationMs).toBeCloseTo(expectedDurations[event], 0);

      let peak = 0;
      let leftEnergy = 0;
      let rightEnergy = 0;
      let crossEnergy = 0;
      let midEnergy = 0;
      let sideEnergy = 0;
      let hasStereoDetail = false;

      for (let offset = 44; offset < wav.length; offset += 4) {
        const left = wav.readInt16LE(offset) / 32_767;
        const right = wav.readInt16LE(offset + 2) / 32_767;
        const mid = (left + right) / 2;
        const side = (left - right) / 2;

        peak = Math.max(peak, Math.abs(left), Math.abs(right));
        leftEnergy += left ** 2;
        rightEnergy += right ** 2;
        crossEnergy += left * right;
        midEnergy += mid ** 2;
        sideEnergy += side ** 2;
        hasStereoDetail ||= left !== right;
      }

      const correlation = crossEnergy / Math.sqrt(leftEnergy * rightEnergy);
      const sideToMid = Math.sqrt(sideEnergy / midEnergy);

      expect(peak).toBeLessThan(0.6);
      expect(hasStereoDetail).toBe(true);
      expect(correlation).toBeGreaterThan(0.98);
      expect(sideToMid).toBeLessThan(0.1);
    }
  });

  it('لا يشغل الصوت أو الاهتزاز عندما يعطله المستخدم', () => {
    const audio = new FakeAudio();
    const vibrate = vi.fn();
    const manager = new PosSoundManager({ createAudio: () => audio, getNavigator: () => ({ vibrate }) });

    manager.play('scan_success', { ...enabled, sound_enabled: false, haptics_enabled: false });

    expect(audio.playCalls).toBe(0);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('يحترم تعطيل فئات المسح والأخطاء والدفع لكل الأحداث التابعة', () => {
    const createAudio = vi.fn(() => new FakeAudio());
    const manager = new PosSoundManager({ createAudio });

    manager.play('scan_success', { ...enabled, scan_sound_enabled: false });
    manager.play('scan_not_found', { ...enabled, error_sound_enabled: false });
    manager.play('scan_error', { ...enabled, error_sound_enabled: false });
    manager.play('warning', { ...enabled, error_sound_enabled: false });
    manager.play('payment_success', { ...enabled, payment_sound_enabled: false });
    manager.play('payment_error', { ...enabled, payment_sound_enabled: false });

    expect(createAudio).not.toHaveBeenCalled();
  });

  it('يطبق مستوى الصوت من الإعداد قبل كل تشغيل', () => {
    const audio = new FakeAudio();
    const manager = new PosSoundManager({ createAudio: () => audio });

    manager.play('payment_success', { ...enabled, sound_volume: 35 });

    expect(audio.volume).toBe(0.35);
    expect(audio.playCalls).toBe(1);
  });

  it('يطبق مستوى الصوت المحفوظ عبر Web Audio عندما لا يقبل Safari/iPhone خاصية volume', () => {
    const audio = new FakeAudio();
    const sourceConnect = vi.fn();
    const gainConnect = vi.fn();
    const gain = { gain: { value: 1 }, connect: gainConnect };
    const createAudioContext = vi.fn(() => ({
      destination: {},
      createGain: () => gain,
      createMediaElementSource: () => ({ connect: sourceConnect }),
      resume: vi.fn().mockResolvedValue(undefined),
    }));
    const manager = new PosSoundManager({ createAudio: () => audio, createAudioContext });

    manager.play('payment_success', { ...enabled, sound_volume: 35 });

    expect(createAudioContext).toHaveBeenCalledTimes(1);
    expect(sourceConnect).toHaveBeenCalledWith(gain);
    expect(gainConnect).toHaveBeenCalledWith({});
    expect(gain.gain.value).toBe(0.35);
    expect(audio.volume).toBe(1);
    expect(audio.playCalls).toBe(1);
  });

  it('يتجاوز بيئة صوت أو اهتزاز غير مدعومة دون رمي استثناء', () => {
    const manager = new PosSoundManager({ createAudio: () => null, getNavigator: () => undefined });

    expect(() => {
      manager.preload();
      manager.unlock();
      manager.play('scan_error', enabled);
    }).not.toThrow();
  });

  it('يعيد استخدام العنصر نفسه عند المسح السريع ولا ينشئ طابور عناصر صوت', () => {
    const audio = new FakeAudio();
    const createAudio = vi.fn(() => audio);
    const manager = new PosSoundManager({ createAudio });

    for (let index = 0; index < 100; index += 1) {
      manager.play('scan_success', enabled);
    }

    expect(createAudio).toHaveBeenCalledTimes(1);
    expect(audio.playCalls).toBe(100);
    expect(audio.pauseCalls).toBe(100);
    expect(audio.currentTime).toBe(0);
  });
});
