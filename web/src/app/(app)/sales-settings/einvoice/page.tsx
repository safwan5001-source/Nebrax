'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

type SubmissionMode = 'manual' | 'automatic';

interface ZatcaSettingsResponse {
  data: {
    submission_mode: SubmissionMode;
  };
}

interface ApplicationNavStateResponse {
  data: Record<string, boolean>;
}

/**
 * سياسة إرسال ZATCA تُحفظ في المصدر الحقيقي /zatca-settings.
 * النقل الحي وسجل المحاولات وإعادة الإرسال اليدوية تُضاف في PRs لاحقة.
 */
export default function EInvoiceSettingsPage() {
  const t = useTranslations('salesSettings');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [zatcaAvailable, setZatcaAvailable] = useState<boolean | null>(null);
  const [mode, setMode] = useState<SubmissionMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const navState = await api<ApplicationNavStateResponse>('/applications/nav-state');
        if (cancelled) return;

        const available = !Array.isArray(navState.data)
          && navState.data['compliance.zatca'] === true;
        setZatcaAvailable(available);
        if (!available) return;

        const response = await api<ZatcaSettingsResponse>('/zatca-settings');
        if (!cancelled) setMode(response.data.submission_mode);
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof ApiError ? requestError.message : tc('loadFailed'));
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [tc]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (mode === null || zatcaAvailable !== true) return;

    setSaving(true);
    setError(null);
    try {
      const response = await api<ZatcaSettingsResponse>('/zatca-settings', {
        method: 'PUT',
        body: { submission_mode: mode },
      });
      setMode(response.data.submission_mode);
      success(tc('updated'));
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-text">{t('c_einvoice_t')}</h1>
        <p className="mt-1 text-sm text-muted">{t('c_einvoice_d')}</p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{t('zatca_submission_mode')}</CardTitle>
        </CardHeader>
        <CardContent>
          {zatcaAvailable === null && !error ? (
            <Skeleton className="h-32 w-full" />
          ) : zatcaAvailable === false ? (
            <div className="space-y-3">
              <p className="text-sm leading-relaxed text-muted">{t('zatca_application_inactive')}</p>
              <Link
                href="/applications"
                className="inline-flex h-10 items-center rounded bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {t('zatca_open_applications')}
              </Link>
            </div>
          ) : mode === null ? (
            <p className="rounded bg-negative/10 px-3 py-2 text-sm text-negative">
              {error ?? tc('loadFailed')}
            </p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="submission-mode">{t('zatca_submission_mode')}</Label>
                <Select
                  id="submission-mode"
                  value={mode}
                  disabled={saving}
                  onChange={(event) => setMode(event.target.value as SubmissionMode)}
                >
                  <option value="manual">{t('zatca_submission_manual')}</option>
                  <option value="automatic">{t('zatca_submission_automatic')}</option>
                </Select>
                <p className="text-xs leading-relaxed text-muted">{t('zatca_submission_hint')}</p>
              </div>

              <p className="rounded bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
                {t('zatca_connection_pending')}
              </p>
              <p className="text-xs leading-relaxed text-muted">{t('zatca_manual_retry_hint')}</p>

              {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

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
