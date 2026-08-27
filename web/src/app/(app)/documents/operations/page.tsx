'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleAlert, FileSearch, RefreshCw, RotateCw, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { api, ApiError } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DocumentOperationsNav } from '@/components/documents/document-operations-nav';

type Run = { id: string; stage: string; status: string; attempt_count: number; error_code: string | null; error_message_safe: string | null; updated_at: string | null };
type Item = {
  id: string; document_type: string; workflow_status: string; version: number; created_at: string | null; updated_at: string | null;
  file: { id: string; scan_status: string; purged_at: string | null } | null;
  processing_status: { key: string; tone: string; retry_available: boolean; message: string };
  runs: Run[];
};
type Data = {
  summary: Record<string, number>;
  retention: { retention_days: number; enabled: boolean; purge_mode: string; last_run: { finished_at: string | null; dry_run: boolean; purged_count: number } | null };
  data: Item[];
  meta: { current_page: number; last_page: number; total: number };
};

const statusKeys: Record<string, string> = {
  received: 'statusReceived', waiting_for_processing: 'statusWaiting', safety_check_pending: 'statusSafetyPending', quarantined: 'statusQuarantined',
  extraction_unavailable: 'statusExtractionUnavailable', processing: 'statusProcessing', needs_review: 'statusNeedsReview', ready_for_draft: 'statusReady',
  draft_created: 'statusDraftCreated', failed_retry_available: 'statusFailedRetry', failed_action_required: 'statusFailedAction', archived_or_purged: 'statusArchived',
};
const tones: Record<string, 'neutral' | 'muted' | 'positive' | 'warning' | 'negative'> = {
  neutral: 'muted', info: 'neutral', success: 'positive', warning: 'warning', danger: 'negative',
};

