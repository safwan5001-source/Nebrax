// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import PosSoundFeedbackSettingsPage from './page';

const { api, success } = vi.hoisted(() => ({ api: vi.fn(), success: vi.fn() }));

const strings: Record<string, string> = {
  back_to_settings: 'Back to POS settings',
  sound_feedback: 'Sounds and feedback',
  sound_settings_subtitle: 'Configure all feedback preferences.',
  load_failed: 'Could not load settings.',
  updated: 'Updated',
  save: 'Save',
  saveFailed: 'Could not save.',
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

const translate = (key: string) => strings[key] ?? key;

vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success, error: vi.fn() }) }));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));

describe('صفحة إعدادات الأصوات المستقلة في POS', () => {
  afterEach(() => {
    cleanup();
    api.mockReset();
    success.mockReset();
  });

  it('تقرأ وتحفظ subset الصوت عبر sales-config/pos نفسه من دون إرسال إعدادات checkout أو الكتالوج', async () => {
    const initial = {
      sound_enabled: true,
      scan_sound_enabled: true,
      error_sound_enabled: true,
      payment_sound_enabled: true,
      sound_volume: 60,
      haptics_enabled: true,
    };
    api.mockResolvedValueOnce({ data: initial });
    api.mockResolvedValueOnce({ data: initial });
    api.mockResolvedValueOnce({ data: { ...initial, sound_volume: 35 } });

    render(<PosSoundFeedbackSettingsPage />);

    await waitFor(() => expect(screen.getByTestId('pos-sound-volume-slider')).not.toBeNull());
    fireEvent.change(screen.getByTestId('pos-sound-volume-slider'), { target: { value: '35' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api).toHaveBeenNthCalledWith(2, '/sales-config/pos', {
      method: 'PUT',
      body: {
        data: expect.objectContaining({
          sound_enabled: true,
          scan_sound_enabled: true,
          error_sound_enabled: true,
          payment_sound_enabled: true,
          sound_volume: 35,
          haptics_enabled: true,
        }),
      },
    }));

    const saved = api.mock.calls[1][1].body.data;
    expect(saved).not.toHaveProperty('default_customer');
    expect(saved).not.toHaveProperty('payment_methods_mode');
    expect(success).toHaveBeenCalledWith('Updated');
  });
});
