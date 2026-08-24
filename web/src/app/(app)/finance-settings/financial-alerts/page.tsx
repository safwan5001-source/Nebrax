'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight, BellRing, Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

interface FinanceAlertSettings {
  financial_alerts_enabled: boolean;
  alert_check_window_days: number;
}

const DEFAULT_SETTINGS: FinanceAlertSettings = {
  financial_alerts_enabled: false,
  alert_check_window_days: 1,
};

export default function FinancialAlertSettingsPage() {
  const t = useTranslations('financialAlerts');
  const tc = useTranslations('common');
  const { success, error: toastError } = useToast();
  const [settings, setSettings] = useState<FinanceAlertSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await api<{ data: FinanceAlertSettings }>('/settings/finance');
      setSettings(response.data);
    } catch (err) {
      setLoadFailed(true);
      toastError(err instanceof ApiError ? err.message : tc('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [tc, toastError]);

  useEffect(() => { load(); }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await api<{ data: FinanceAlertSettings }>('/settings/finance', {
        method: 'PUT',
        body: settings,
      });
      setSettings(response.data);
      success(t('settingsSaved'));
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-3xl space-y-5"><div className="h-12 animate-pulse rounded-md bg-muted" /><div className="h-72 animate-pulse rounded-md bg-muted" /></div>;
  }

  if (loadFailed) {
    return <div className="mx-auto max-w-3xl space-y-4"><p className="text-sm text-negative">{t('settingsLoadFailed')}</p><Button type="button" variant="outline" onClick={load}>{t('retry')}</Button></div>;
  }

  return (
    <form onSubmit={save} className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild type="button" variant="ghost" size="icon" aria-label={t('backToFinanceSettings')}><Link href="/finance-settings"><ArrowRight className="h-4 w-4" strokeWidth={1.7} /></Link></Button>
          <div><h1 className="text-xl font-semibold text-text">{t('settingsTitle')}</h1><p className="mt-1 text-sm text-muted">{t('settingsSubtitle')}</p></div>
        </div>
        <Button disabled={saving}><Save className="h-4 w-4" strokeWidth={1.7} />{saving ? t('savingSettings') : t('saveSettings')}</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><BellRing className="h-5 w-5 text-primary" strokeWidth={1.7} />{t('scheduleTitle')}</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4 rounded border border-border p-4">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2"><p className="font-medium text-text">{t('enabledLabel')}</p><Badge tone={settings.financial_alerts_enabled ? 'positive' : 'muted'}>{settings.financial_alerts_enabled ? t('enabled') : t('disabled')}</Badge></div>
              <p className="text-sm leading-6 text-muted">{t('enabledHint')}</p>
            </div>
            <Switch checked={settings.financial_alerts_enabled} disabled={saving} onCheckedChange={(value) => setSettings((current) => ({ ...current, financial_alerts_enabled: value }))} aria-label={t('enabledLabel')} />
          </div>

          <label className="block max-w-xs space-y-2 text-sm font-medium text-text">
            <span>{t('windowDaysLabel')}</span>
            <Input type="number" min="1" max="90" inputMode="numeric" disabled={saving} value={settings.alert_check_window_days} onChange={(event) => setSettings((current) => ({ ...current, alert_check_window_days: Number(event.target.value) }))} aria-describedby="alert-window-hint" />
            <span id="alert-window-hint" className="block text-sm font-normal leading-6 text-muted">{t('windowDaysHint')}</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-5">
          <div><p className="font-medium text-text">{t('reviewTitle')}</p><p className="mt-1 text-sm text-muted">{t('reviewHint')}</p></div>
          <Button asChild type="button" variant="outline"><Link href="/financial-alerts">{t('openAlerts')}</Link></Button>
        </CardContent>
      </Card>
    </form>
  );
}
