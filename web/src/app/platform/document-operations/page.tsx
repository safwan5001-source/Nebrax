'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, CircleAlert, Download, Play, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ApiError } from '@/lib/api';
import { isPlatformAuthenticated } from '@/lib/platform-auth';
import { platformApi, platformDownloadFile } from '@/lib/platform-api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type Overview = { runtime: { queue_configured: boolean; worker_status: string; worker_last_seen_at: string | null; queued_runs: number; running_runs: number; failed_runs: number }; batches_by_status: { status: string; count: number }[]; runs_by_status: { status: string; count: number }[]; retention: { retention_days: number; enabled: boolean; purge_mode: string; last_run: { id: string; status: string; dry_run: boolean; purged_count: number; finished_at: string | null } | null }; retention_runs: { id: string; dry_run: boolean; status: string; cutoff_at: string | null; scanned_count: number; eligible_count: number; purged_count: number; skipped_count: number; after_file_id: string | null; next_after_file_id: string | null; created_at: string | null }[] };
type RetentionRunResponse = { data: { run_id: string; dry_run: boolean; status: string; cutoff_at: string | null; after_file_id: string | null; next_after_file_id: string | null; results: { scanned: number; eligible: number; purged: number; skipped: number } } };
type Usage = { operations: number; pages: number; input_tokens: number; output_tokens: number; per_tenant: { tenant_id: string; operations: number; pages: number; input_tokens: number; output_tokens: number }[]; per_provider_model: { provider: string; model: string; operations: number; pages: number }[] };
type Diagnostics = { runtime: { processing_mode?: string; queue_configured: boolean; worker_required?: boolean; worker_online: boolean; scanner_ready: boolean; provider_configured: boolean; provider_network_locked: boolean; runs: { queued: number; running: number; failed: number } } };

