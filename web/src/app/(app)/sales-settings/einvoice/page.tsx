'use client';

import { useEffect, useState } from 'react';
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

/**
 * سياسة إرسال ZATCA تُحفظ في المصدر الحقيقي /zatca-settings.
 * النقل الحي وسجل المحاولات وإعادة الإرسال اليدوية تُضاف في PRs لاحقة.
 */
export default function EInvoiceSettingsPage() {
  const t = useTranslations('salesSettings');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [mode, setMode] = useState<SubmissionMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<ZatcaSettingsResponse>('/zatca-settings')
      .then((response) => setMode(response.data.submission_mode))
      .catch((requestError) => {
        setError(requestError instanceof ApiError ? requestError.message : tc('loadFailed'));
      });
  }, [tc]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (mode === null) return;

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
          {mode === null && !error ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="submission-mode">{t('zatca_submission_mode')}</Label>
                <Select
                  id="submission-mode"
                  value={mode ?? 'manual'}
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
                <Button type="submit" disabled={saving || mode === null}>{tc('save')}</Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
