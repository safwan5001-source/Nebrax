'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { PosSoundFeedbackSettings } from '@/components/pos/pos-sound-feedback-settings';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { POS_FEEDBACK_DEFAULTS, supportsPosHaptics, type PosFeedbackSettings } from '@/lib/pos-sound';

/** صفحة مستقلة لتفضيلات صوت POS؛ تحفظ subset في sales-config/pos نفسه. */
export default function PosSoundFeedbackSettingsPage() {
  const t = useTranslations('posSettings');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [config, setConfig] = useState<PosFeedbackSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hapticsSupported, setHapticsSupported] = useState(false);

  useEffect(() => { setHapticsSupported(supportsPosHaptics()); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<{ data: Partial<PosFeedbackSettings> }>('/sales-config/pos');
      setConfig({ ...POS_FEEDBACK_DEFAULTS, ...result.data });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  function patch<Key extends keyof PosFeedbackSettings>(key: Key, value: PosFeedbackSettings[Key]) {
    setConfig((current) => current ? { ...current, [key]: value } : current);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      await api('/sales-config/pos', { method: 'PUT', body: { data: config } });
      success(tc('updated'));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('back_to_settings')}>
          <Link href="/pos/settings"><ArrowRight className="h-4 w-4" strokeWidth={1.7} /></Link>
        </Button>
        <h1 className="text-xl font-semibold text-text">{t('sound_feedback')}</h1>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{t('sound_feedback')}</CardTitle>
          <p className="mt-1 text-sm text-muted">{t('sound_settings_subtitle')}</p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-96 w-full" />
          ) : !config ? (
            <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-sm text-negative">{error ?? t('load_failed')}</p>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              <PosSoundFeedbackSettings
                settings={config}
                hapticsSupported={hapticsSupported}
                t={t}
                onChange={patch}
              />

              {error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

              <div className="flex justify-end pt-1">
                <Button type="submit" disabled={saving}>{tc('save')}</Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
