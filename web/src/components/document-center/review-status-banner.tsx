'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ProcessingSummary } from '@/modules/document-center/contract';

type Props = {
  summary: ProcessingSummary | null;
  blockingCount: number;
  warningCount: number;
  batchId: string;
};

export function ReviewStatusBanner({ summary, blockingCount, warningCount, batchId }: Props) {
  const t = useTranslations('documentCenterReview');

  if (!summary && blockingCount === 0 && warningCount === 0) return null;

  const showProcessing = summary && summary.workflow_status !== 'needs_review' && summary.workflow_status !== 'ready_for_draft' && summary.workflow_status !== 'draft_created';

  return (
    <div className="space-y-2">
      {showProcessing && summary && (
        <div className="flex flex-col gap-3 rounded border border-border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-text">{summary.processing_message}</p>
              <p className="mt-1 font-mono text-xs text-muted">{summary.processing_key}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {summary.retry_available && (
              <Button asChild size="sm" variant="outline">
                <Link href="/documents/operations">
                  <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('retryProcessing')}
                </Link>
              </Button>
            )}
            <Button asChild size="sm" variant="outline">
              <Link href={summary.diagnostics_url}>{t('openDiagnostics')}</Link>
            </Button>
          </div>
        </div>
      )}
      {(blockingCount > 0 || warningCount > 0) && (
        <div className="flex flex-wrap gap-2">
          {blockingCount > 0 && <Badge tone="negative">{blockingCount} {t('blocking')}</Badge>}
          {warningCount > 0 && <Badge tone="warning">{warningCount} {t('warning')}</Badge>}
        </div>
      )}
    </div>
  );
}
