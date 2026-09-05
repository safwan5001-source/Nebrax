'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, FileText, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import type { ReviewFile } from '@/modules/document-center/contract';

type PreviewState = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

type Props = {
  file: ReviewFile | null;
  scanStatus?: string;
  processingMessage?: string;
  scanExceptionAdmitted?: boolean;
};

export function DocumentPreviewPanel({ file, scanStatus, processingMessage, scanExceptionAdmitted }: Props) {
  const t = useTranslations('documentCenterReview');
  const [state, setState] = useState<PreviewState>('idle');
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!file) {
      setState('unavailable');
      return;
    }
    if (!file.download_available) {
      setState('unavailable');
      setUrl(null);
      return;
    }

    setState('loading');
    setError(null);
    try {
      const response = await api<{ url: string }>(`/document-files/${file.id}/download-url`);
      setUrl(response.url);
      setState('ready');
    } catch (exception) {
      setError(exception instanceof ApiError ? exception.message : t('unavailable'));
      setState('error');
    }
  }, [file, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!file) {
    return (
      <div className="flex min-h-[12rem] items-center justify-center rounded border border-border bg-surface p-6 text-sm text-muted">
        {t('noPreview')}
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div className="flex min-h-[12rem] flex-col items-center justify-center gap-3 rounded border border-border bg-surface p-6 text-sm text-muted">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
        {t('previewLoading')}
      </div>
    );
  }

  if (state === 'unavailable') {
    return (
      <div className="space-y-3 rounded border border-border bg-surface p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium text-text">{file.original_name}</p>
            <p className="mt-1 text-sm text-muted">{t('previewUnavailable')}</p>
            {scanStatus && <p className="mt-1 font-mono text-xs text-muted">{scanStatus}</p>}
            {scanExceptionAdmitted ? (
              <p className="mt-1 text-xs text-muted">{t('scanExceptionNotice')}</p>
            ) : (
              processingMessage && <p className="mt-1 text-xs text-muted">{processingMessage}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="space-y-3 rounded border border-border bg-surface p-4">
        <p role="alert" className="text-sm text-negative">{error}</p>
        <Button size="sm" variant="outline" onClick={() => void load()}>{t('retry')}</Button>
      </div>
    );
  }

  const isImage = file.mime_type?.startsWith('image/');
  const isPdf = file.mime_type === 'application/pdf';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
          <span className="truncate font-medium text-text">{file.original_name}</span>
        </div>
        {file.page_count ? <span className="text-xs text-muted">{t('page', { page: file.page_count })}</span> : null}
      </div>
      <div className="overflow-hidden rounded border border-border bg-surface">
        {isImage && url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={file.original_name} className="max-h-[min(70vh,32rem)] w-full object-contain" />
        ) : isPdf && url ? (
          <iframe
            title={file.original_name}
            src={url}
            className="h-[min(70vh,32rem)] w-full border-0"
          />
        ) : url ? (
          <div className="flex min-h-[12rem] flex-col items-center justify-center gap-3 p-6 text-sm text-muted">
            <p>{t('previewUnsupported')}</p>
            <Button asChild size="sm" variant="outline">
              <a href={url} target="_blank" rel="noopener noreferrer">{t('download')}</a>
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
