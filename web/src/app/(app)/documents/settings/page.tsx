'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CircleAlert, Lock, Server, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DocumentOperationsNav } from '@/components/documents/document-operations-nav';

type Governance = {
  policy: { retention_days: number; enabled: boolean; purge_mode: string; policy_source: string; last_run_at: string | null };
};

type OperationsSummary = {
  summary: Record<string, number>;
  retention: { retention_days: number; enabled: boolean; purge_mode: string };
};

export default function DocumentSettingsPage() {
  const t = useTranslations('documentCenterReview');
  const to = useTranslations('documentOperations');
  const [governance, setGovernance] = useState<Governance | null>(null);
  const [operations, setOperations] = useState<OperationsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setGovernance(null);
    setOperations(null);

    const [govResult, opsResult] = await Promise.allSettled([
      api<{ data: Governance }>('/document-governance'),
      api<{ data: OperationsSummary }>('/document-operations?per_page=1'),
    ]);

    if (govResult.status === 'rejected') {
      const exception = govResult.reason;
      setError(exception instanceof ApiError ? exception.message : t('loadFailed'));
      setLoading(false);
      return;
    }

    setGovernance(govResult.value.data);
    if (opsResult.status === 'fulfilled') {
      setOperations(opsResult.value.data);
    }

    setLoading(false);
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-text">{t('settingsTitle')}</h1>
        <p className="mt-1 text-sm text-muted">{t('settingsSubtitle')}</p>
      </header>

      <DocumentOperationsNav />

      {loading ? (
        <Card><CardContent className="py-10 text-sm text-muted">{t('loading')}</CardContent></Card>
      ) : error ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 py-10 text-sm text-muted">
            <CircleAlert className="h-5 w-5" aria-hidden="true" />
            {error}
            <Button variant="outline" onClick={() => void load()}>{t('retry')}</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardContent className="flex gap-3 py-4">
              <Lock className="mt-0.5 h-5 w-5 text-warning" aria-hidden="true" />
              <div>
                <h2 className="font-medium text-text">{t('providerNetworkLocked')}</h2>
                <p className="mt-1 text-sm text-muted">{to('statusExtractionUnavailable')}</p>
                <Badge className="mt-2" tone="warning">{to('retentionDisabled')}</Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex gap-3 py-4">
              <Server className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
              <div>
                <h2 className="font-medium text-text">{t('storageStatus')}</h2>
                <p className="mt-1 text-sm text-muted">{to('purgeMode')}</p>
                <Badge className="mt-2" tone="muted">{t('unavailable')}</Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex gap-3 py-4">
              <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
              <div>
                <h2 className="font-medium text-text">{t('processingStatus')}</h2>
                {operations && (
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <div><dt className="text-muted">{to('summaryBatches')}</dt><dd className="font-mono">{operations.summary.batches ?? 0}</dd></div>
                    <div><dt className="text-muted">{to('summaryFailed')}</dt><dd className="font-mono">{operations.summary.failed_runs ?? 0}</dd></div>
                    <div><dt className="text-muted">{to('summaryQueued')}</dt><dd className="font-mono">{operations.summary.queued_runs ?? 0}</dd></div>
                    <div><dt className="text-muted">{to('summaryRunning')}</dt><dd className="font-mono">{operations.summary.running_runs ?? 0}</dd></div>
                  </dl>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex gap-3 py-4">
              <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
              <div>
                <h2 className="font-medium text-text">{t('retentionStatus')}</h2>
                {governance && (
                  <>
                    <p className="mt-1 text-sm text-muted">{to('retentionDays', { days: governance.policy.retention_days })}</p>
                    <Badge className="mt-2" tone={governance.policy.enabled ? 'positive' : 'warning'}>
                      {governance.policy.enabled ? to('retentionEnabled') : to('retentionDisabled')}
                    </Badge>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
