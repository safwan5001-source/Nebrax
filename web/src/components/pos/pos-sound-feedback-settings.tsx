'use client';

import { Play, Vibrate, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { posSound, type PosFeedbackSettings, type PosSoundEvent } from '@/lib/pos-sound';

type Translator = (key: string) => string;

interface PosSoundFeedbackSettingsProps {
  settings: PosFeedbackSettings;
  onChange: <Key extends keyof PosFeedbackSettings>(key: Key, value: PosFeedbackSettings[Key]) => void;
  hapticsSupported: boolean;
  t: Translator;
}

const PREVIEW_EVENTS: ReadonlyArray<readonly [PosSoundEvent, string]> = [
  ['scan_success', 'preview_scan_success'],
  ['scan_not_found', 'preview_scan_not_found'],
  ['scan_error', 'preview_scan_error'],
  ['payment_success', 'preview_payment_success'],
  ['payment_error', 'preview_payment_error'],
];

/** إعدادات صوت POS ومناطق المعاينة؛ لا تنفذ أي عملية بيع أو طلب API. */
export function PosSoundFeedbackSettings({ settings, onChange, hapticsSupported, t }: PosSoundFeedbackSettingsProps) {
  const soundsEnabled = settings.sound_enabled;

  function preview(event: PosSoundEvent): void {
    if (!soundsEnabled) return;
    posSound.unlock();
    posSound.play(event, settings);
  }

  return (
    <section className="space-y-4 border-t border-border pt-5" aria-labelledby="pos-feedback-title">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Volume2 className="h-4 w-4 text-muted" strokeWidth={1.7} aria-hidden="true" />
          <Label id="pos-feedback-title">{t('sound_feedback')}</Label>
        </div>
        <p className="text-xs leading-relaxed text-muted">{t('sound_feedback_hint')}</p>
      </div>

      <div className="rounded-md border border-border bg-background/40 px-3 py-2.5">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-text">
          <input
            data-testid="pos-sound-master-toggle"
            className="h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            type="checkbox"
            checked={soundsEnabled}
            onChange={(event) => onChange('sound_enabled', event.target.checked)}
          />
          {soundsEnabled ? <Volume2 className="h-4 w-4 text-muted" strokeWidth={1.7} aria-hidden="true" /> : <VolumeX className="h-4 w-4 text-muted" strokeWidth={1.7} aria-hidden="true" />}
          {t('sound_enabled')}
        </label>
        <p id="pos-sound-master-hint" className="mt-1.5 text-xs leading-relaxed text-muted">
          {soundsEnabled ? t('sound_master_enabled_hint') : t('sound_master_disabled_hint')}
        </p>
      </div>

      <div className="grid gap-x-5 gap-y-2 sm:grid-cols-2" aria-describedby="pos-sound-master-hint">
        <label className="flex items-center gap-2 text-sm text-text">
          <input
            data-testid="pos-sound-scan-toggle"
            className="h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            type="checkbox"
            disabled={!soundsEnabled}
            checked={settings.scan_sound_enabled}
            onChange={(event) => onChange('scan_sound_enabled', event.target.checked)}
          />
          {t('scan_sound_enabled')}
        </label>
        <label className="flex items-center gap-2 text-sm text-text">
          <input
            data-testid="pos-sound-error-toggle"
            className="h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            type="checkbox"
            disabled={!soundsEnabled}
            checked={settings.error_sound_enabled}
            onChange={(event) => onChange('error_sound_enabled', event.target.checked)}
          />
          {t('error_sound_enabled')}
        </label>
        <label className="flex items-center gap-2 text-sm text-text">
          <input
            data-testid="pos-sound-payment-toggle"
            className="h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            type="checkbox"
            disabled={!soundsEnabled}
            checked={settings.payment_sound_enabled}
            onChange={(event) => onChange('payment_sound_enabled', event.target.checked)}
          />
          {t('payment_sound_enabled')}
        </label>
        {hapticsSupported && (
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              data-testid="pos-sound-haptics-toggle"
              className="h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              type="checkbox"
              checked={settings.haptics_enabled}
              onChange={(event) => onChange('haptics_enabled', event.target.checked)}
            />
            <Vibrate className="h-4 w-4 text-muted" strokeWidth={1.7} aria-hidden="true" />
            {t('haptics_enabled')}
          </label>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="sound_volume">{t('sound_volume')}</Label>
          <output htmlFor="sound_volume" className="num text-sm font-semibold text-text" aria-live="polite">{settings.sound_volume}%</output>
        </div>
        <Input
          data-testid="pos-sound-volume-slider"
          id="sound_volume"
          type="range"
          min="0"
          max="100"
          step="5"
          disabled={!soundsEnabled}
          value={String(settings.sound_volume)}
          aria-valuetext={`${settings.sound_volume}%`}
          onChange={(event) => onChange('sound_volume', Number(event.target.value))}
          className="h-3 w-full cursor-pointer px-0 disabled:cursor-not-allowed"
        />
      </div>

      <div className="space-y-2 border-t border-border pt-3" aria-labelledby="pos-sound-preview-title">
        <div>
          <Label id="pos-sound-preview-title">{t('sound_preview_title')}</Label>
          <p className="mt-1 text-xs leading-relaxed text-muted">{soundsEnabled ? t('sound_preview_hint') : t('sound_preview_disabled_hint')}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {PREVIEW_EVENTS.map(([event, label]) => (
            <Button
              key={event}
              data-testid={`pos-sound-preview-${event}`}
              type="button"
              variant="outline"
              disabled={!soundsEnabled}
              className="justify-start gap-2"
              onClick={() => preview(event)}
            >
              <Play className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
              {t(label)}
            </Button>
          ))}
        </div>
        <p className="text-xs leading-relaxed text-muted">{t('sound_autoplay_hint')}</p>
      </div>
    </section>
  );
}
