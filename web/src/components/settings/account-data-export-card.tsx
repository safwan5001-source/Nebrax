'use client';

import { useState } from 'react';
import { Download, FileJson, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ApiError, downloadFile } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';

export function AccountDataExportCard({ isOwner }: { isOwner: boolean }) {
  const t = useTranslations('settings');
  const { success, error } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  if (!isOwner) {
    return <p className="rounded border border-border bg-surface px-4 py-3 text-sm text-muted">{t('export_owner_only')}</p>;
  }

  async function download(): Promise<void> {
    setDownloading(true);
    try {
      await downloadFile('/account/export', 'nebrax-company-export.json');
      success(t('export_complete'));
      setConfirmOpen(false);
    } catch (err) {
      error(t('export_failed'), err instanceof ApiError ? err.message : undefined);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base"><FileJson className="h-4 w-4 text-muted" strokeWidth={1.7} aria-hidden="true" />{t('export_company_data')}</CardTitle>
            <p className="text-sm text-muted">{t('export_description')}</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 rounded border border-border bg-background p-3 text-sm text-muted"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />{t('export_security_note')}</div>
          <Button onClick={() => setConfirmOpen(true)} className="w-full sm:w-auto"><Download className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />{t('export_company_data')}</Button>
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onClose={() => !downloading && setConfirmOpen(false)} title={t('export_company_data')}>
        <div className="space-y-5">
          <p className="text-sm leading-6 text-muted">{t('export_confirm')}</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={downloading}>{t('cancel')}</Button><Button onClick={download} disabled={downloading}>{downloading ? t('export_downloading') : t('export_confirm_action')}</Button></div>
        </div>
      </Dialog>
    </>
  );
}