export default function DocumentOperationsPage() {
  const t = useTranslations('documentOperations');
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const path = useMemo(() => `/document-operations?per_page=20&page=${page}`, [page]);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await api<{ data: Data }>(path);
      setData(response.data);
    } catch (exception) {
      setError(exception instanceof ApiError ? exception.message : t('loadFailed'));
    } finally { setLoading(false); }
  }, [path, t]);

  useEffect(() => { void load(); }, [load]);

  async function retry(run: Run) {
    setRetrying(run.id); setNotice(null);
    try {
      const response = await api<{ data: { accepted: boolean; message: string } }>(`/document-processing-runs/${run.id}/retry`, {
        method: 'POST', body: { version: run.updated_at ?? undefined },
      });
      setNotice(response.data.accepted ? t('retryQueued') : `${t('retryBlocked')} ${response.data.message}`);
      await load();
    } catch (exception) {
      setNotice(exception instanceof ApiError ? `${t('retryBlocked')} ${exception.message}` : t('retryBlocked'));
    } finally { setRetrying(null); }
  }

  const stats = data ? [
    ['summaryBatches', data.summary.batches], ['summaryQueued', data.summary.queued_runs], ['summaryRunning', data.summary.running_runs],
    ['summaryFailed', data.summary.failed_runs], ['summaryHolds', data.summary.active_holds], ['summaryRedactions', data.summary.redactions], ['summaryPurged', data.summary.purged_files],
  ] as const : [];

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 text-sm text-muted">{t('subtitle')}</p></div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" aria-hidden="true" />{t('refresh')}</Button>
      </header>
      <DocumentOperationsNav />

      {notice && <div role="status" className="rounded border border-primary/20 bg-primary-soft px-3 py-2 text-sm text-text">{notice}</div>}
      {loading ? <Card><CardContent className="py-10 text-sm text-muted">{t('loading')}</CardContent></Card> : error ? (
        <Card><CardContent className="flex flex-wrap items-center gap-3 py-10 text-sm text-muted"><CircleAlert className="h-5 w-5" aria-hidden="true" />{error}<Button variant="outline" onClick={() => void load()}>{t('retry')}</Button></CardContent></Card>
      ) : data ? <>
        <section aria-label={t('title')} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map(([label, value]) => <Card key={label}><CardContent className="py-4"><p className="text-xs text-muted">{t(label)}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-text">{value}</p></CardContent></Card>)}
        </section>
        <Card><CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true"/><div><h2 className="font-medium text-text">{t('retention')}</h2><p className="text-sm text-muted">{t('retentionDays', { days: data.retention.retention_days })} · {t('purgeMode')}</p></div></div><Badge tone={data.retention.enabled ? 'positive' : 'warning'}>{data.retention.enabled ? t('retentionEnabled') : t('retentionDisabled')}</Badge></CardContent></Card>
        {data.data.length === 0 ? <Card><CardContent className="flex items-center gap-3 py-10 text-sm text-muted"><FileSearch className="h-5 w-5" aria-hidden="true" />{t('empty')}</CardContent></Card> : <>
          <div className="hidden overflow-hidden rounded border border-border md:block"><table className="w-full text-sm"><thead className="bg-surface text-muted"><tr><th className="px-4 py-3 text-start">{t('batch')}</th><th className="px-4 py-3 text-start">{t('type')}</th><th className="px-4 py-3 text-start">{t('workflow')}</th><th className="px-4 py-3 text-start">{t('processing')}</th><th className="px-4 py-3 text-end">{t('actions')}</th></tr></thead><tbody>{data.data.map((item) => <tr key={item.id} className="border-t border-border"><td className="px-4 py-3 font-mono text-xs">{item.id.slice(0, 8)}</td><td className="px-4 py-3">{item.document_type}</td><td className="px-4 py-3"><Badge tone="muted">{item.workflow_status}</Badge></td><td className="px-4 py-3"><Badge tone={tones[item.processing_status.tone] ?? 'muted'}>{t(statusKeys[item.processing_status.key] ?? 'statusWaiting')}</Badge><p className="mt-1 max-w-md text-xs text-muted">{item.processing_status.message}</p></td><td className="px-4 py-3"><div className="flex justify-end gap-2">{item.runs.filter((run) => run.status === 'failed').map((run) => <Button key={run.id} size="sm" variant="outline" disabled={retrying === run.id} onClick={() => void retry(run)}><RotateCw className="h-3.5 w-3.5" aria-hidden="true" />{retrying === run.id ? t('loading') : t('retryRun')}</Button>)}<Button asChild size="sm" variant="outline"><Link href={`/documents/${item.id}/diagnostics`}>{t('openDiagnostics')}</Link></Button><Button asChild size="sm"><Link href={`/documents/${item.id}`}>{t('viewReview')}</Link></Button></div></td></tr>)}</tbody></table></div>
          <div className="grid gap-3 md:hidden">{data.data.map((item) => <Card key={item.id}><CardContent className="space-y-3 py-4"><div className="flex items-center justify-between gap-3"><span className="font-mono text-xs">{item.id.slice(0, 8)}</span><Badge tone={tones[item.processing_status.tone] ?? 'muted'}>{t(statusKeys[item.processing_status.key] ?? 'statusWaiting')}</Badge></div><p className="text-sm text-text">{item.document_type}</p><p className="text-xs text-muted">{item.processing_status.message}</p><div className="flex flex-col gap-2">{item.runs.filter((run) => run.status === 'failed').map((run) => <Button key={run.id} variant="outline" disabled={retrying === run.id} onClick={() => void retry(run)}><RotateCw className="h-4 w-4" aria-hidden="true" />{t('retryRun')}</Button>)}<Button asChild variant="outline"><Link href={`/documents/${item.id}/diagnostics`}>{t('openDiagnostics')}</Link></Button><Button asChild><Link href={`/documents/${item.id}`}>{t('viewReview')}</Link></Button></div></CardContent></Card>)}</div>
          {data.meta.last_page > 1 && <div className="flex items-center justify-between text-sm text-muted"><span>{data.meta.total}</span><div className="flex gap-2"><Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>‹</Button><Button variant="outline" disabled={page >= data.meta.last_page} onClick={() => setPage((value) => value + 1)}>›</Button></div></div>}
        </>}
      </> : null}
    </div>
  );
}
