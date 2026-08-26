// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PosSoundFeedbackSettings } from './pos-sound-feedback-settings';
import { POS_FEEDBACK_DEFAULTS, type PosFeedbackSettings } from '@/lib/pos-sound';

const { unlock, play } = vi.hoisted(() => ({ unlock: vi.fn(), play: vi.fn() }));

vi.mock('@/lib/pos-sound', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pos-sound')>();
  return { ...actual, posSound: { unlock, play } };
});

const labels: Record<string, string> = {
  sound_feedback: 'Sounds and feedback',
  sound_feedback_hint: 'Visual feedback remains available.',
  sound_enabled: 'Enable POS sounds',
  sound_master_enabled_hint: 'Visual alerts remain active.',
  sound_master_disabled_hint: 'Sounds are off.',
  scan_sound_enabled: 'Barcode scan sound',
  error_sound_enabled: 'Error and warning sounds',
  payment_sound_enabled: 'Payment sounds',
  haptics_enabled: 'Enable vibration when supported',
  sound_volume: 'Volume',
  sound_preview_title: 'Test sounds',
  sound_preview_hint: 'Preview safely.',
  sound_preview_disabled_hint: 'Enable sounds to test.',
  sound_autoplay_hint: 'Browser audio hint.',
  preview_scan_success: 'Test scan success',
  preview_scan_not_found: 'Test barcode not found',
  preview_scan_error: 'Test scan error',
  preview_payment_success: 'Test payment success',
  preview_payment_error: 'Test payment error',
};

function t(key: string) { return labels[key] ?? key; }

function Harness({ hapticsSupported = false }: { hapticsSupported?: boolean }) {
  const [settings, setSettings] = useState<PosFeedbackSettings>(POS_FEEDBACK_DEFAULTS);
  return (
    <PosSoundFeedbackSettings
      settings={settings}
      hapticsSupported={hapticsSupported}
      t={t}
      onChange={(key, value) => setSettings((current) => ({ ...current, [key]: value }))}
    />
  );
}

describe('إعدادات الصوت والتنبيهات في POS', () => {
  afterEach(() => {
    cleanup();
    unlock.mockClear();
    play.mockClear();
  });

  it('يعطّل تحكمات الصوت والمعاينات بوضوح مع بقاء رسالة التنبيه المرئي', () => {
    render(<Harness />);

    fireEvent.click(screen.getByTestId('pos-sound-master-toggle'));

    expect(screen.getByText('Sounds are off.')).not.toBeNull();
    expect((screen.getByTestId('pos-sound-scan-toggle') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('pos-sound-error-toggle') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('pos-sound-payment-toggle') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('pos-sound-volume-slider') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('pos-sound-preview-scan_success') as HTMLButtonElement).disabled).toBe(true);
  });

  it('يطبق slider المستوى الحالي ويشغل المعاينة عبر PosSoundManager الحقيقي', () => {
    render(<Harness />);

    fireEvent.change(screen.getByTestId('pos-sound-volume-slider'), { target: { value: '35' } });
    fireEvent.click(screen.getByTestId('pos-sound-preview-scan_success'));

    expect(screen.getByText('35%')).not.toBeNull();
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledWith('scan_success', expect.objectContaining({ sound_volume: 35 }));
  });

  it('يعرض الاهتزاز فقط عندما يصرّح الجهاز بالدعم', () => {
    const { rerender } = render(<Harness hapticsSupported={false} />);
    expect(screen.queryByTestId('pos-sound-haptics-toggle')).toBeNull();

    rerender(<Harness hapticsSupported />);
    expect(screen.getByTestId('pos-sound-haptics-toggle')).not.toBeNull();
  });
});
