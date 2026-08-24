'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BarChart3, CircleAlert, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

interface ReportSettings {
  allow_classification_edit_before_post: boolean;
  allow_classification_edit_after_post: boolean;
}

const DEFAULT_SETTINGS: ReportSettings = {
  allow_classification_edit_before_post: true,
  allow_classification_edit_after_post: false,
};

export default function ClassificationPolicyPage() {
  const t = useTranslations('classificationPolicy');
  const tc = useTranslations('common');
  const { success, error: toastError } = useToast();
  const [settings, setSettings] = useState<ReportSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await api<{ data: ReportSettings }>('/settings/reports');
      setSettings(response.data);
    } catch (err) {
      setLoadFailed(true);
      toastError(err instanceof ApiError ? err.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t, toastError]);

  useEffect(() => { load(); }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await api<{ data: ReportSettings }>('/settings/reports', {
        method: 'PUT',
        body: settings,
      });
      setSettings(response.data);
      success(t('saved'));
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-3xl space-y-5"><Skeleton className="h-12 w-full" /><Skeleton className="h-72 w-full" /></div>;
  }

  if (loadFailed) {
    return <div className="mx-auto max-w-3xl space-y-4"><p className="text-sm text-negative" role="alert">{t('loadFailed')}</p><Button type="button" variant="outline" onClick={load}>{t('retry')}</Button></div>;
  }

  return (
    <form onSubmit={save} className="mx-auto max-w-3xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild type="button" variant="ghost" size="icon" aria-label={t('backToReports')}><Link href="/reports"><ArrowRight className="h-4 w-4" strokeWidth={1.7} /></Link></Button>
          <div><h1 className="text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 text-sm text-muted">{t('subtitle')}</p></div>
        </div>
        <Button disabled={saving}><Save className="h-4 w-4" strokeWidth={1.7} />{saving ? t('saving') : t('save')}</Button>
      </header>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-primary" strokeWidth={1.7} aria-hidden="true" />{t('title')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <PolicyControl
            title={t('beforeTitle')}
            hint={t('beforeHint')}
            checked={settings.allow_classification_edit_before_post}
            disabled={saving}
            onChange={(value) => setSettings((current) => ({ ...current, allow_classification_edit_before_post: value }))}
            enabledLabel={t('enabled')}
            disabledLabel={t('disabled')}
          />
          <PolicyControl
            title={t('afterTitle')}
            hint={t('afterHint')}
            checked={settings.allow_classification_edit_after_post}
            disabled={saving}
            onChange={(value) => setSettings((current) => ({ ...current, allow_classification_edit_after_post: value }))}
            enabledLabel={t('enabled')}
            disabledLabel={t('disabled')}
          />
        </CardContent>
      </Card>

      <div className="flex gap-3 rounded border border-warning/30 bg-warning/10 p-4 text-sm text-text" role="note">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={1.8} aria-hidden="true" />
        <div><p className="font-medium">{t('historyNoticeTitle')}</p><p className="mt-1 leading-6 text-muted">{t('historyNotice')}</p></div>
      </div>
    </form>
  );
}

function PolicyControl({ title, hint, checked, disabled, onChange, enabledLabel, disabledLabel }: {
  title: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
  enabledLabel: string;
  disabledLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 rounded border border-border p-4">
      <div className="min-w-0 space-y-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-text">{title}</p><Badge tone={checked ? 'positive' : 'muted'}>{checked ? enabledLabel : disabledLabel}</Badge></div><p className="text-sm leading-6 text-muted">{hint}</p></div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}
