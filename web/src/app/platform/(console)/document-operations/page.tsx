'use client';

import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, CheckCircle2, CircleAlert, Download, Layers, Loader2, Play, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/formatting';
import { isPlatformAuthenticated } from '@/lib/platform-auth';
import { platformApi, platformDownloadFile } from '@/lib/platform-api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

type Translate = (key: any, values?: any) => string;
type Count = { status: string; count: number };
type RetentionRun = { id: string; dry_run: boolean; status: string; cutoff_at: string | null; scanned_count: number; eligible_count: number; purged_count: number; skipped_count: number; after_file_id: string | null; next_after_file_id: string | null; created_at: string | null };
type Overview = {
  runtime: { queue_configured: boolean; worker_status: string; worker_last_seen_at: string | null; queued_runs: number; running_runs: number; failed_runs: number };
  batches_by_status: Count[];
  runs_by_status: Count[];
  retention: { retention_days: number; enabled: boolean; purge_mode: string; last_run: { id: string; status: string; dry_run: boolean; purged_count: number; finished_at: string | null } | null };
  retention_runs: RetentionRun[];
};
type RetentionRunResponse = { data: { run_id: string; dry_run: boolean; status: string; cutoff_at: string | null; after_file_id: string | null; next_after_file_id: string | null; results: { scanned: number; eligible: number; purged: number; skipped: number } } };
// `per_tenant` و`per_provider_model` تصل في الحمولة ولا تُعرض عمداً (المواصفة §12.7): الصفحة لإجماليات المنصة فقط.
type Usage = { range?: { from: string; to: string }; operations: number; pages: number; input_tokens: number; output_tokens: number; per_tenant: unknown[]; per_provider_model: unknown[] };
type Diagnostics = { runtime: { processing_mode?: string; queue_configured: boolean; worker_required?: boolean; worker_online: boolean; scanner_ready: boolean; provider_configured: boolean; provider_network_locked: boolean; runs: { queued: number; running: number; failed: number } } };
type Notice = { ok: boolean; message: string };

// الحالات المعروفة من الخادم (DocumentWorkflowStatus / DocumentProcessingStatus / DocumentRetentionRun). أي قيمة غير معروفة تُعرض كما وصلت.
const BATCH_STATUSES = ['draft', 'receiving', 'received', 'queued', 'processing', 'needs_review', 'reviewed', 'ready_for_draft', 'creating_draft', 'draft_created', 'archived', 'failed', 'quarantined', 'duplicate', 'cancelled'];
const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'];
const RETENTION_STATUSES = ['planned', 'completed', 'failed'];

function statusTone(status: string): 'positive' | 'negative' | 'warning' | 'muted' {
  if (status === 'failed') return 'negative';
  if (status === 'quarantined') return 'warning';
  if (status === 'succeeded' || status === 'completed' || status === 'draft_created') return 'positive';
  return 'muted';
}

function statusLabel(prefix: string, known: string[], status: string, t: Translate): string {
  return known.includes(status) ? t(`${prefix}${status}`) : status;
}

// تاريخ ISO داخل جملة RTL يُعزل يساراً-ليميناً فلا تنعكس خاناته.
const isolateLtr = (value: string): string => `\u2066${value}\u2069`;

function countFormatter(locale: string): Intl.NumberFormat {
  return new Intl.NumberFormat(locale.toLowerCase().startsWith('ar') ? 'ar-SA-u-nu-latn' : 'en-US');
}