export default function PlatformDocumentOperationsPage() {
  const t = useTranslations('documentOperations');
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [days, setDays] = useState('365');
  const [enabled, setEnabled] = useState(true);
  const [dryRun, setDryRun] = useState(true);
  const [confirmApply, setConfirmApply] = useState(false);
  const [afterFileId, setAfterFileId] = useState<string | null>(null);
  const resumeCursorInitialized = useRef(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [operationsResponse, usageResponse, diagnosticResponse] = await Promise.all([
        platformApi<{ data: Overview }>('/platform/document-operations'), platformApi<{ data: Usage }>('/platform/document-usage'), platformApi<{ data: Diagnostics }>('/platform/document-diagnostics'),
      ]);
      setOverview(operationsResponse.data); setUsage(usageResponse.data); setDiagnostics(diagnosticResponse.data);
      setDays(String(operationsResponse.data.retention.retention_days)); setEnabled(operationsResponse.data.retention.enabled);
      if (!resumeCursorInitialized.current) {
        setAfterFileId(operationsResponse.data.retention_runs[0]?.next_after_file_id ?? null);
        resumeCursorInitialized.current = true;
      }
    } catch (exception) { setError(exception instanceof ApiError ? exception.message : t('platformLoadFailed')); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { if (!isPlatformAuthenticated()) { router.replace('/platform/login'); return; } void load(); }, [load, router]);

  async function savePolicy() { setBusy('policy'); setNotice(null); try { await platformApi('/platform/document-retention-policy', { method: 'PATCH', body: { retention_days: Number(days), enabled } }); setNotice(t('policySaved')); await load(); } catch (exception) { setNotice(exception instanceof ApiError ? exception.message : t('platformActionFailed')); } finally { setBusy(null); } }
  async function runRetention() { setBusy('run'); setNotice(null); try { const response = await platformApi<RetentionRunResponse>('/platform/document-retention-runs', { method: 'POST', body: { dry_run: dryRun, ...(dryRun ? {} : { apply: confirmApply }), ...(afterFileId ? { after_file_id: afterFileId } : {}) } }); setAfterFileId(response.data.next_after_file_id); setNotice(response.data.next_after_file_id ? t('runCompletedResume') : t('runCompleted')); await load(); } catch (exception) { setNotice(exception instanceof ApiError ? exception.message : t('platformActionFailed')); } finally { setBusy(null); } }
  async function exportAudit() { setBusy('export'); setNotice(null); try { const outcome = await platformDownloadFile('/platform/document-audit/export', 'platform-document-audit.csv'); setNotice(outcome === 'downloaded' ? t('exported') : t('exportDemoUnavailable')); } catch (exception) { setNotice(exception instanceof ApiError ? exception.message : t('platformActionFailed')); } finally { setBusy(null); } }

  return <div className="min-h-screen bg-background px-4 py-6 text-text md:px-8"><main className="mx-auto max-w-7xl space-y-5"><header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between"><div><Button asChild variant="ghost" size="sm"><Link href="/platform" aria-label={t('back')}>←</Link></Button><h1 className="mt-2 text-xl font-semibold">{t('platformTitle')}</h1><p className="mt-1 text-sm text-muted">{t('platformSubtitle')}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy === 'export'} onClick={() => void exportAudit()}><Download className="h-4 w-4" aria-hidden="true" />{t('exportAudit')}</Button><Button variant="outline" disabled={loading} onClick={() => void load()}><RefreshCw className="h-4 w-4" aria-hidden="true" />{t('refresh')}</Button></div></header>
    {notice && <div role="status" className="rounded border border-primary/20 bg-primary-soft px-3 py-2 text-sm">{notice}</div>}
    {loading ? <Card><CardContent className="py-10 text-sm text-muted">{t('loading')}</CardContent></Card> : error ? <Card><CardContent className="flex flex-wrap items-center gap-3 py-10 text-sm text-muted"><CircleAlert className="h-5 w-5" aria-hidden="true" />{error}<Button variant="outline" onClick={() => void load()}>{t('retry')}</Button></CardContent></Card> : overview && usage && diagnostics ? <>
      <section aria-label={t('runtime')} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><Card><CardContent className="py-4"><p className="text-xs text-muted">{t('processingMode')}</p><Badge className="mt-2" tone={diagnostics.runtime.processing_mode === 'sync' ? 'neutral' : 'positive'}>{diagnostics.runtime.processing_mode === 'sync' ? t('processingModeSync') : t('processingModeAsync')}</Badge></CardContent></Card><Card><CardContent className="py-4"><p className="text-xs text-muted">{t('queueWorker')}</p><Badge className="mt-2" tone={diagnostics.runtime.worker_required === false || diagnostics.runtime.processing_mode === 'sync' ? 'muted' : diagnostics.runtime.worker_online ? 'positive' : 'warning'}>{diagnostics.runtime.worker_required === false || diagnostics.runtime.processing_mode === 'sync' ? t('workerNotRequired') : diagnostics.runtime.worker_online ? t('workerOnline') : t('workerOffline')}</Badge></CardContent></Card><Card><CardContent className="py-4"><p className="text-xs text-muted">{t('networkLocked')}</p><Badge className="mt-2" tone={diagnostics.runtime.provider_network_locked ? 'warning' : 'positive'}>{diagnostics.runtime.provider_network_locked ? t('networkLocked') : t('networkOpen')}</Badge></CardContent></Card><Card><CardContent className="py-4"><p className="text-xs text-muted">{t('processing')}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{diagnostics.runtime.runs.running}</p></CardContent></Card></section>
      <div className="grid gap-5 xl:grid-cols-2"><Card><CardContent className="py-4"><div className="flex gap-2"><ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" /><h2 className="font-medium">{t('retention')}</h2></div><label className="mt-4 grid gap-1 text-sm"><span>{t('retentionDaysLabel')}</span><input type="number" min="1" max="3650" value={days} onChange={(e) => setDays(e.target.value)} className="h-10 rounded border border-border bg-surface px-3" /></label><label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{t('policyEnabled')}</label><Button className="mt-4" disabled={busy === 'policy'} onClick={() => void savePolicy()}><Save className="h-4 w-4" aria-hidden="true" />{t('savePolicy')}</Button></CardContent></Card>
      <Card><CardContent className="py-4"><div className="flex gap-2"><Activity className="h-5 w-5 text-primary" aria-hidden="true" /><h2 className="font-medium">{t('retentionRuns')}</h2></div><p className="mt-3 break-all text-xs text-muted">{afterFileId ? `${t('resumeCursor')}: ${afterFileId}` : t('resumeFromStart')}</p><label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={dryRun} onChange={(e) => { setDryRun(e.target.checked); setConfirmApply(false); }} />{t('dryRun')}</label>{!dryRun && <label className="mt-3 flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={confirmApply} onChange={(e) => setConfirmApply(e.target.checked)} />{t('confirmApply')}</label>}<Button className="mt-4" disabled={busy === 'run' || (!dryRun && !confirmApply)} onClick={() => void runRetention()}><Play className="h-4 w-4" aria-hidden="true" />{dryRun ? t('runRetention') : t('applyRun')}</Button></CardContent></Card></div>
      <section className="grid gap-5 xl:grid-cols-2"><Card><CardContent className="py-4"><h2 className="font-medium">{t('platformUsage')}</h2><div className="mt-3 grid grid-cols-2 gap-3"><div><p className="text-xs text-muted">{t('operations')}</p><p className="text-xl font-semibold tabular-nums">{usage.operations}</p></div><div><p className="text-xs text-muted">{t('pages')}</p><p className="text-xl font-semibold tabular-nums">{usage.pages}</p></div><div><p className="text-xs text-muted">{t('inputTokens')}</p><p className="text-xl font-semibold tabular-nums">{usage.input_tokens}</p></div><div><p className="text-xs text-muted">{t('outputTokens')}</p><p className="text-xl font-semibold tabular-nums">{usage.output_tokens}</p></div></div></CardContent></Card><Card><CardContent className="py-4"><h2 className="font-medium">{t('retentionRuns')}</h2><div className="mt-3 space-y-2">{overview.retention_runs.length === 0 ? <p className="text-sm text-muted">{t('notRun')}</p> : overview.retention_runs.map((run) => <div key={run.id} className="rounded border border-border p-3 text-sm"><div className="flex items-center justify-between gap-2"><span className="font-mono text-xs">{run.id.slice(0, 12)}</span><Badge tone={run.status === 'completed' ? 'positive' : run.status === 'failed' ? 'negative' : 'warning'}>{t(run.status)}</Badge></div><p className="mt-1 text-muted">{t('summaryPurged')}: {run.purged_count} · {t('operations')}: {run.scanned_count}</p>{run.next_after_file_id && <p className="mt-1 break-all text-xs text-muted">{t('resumeCursor')}: {run.next_after_file_id}</p>}</div>)}</div></CardContent></Card></section>
    </> : null}
  </main></div>;
}
