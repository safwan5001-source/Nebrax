import { describe, expect, it, vi } from 'vitest';
import { POS_FEEDBACK_DEFAULTS, PosSoundManager, type PosFeedbackSettings } from '@/lib/pos-sound';

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