export default function PlatformDocumentOperationsPage() {
  const t = useTranslations('documentOperations') as Translate;
  const locale = useLocale();
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
  const [notice, setNotice] = useState<Notice | null>(null);

  // 403 و404 بنص واضح؛ غيرهما برسالة الخادم أو النص الاحتياطي.
  const messageFor = useCallback((exception: unknown, fallback: string): string => {
    if (exception instanceof ApiError) {
      if (exception.status === 403) return t('platForbidden');
      if (exception.status === 404) return t('platNotFound');
      return exception.message || fallback;
    }
    return fallback;
  }, [t]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [operationsResponse, usageResponse, diagnosticResponse] = await Promise.all([
        platformApi<{ data: Overview }>('/platform/document-operations'),
        platformApi<{ data: Usage }>('/platform/document-usage'),
        platformApi<{ data: Diagnostics }>('/platform/document-diagnostics'),
      ]);
      setOverview(operationsResponse.data);
      setUsage(usageResponse.data);
      setDiagnostics(diagnosticResponse.data);
      setDays(String(operationsResponse.data.retention.retention_days));
      setEnabled(operationsResponse.data.retention.enabled);
      if (!resumeCursorInitialized.current) {
        setAfterFileId(operationsResponse.data.retention_runs[0]?.next_after_file_id ?? null);
        resumeCursorInitialized.current = true;
      }
    } catch (exception) {
      setError(messageFor(exception, t('platformLoadFailed')));
    } finally {
      setLoading(false);
    }
  }, [t, messageFor]);

  useEffect(() => {
    if (!isPlatformAuthenticated()) {
      router.replace('/platform/login');
      return;
    }
    void load();
  }, [load, router]);

  async function savePolicy() {
    setBusy('policy');
    setNotice(null);
    try {
      await platformApi('/platform/document-retention-policy', { method: 'PATCH', body: { retention_days: Number(days), enabled } });
      setNotice({ ok: true, message: t('policySaved') });
      await load();
    } catch (exception) {
      setNotice({ ok: false, message: messageFor(exception, t('platformActionFailed')) });
    } finally {
      setBusy(null);
    }
  }

  async function runRetention() {
    setBusy('run');
    setNotice(null);
    try {
      const response = await platformApi<RetentionRunResponse>('/platform/document-retention-runs', {
        method: 'POST',
        // The API's rule is `apply: accepted` whether or not the run is a dry run (a dry run without it is answered 422), so `apply`
        // is always sent. It cannot turn a dry run into a purge: the server reads `dry_run`, which stays true.
        body: { dry_run: dryRun, apply: dryRun ? true : confirmApply, ...(afterFileId ? { after_file_id: afterFileId } : {}) },
      });
      setAfterFileId(response.data.next_after_file_id);
      setNotice({ ok: true, message: response.data.next_after_file_id ? t('runCompletedResume') : t('runCompleted') });
      await load();
    } catch (exception) {
      setNotice({ ok: false, message: messageFor(exception, t('platformActionFailed')) });
    } finally {
      setBusy(null);
    }
  }

  async function exportAudit() {
    setBusy('export');
    setNotice(null);
    try {
      const outcome = await platformDownloadFile('/platform/document-audit/export', 'platform-document-audit.csv');
      setNotice({ ok: true, message: outcome === 'downloaded' ? t('exported') : t('exportDemoUnavailable') });
    } catch (exception) {
      setNotice({ ok: false, message: messageFor(exception, t('platformActionFailed')) });
    } finally {
      setBusy(null);
    }
  }

  const numbers = countFormatter(locale);
  const daysValid = /^\d+$/.test(days) && Number(days) >= 1 && Number(days) <= 3650;
  const anyBusy = busy !== null;
  const hasData = overview !== null && usage !== null && diagnostics !== null;
  const workerNotRequired = diagnostics?.runtime.worker_required === false || diagnostics?.runtime.processing_mode === 'sync';

  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6 lg:px-8" aria-busy={loading}>
      <header className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-text">{t('platformTitle')}</h1>
          <p className="mt-1 text-sm text-muted">{t('platformSubtitle')}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{t('platScopeNote')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-11" disabled={anyBusy} onClick={() => void exportAudit()}>
            {busy === 'export' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
            {t('exportAudit')}
          </Button>
          <Button variant="outline" className="h-11" disabled={loading} onClick={() => void load()}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            {t('refresh')}
          </Button>
        </div>
      </header>

      {notice && (
        <div
          role={notice.ok ? 'status' : 'alert'}
          aria-atomic="true"
          className={`flex items-start gap-2 rounded border px-3 py-2 text-sm ${notice.ok ? 'border-primary/20 bg-primary-soft text-text' : 'border-negative/40 bg-surface text-negative'}`}
        >
          {notice.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-positive" aria-hidden="true" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
          <span className="min-w-0 break-words">{notice.message}</span>
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="flex flex-wrap items-start gap-3 py-5">
            <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-negative" aria-hidden="true" />
            <p role="alert" className="min-w-0 flex-1 text-sm text-negative">{error}</p>
            <Button variant="outline" className="h-11" onClick={() => void load()}>{t('retry')}</Button>
          </CardContent>
        </Card>
      )}

      {!hasData && !error && (
        <div className="space-y-5" data-testid="document-ops-skeleton">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-24" />)}</div>
          <div className="grid gap-5 xl:grid-cols-2"><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
        </div>
      )}

      {hasData && overview && usage && diagnostics && (
        <>
          <section aria-label={t('runtime')} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Card className="min-w-0"><CardContent className="py-4">
              <p className="text-xs text-muted">{t('processingMode')}</p>
              <Badge className="mt-2" tone={diagnostics.runtime.processing_mode === 'sync' ? 'neutral' : 'positive'}>{diagnostics.runtime.processing_mode === 'sync' ? t('processingModeSync') : t('processingModeAsync')}</Badge>
            </CardContent></Card>
            <Card className="min-w-0"><CardContent className="py-4">
              <p className="text-xs text-muted">{t('queueWorker')}</p>
              <Badge className="mt-2" tone={workerNotRequired ? 'muted' : diagnostics.runtime.worker_online ? 'positive' : 'warning'}>{workerNotRequired ? t('workerNotRequired') : diagnostics.runtime.worker_online ? t('workerOnline') : t('workerOffline')}</Badge>
            </CardContent></Card>
            <Card className="min-w-0"><CardContent className="py-4">
              <p className="text-xs text-muted">{t('networkLocked')}</p>
              <Badge className="mt-2" tone={diagnostics.runtime.provider_network_locked ? 'warning' : 'positive'}>{diagnostics.runtime.provider_network_locked ? t('networkLocked') : t('networkOpen')}</Badge>
            </CardContent></Card>
            <Card className="min-w-0"><CardContent className="py-4">
              <p className="text-xs text-muted">{t('processing')}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{numbers.format(diagnostics.runtime.runs.running)}</p>
              <p className="mt-1 text-xs text-muted">{t('platQueued')}: <span className="tabular-nums">{numbers.format(diagnostics.runtime.runs.queued)}</span> · {t('failed')}: <span className="tabular-nums">{numbers.format(diagnostics.runtime.runs.failed)}</span></p>
            </CardContent></Card>
          </section>

          <section aria-labelledby="doc-ops-states" className="space-y-3">
            <h2 id="doc-ops-states" className="sr-only">{t('platStatesTitle')}</h2>
            <div className="grid gap-5 xl:grid-cols-2">
              <StatusList title={t('platBatches')} rows={overview.batches_by_status} prefix="platBatch_" known={BATCH_STATUSES} empty={t('platBatchesEmpty')} t={t} numbers={numbers} />
              <StatusList title={t('platRuns')} rows={overview.runs_by_status} prefix="platRun_" known={RUN_STATUSES} empty={t('platRunsEmpty')} t={t} numbers={numbers} />
            </div>
          </section>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card className="min-w-0"><CardContent className="space-y-4 py-4">
              <div className="flex gap-2"><ShieldCheck className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" /><h2 className="font-medium">{t('retention')}</h2></div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-ops-days">{t('retentionDaysLabel')}</Label>
                <input
                  id="doc-ops-days"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="3650"
                  value={days}
                  onChange={(event) => setDays(event.target.value)}
                  aria-invalid={!daysValid || undefined}
                  aria-describedby="doc-ops-days-hint"
                  dir="ltr"
                  className="h-11 w-full rounded border border-border bg-surface px-3 text-sm text-text"
                />
                <p id="doc-ops-days-hint" className={`text-xs ${daysValid ? 'text-muted' : 'text-negative'}`}>{t('platDaysHint')}</p>
              </div>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
                {t('policyEnabled')}
              </label>
              <Button className="h-11 w-full sm:w-auto" disabled={anyBusy || !daysValid} onClick={() => void savePolicy()}>
                {busy === 'policy' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                {t('savePolicy')}
              </Button>
            </CardContent></Card>

            <Card className="min-w-0"><CardContent className="space-y-4 py-4">
              <div className="flex gap-2"><Activity className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" /><h2 className="font-medium">{t('retentionRuns')}</h2></div>
              {!overview.retention.enabled && <p role="note" className="rounded border border-warning/40 px-3 py-2 text-xs leading-relaxed text-warning">{t('platPolicyDisabledNote')}</p>}
              <p className="break-all text-xs text-muted">{afterFileId ? `${t('resumeCursor')}: ${afterFileId}` : t('resumeFromStart')}</p>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={dryRun} onChange={(event) => { setDryRun(event.target.checked); setConfirmApply(false); }} />
                {t('dryRun')}
              </label>
              <p className="text-xs leading-relaxed text-muted">{dryRun ? t('platDryEffect') : t('platApplyEffect')}</p>
              {!dryRun && (
                <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded border border-warning/40 px-3 py-2 text-sm">
                  <input className="mt-1 h-4 w-4 accent-primary" type="checkbox" checked={confirmApply} onChange={(event) => setConfirmApply(event.target.checked)} />
                  <span>{t('confirmApply')}</span>
                </label>
              )}
              <Button className="h-11 w-full sm:w-auto" disabled={anyBusy || (!dryRun && !confirmApply)} onClick={() => void runRetention()}>
                {busy === 'run' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
                {dryRun ? t('runRetention') : t('applyRun')}
              </Button>
              <LastRun lastRun={overview.retention.last_run} locale={locale} t={t} numbers={numbers} />
            </CardContent></Card>
          </div>

          <section className="grid gap-5 xl:grid-cols-2">
            <Card className="min-w-0"><CardContent className="py-4">
              <h2 className="font-medium">{t('platformUsage')}</h2>
              {usage.range && <p className="mt-1 text-xs text-muted">{t('platPeriod', { from: isolateLtr(usage.range.from), to: isolateLtr(usage.range.to) })}</p>}
              <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Metric label={t('operations')} value={numbers.format(usage.operations)} />
                <Metric label={t('pages')} value={numbers.format(usage.pages)} />
                <Metric label={t('inputTokens')} value={numbers.format(usage.input_tokens)} />
                <Metric label={t('outputTokens')} value={numbers.format(usage.output_tokens)} />
              </dl>
            </CardContent></Card>

            <Card className="min-w-0"><CardContent className="py-4">
              <div className="flex gap-2"><Layers className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" /><h2 className="font-medium">{t('platRunHistory')}</h2></div>
              <ul className="mt-3 space-y-2" aria-busy={loading}>
                {overview.retention_runs.length === 0 ? <li className="text-sm text-muted">{t('notRun')}</li> : overview.retention_runs.map((run) => (
                  <li key={run.id} className="space-y-2 rounded border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs" dir="ltr">{run.id.slice(0, 12)}</span>
                      <span className="flex flex-wrap gap-1.5">
                        <Badge tone="muted">{run.dry_run ? t('platRunDry') : t('platRunApplied')}</Badge>
                        <Badge tone={statusTone(run.status)}>{statusLabel('platRet_', RETENTION_STATUSES, run.status, t)}</Badge>
                      </span>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
                      <Metric small label={t('platScanned')} value={numbers.format(run.scanned_count)} />
                      <Metric small label={t('platEligible')} value={numbers.format(run.eligible_count)} />
                      <Metric small label={t('summaryPurged')} value={numbers.format(run.purged_count)} />
                      <Metric small label={t('platSkipped')} value={numbers.format(run.skipped_count)} />
                    </dl>
                    {run.created_at && <p className="text-xs text-muted">{t('platCreatedAt')}: <bdi>{formatDateTime(run.created_at, locale)}</bdi></p>}
                    {run.cutoff_at && <p className="text-xs text-muted">{t('platCutoff')}: <bdi>{formatDateTime(run.cutoff_at, locale)}</bdi></p>}
                    {run.next_after_file_id && <p className="break-all text-xs text-muted">{t('resumeCursor')}: {run.next_after_file_id}</p>}
                  </li>
                ))}
              </ul>
            </CardContent></Card>
          </section>
        </>
      )}
    </main>
  );
}

function Metric({ label, value, small = false }: { label: string; value: string; small?: boolean }): JSX.Element {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`tabular-nums break-all ${small ? 'text-sm font-medium' : 'text-xl font-semibold'}`}>{value}</dd>
    </div>
  );
}

function StatusList({ title, rows, prefix, known, empty, t, numbers }: { title: string; rows: Count[]; prefix: string; known: string[]; empty: string; t: Translate; numbers: Intl.NumberFormat }): JSX.Element {
  return (
    <Card className="min-w-0"><CardContent className="py-4">
      <h2 className="font-medium">{title}</h2>
      {rows.length === 0 ? <p className="mt-3 text-sm text-muted">{empty}</p> : (
        <ul className="mt-3 divide-y divide-border">
          {rows.map((row) => (
            <li key={row.status} className="flex items-center justify-between gap-3 py-2 text-sm">
              <Badge className="min-w-0 max-w-full whitespace-normal break-all" tone={statusTone(row.status)}>{statusLabel(prefix, known, row.status, t)}</Badge>
              <span className="font-semibold tabular-nums">{numbers.format(row.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </CardContent></Card>
  );
}

function LastRun({ lastRun, locale, t, numbers }: { lastRun: Overview['retention']['last_run']; locale: string; t: Translate; numbers: Intl.NumberFormat }): JSX.Element {
  if (!lastRun) return <p className="border-t border-border pt-3 text-xs text-muted">{t('notRun')}</p>;
  // لا نعرض أجزاء فارغة (حالة غير واردة) حتى لا يظهر فاصل يتيم.
  const parts: React.ReactNode[] = [
    lastRun.status ? statusLabel('platRet_', RETENTION_STATUSES, lastRun.status, t) : null,
    lastRun.dry_run ? t('platRunDry') : t('platRunApplied'),
    <span key="purged">{t('summaryPurged')}: <span className="tabular-nums">{numbers.format(lastRun.purged_count)}</span></span>,
    lastRun.finished_at ? <bdi key="finished">{formatDateTime(lastRun.finished_at, locale)}</bdi> : null,
  ].filter(Boolean);
  return (
    <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted">
      {t('platLastRun')}: {parts.map((part, index) => <span key={index}>{index > 0 ? ' · ' : ''}{part}</span>)}
    </p>
  );
}
