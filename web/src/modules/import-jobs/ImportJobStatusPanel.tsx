'use client';

import { useTranslations } from 'next-intl';
import { AlertTriangle, Loader2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CANCELLABLE_STATUSES, type ImportJob, type ImportJobStatus } from './client';

const STATUS_TONE: Record<ImportJobStatus, 'muted' | 'positive' | 'negative' | 'warning'> = {
  uploaded: 'muted',
  ready: 'muted',
  queued: 'muted',
  processing: 'warning',
  completed: 'positive',
  failed: 'negative',
  cancelled: 'muted',
};

/**
 * لوحة حالة تشغيلة الاستيراد الدائم — مشتركة بين المجالات الثلاثة. تعرض
 * الحالة الرسمية من الخادم فقط (لا حالة عميل موازية)، وتقدّماً حقيقياً
 * (`processed_rows`/`row_count`) لمجالٍ مجزّأ، أو مؤشّر معالجة صادقاً بلا
 * نسبة مزيَّفة لمجالٍ ذرّي (`atomic`).
 */
export function ImportJobStatusPanel({
  job,
  atomic,
  networkUncertain = false,
  onCancel,
  cancelling = false,
}: {
  job: ImportJob;
  atomic: boolean;
  networkUncertain?: boolean;
  onCancel?: () => void;
  cancelling?: boolean;
}) {
  const t = useTranslations('importJobs');
  const canCancel = Boolean(onCancel) && CANCELLABLE_STATUSES.has(job.status);
  const showProgress = !atomic && job.status === 'processing' && job.row_count !== null && job.row_count > 0;
  const percent = showProgress ? Math.min(100, Math.round((job.processed_rows / (job.row_count ?? 1)) * 100)) : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[job.status]}>
          {(job.status === 'processing' || job.status === 'uploaded' || job.status === 'queued') ? (
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.8} />
          ) : null}
          {t(`status_${job.status}` as 'status_ready')}
        </Badge>
        <span className="num text-xs text-muted" dir="ltr" title={job.id}>
          {job.original_filename}
        </span>
        {canCancel ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ms-auto text-negative hover:text-negative"
            disabled={cancelling}
            onClick={onCancel}
          >
            {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.7} /> : <XCircle className="h-3.5 w-3.5" strokeWidth={1.7} />}
            {t('cancel')}
          </Button>
        ) : null}
      </div>

      {networkUncertain ? (
        <p role="status" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
          {t('network_uncertain')}
        </p>
      ) : null}

      {showProgress ? (
        <div className="space-y-1" aria-live="polite">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>{t('progress_rows', { processed: job.processed_rows, total: job.row_count ?? 0 })}</span>
            <span className="num font-medium text-text">{percent}%</span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-background"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
          </div>
        </div>
      ) : null}

      {atomic && (job.status === 'processing' || job.status === 'uploaded' || job.status === 'queued') ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} />
          {t('atomic_processing')}
        </p>
      ) : null}

      {job.status === 'failed' && job.error_message ? (
        <p role="alert" className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">
          {job.error_message}
        </p>
      ) : null}
    </div>
  );
}
