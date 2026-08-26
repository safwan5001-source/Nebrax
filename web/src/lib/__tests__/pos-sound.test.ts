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
  it('يربط كل حدث بملف صوت مملوك ومعبأ في الواجهة', () => {
    expect(Object.keys(POS_SOUND_SOURCES)).toEqual([
      'scan_success',
      'scan_not_found',
      'scan_error',
      'warning',
      'payment_success',
      'payment_error',
    ]);

    const expectedDurations = {
      scan_success: 96,
      scan_not_found: 182,
      scan_error: 168,
      warning: 156,
      payment_success: 274,
      payment_error: 236,
    } as const;

    for (const [event, source] of Object.entries(POS_SOUND_SOURCES) as Array<[keyof typeof expectedDurations, string]>) {
      const asset = join(process.cwd(), 'public', source.replace(/^\//, ''));
      expect(existsSync(asset)).toBe(true);

      const wav = readFileSync(asset);
      const sampleRate = wav.readUInt32LE(24);
      const channels = wav.readUInt16LE(22);
      const bitsPerSample = wav.readUInt16LE(34);
      const durationMs = (wav.readUInt32LE(40) / (sampleRate * channels * (bitsPerSample / 8))) * 1_000;

      expect(sampleRate).toBe(22_050);
      expect(channels).toBe(1);
      expect(bitsPerSample).toBe(16);
      expect(wav.length).toBeLessThan(13_000);
      expect(durationMs).toBeCloseTo(expectedDurations[event], 0);
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

  it('يطبق مستوى الصوت من الإعداد قبل كل تشغيل', () => {
    const audio = new FakeAudio();
    const manager = new PosSoundManager({ createAudio: () => audio });

    manager.play('payment_success', { ...enabled, sound_volume: 35 });

    expect(audio.volume).toBe(0.35);
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
