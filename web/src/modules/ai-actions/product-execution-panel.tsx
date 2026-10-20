'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Loader2, Play, RefreshCw, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { apiErrorMessage, errorCode, fieldLabel } from './product-preview';
import { ExecutionImagesList } from './product-images-ui';
import { RepairEntry } from './product-repair-ui';
import {
  type Execution,
  type ExecutionRow,
  type RowStatus,
  ROW_TONE,
  currentLang,
  execText,
  isFinished,
  progressPercent,
  statusLabel,
} from './product-execution';

const PAGE_SIZE = 50;
const POLL_MS = 1500;
const MAX_POLLS = 40;

function key(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Props {
  actionId: string;
  version: number;
  /** ما سيُطبَّق بحسب المعاينة المعتمدة (للعرض في التأكيد). */
  totals: { create: number; update: number; skip: number };
  /** يُبلَّغ الأب بحالة الإجراء (`executing` … `executed`) ليمنع التعديل بعد البدء. */
  onStatus: (status: string) => void;
}

export function ProductExecutionPanel({ actionId, version, totals, onStatus }: Props) {
  const lang = currentLang();
  const text = execText(lang);
  const { error } = useToast();
  const confirm = useConfirm();
  const [execution, setExecution] = useState<Execution | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<RowStatus | 'all'>('all');
  const [notice, setNotice] = useState<string | null>(null);
  // يمنع الضغط المتكرر قبل أن يُعاد الرسم (حالة `busy` وحدها لا تكفي بين نقرتين متتاليتين).
  const driving = useRef(false);

  const publish = useCallback((next: Execution) => {
    setExecution(next);
    onStatus(next.status === 'running' ? 'executing' : next.status === 'completed' ? 'executed' : next.status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** يقود الدفعات حتى ينتهي التنفيذ: كل نداء بمفتاح جديد، فالتكرار الفعلي يمنعه الخادم لا الواجهة. */
  const drive = useCallback(async (first: () => Promise<{ data: Execution }>) => {
    if (driving.current) return;
    driving.current = true;
    setBusy(true);
    setNotice(null);
    try {
      let result = await first();
      publish(result.data);
      while (!isFinished(result.data.status)) {
        result = await api<{ data: Execution }>(`/ai-actions/${actionId}/executions?per_page=${PAGE_SIZE}`, {
          method: 'POST',
          headers: { 'Idempotency-Key': key('ai-exec') },
          body: { expected_version: version },
        });
        publish(result.data);
      }
    } catch (exception) {
      const body = exception instanceof ApiError ? exception.body : null;
      if (errorCode(body) === 'execution_in_progress') {
        setNotice(text.busyElsewhere);
        for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
          await wait(POLL_MS);
          const latest = await api<{ data: Execution }>(`/ai-actions/${actionId}/executions/latest?per_page=${PAGE_SIZE}`);
          publish(latest.data);
          if (isFinished(latest.data.status)) break;
        }
        setNotice(null);
      } else {
        error(apiErrorMessage(body, text.errorTitle));
      }
    } finally {
      driving.current = false;
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionId, version]);

  async function run() {
    if (driving.current) return;
    const ok = await confirm({ title: text.confirmTitle, message: text.confirm(totals.create, totals.update), confirmLabel: text.confirmLabel });
    if (!ok) return;
    await drive(() => api<{ data: Execution }>(`/ai-actions/${actionId}/executions?per_page=${PAGE_SIZE}`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key('ai-exec') },
      body: { expected_version: version },
    }));
  }

  async function retry() {
    if (!execution || driving.current) return;
    await drive(() => api<{ data: Execution }>(`/ai-actions/${actionId}/executions/${execution.id}/retry?per_page=${PAGE_SIZE}`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key('ai-retry') },
    }));
  }

  async function changeFilter(next: string) {
    const value = next as RowStatus | 'all';
    setFilter(value);
    if (!execution) return;
    const query = new URLSearchParams({ per_page: String(PAGE_SIZE) });
    if (value !== 'all') query.set('status', value);
    try {
      const result = await api<{ data: Execution }>(`/ai-actions/${actionId}/executions/${execution.id}?${query}`);
      setExecution(result.data);
    } catch (exception) {
      error(apiErrorMessage(exception instanceof ApiError ? exception.body : null, text.errorTitle));
    }
  }

  // عند إعادة فتح الصفحة على تنفيذ قائم نعرض حالته بدل زر بدء.
  useEffect(() => {
    let cancelled = false;
    void api<{ data: Execution }>(`/ai-actions/${actionId}/executions/latest?per_page=${PAGE_SIZE}`)
      .then((result) => { if (!cancelled) publish(result.data); })
      .catch(() => undefined);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionId]);

  const progress = execution?.progress;
  const done = progress ? progress.total - progress.pending : 0;
  const tabs = progress ? [
    { id: 'all', label: text.all, count: progress.total },
    { id: 'success', label: text.counts.success, count: progress.success },
    { id: 'failed', label: text.counts.failed, count: progress.failed, alert: progress.failed > 0, alertLabel: text.counts.failed },
    { id: 'skipped', label: text.counts.skipped, count: progress.skipped },
    { id: 'pending', label: text.counts.pending, count: progress.pending },
  ] : [];

  return (
    <Card data-testid="execution-box">
      <CardHeader><CardTitle as="h2" className="flex items-center gap-2 text-base text-text"><Play className="h-4 w-4" aria-hidden /> {text.title}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {!execution && <p className="text-sm">{text.intro}</p>}
        <div className="rounded border border-border bg-surface p-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4 text-warning" aria-hidden /> {text.deferredTitle}</p>
          <p className="mt-1 text-muted">{text.deferredBody}</p>
        </div>

        {!execution && (
          <Button onClick={() => void run()} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4 rtl:-scale-x-100" aria-hidden />} {text.run}
          </Button>
        )}

        {execution && progress && (
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span role="status" aria-live="polite">{busy || execution.status === 'running' ? text.running : ''} <span className="num">{text.progress(done, progress.total)}</span></span>
                <span className="num text-muted">{progressPercent(progress)}%</span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded bg-primary-soft" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent(progress)}>
                <div className="h-full bg-primary transition-[width]" style={{ width: `${progressPercent(progress)}%` }} />
              </div>
            </div>
            <ul className="flex flex-wrap gap-2 text-xs">
              {(['success', 'failed', 'skipped', 'pending'] as const).map((status) => (
                <li key={status}><Badge tone={ROW_TONE[status]}>{statusLabel(lang, status)} · <span className="num">{progress[status]}</span></Badge></li>
              ))}
            </ul>
            {execution.images.total > 0 && <p className="text-xs text-muted" data-testid="image-counts">{text.imageCounts(execution.images)}</p>}
            {notice && <p role="status" className="text-sm text-warning">{notice}</p>}
            {execution.status === 'completed' && <p role="status" className="flex items-center gap-2 rounded border border-positive/40 bg-positive/10 p-3 text-sm"><CheckCircle2 className="h-4 w-4 text-positive" aria-hidden /> {text.completed}</p>}
            {execution.status === 'partially_failed' && <p role="alert" className="flex items-center gap-2 rounded border border-warning/40 bg-warning/10 p-3 text-sm"><AlertTriangle className="h-4 w-4 text-warning" aria-hidden /> {text.partially}</p>}
            {execution.status === 'failed' && <p role="alert" className="flex items-center gap-2 rounded border border-negative/40 bg-negative/10 p-3 text-sm"><XCircle className="h-4 w-4 text-negative" aria-hidden /> {text.failed}</p>}

            {execution.status === 'running' && !busy && execution.permissions.can_continue && (
              <Button onClick={() => void drive(() => api<{ data: Execution }>(`/ai-actions/${actionId}/executions?per_page=${PAGE_SIZE}`, { method: 'POST', headers: { 'Idempotency-Key': key('ai-exec') }, body: { expected_version: version } }))}>
                <Play className="h-4 w-4 rtl:-scale-x-100" aria-hidden /> {text.run}
              </Button>
            )}
            {execution.permissions.can_retry && (
              <div className="space-y-1">
                <Button variant="outline" onClick={() => void retry()} disabled={busy}><RefreshCw className="h-4 w-4" aria-hidden /> {text.retry}</Button>
                <p className="text-xs text-muted">{text.retryHint(execution.permissions.retryable_rows, execution.permissions.retryable_images)}</p>
              </div>
            )}
            {isFinished(execution.status) && (progress.failed > 0 || execution.images.failed > 0) && !execution.permissions.can_retry && <p className="text-xs text-muted">{text.notRetryable}</p>}

            {isFinished(execution.status) && (progress.failed > 0 || execution.images.failed > 0) && (
              <RepairEntry actionId={actionId} executionId={execution.id} refreshKey={`${execution.retry_count}-${progress.failed}-${execution.images.failed}`} />
            )}

            <Tabs tabs={tabs} value={filter} onChange={(id) => void changeFilter(id)} />
            <ResultRows rows={execution.rows} lang={lang} actionId={actionId} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ResultRows({ rows, lang, actionId }: { rows: ExecutionRow[]; lang: 'ar' | 'en'; actionId: string }) {
  const text = execText(lang);
  return (
    <>
      <div className="hidden overflow-x-auto rounded border border-border md:block">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-primary-soft/40 text-muted"><tr>{text.columns.map((title) => <th key={title} scope="col" className="p-2 text-start font-medium">{title}</th>)}</tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.row_id} className="border-t border-border align-top">
                <td className="num p-2 text-muted">{row.source_row}</td>
                <td className="p-2"><RowName row={row} /></td>
                <td className="p-2">{text.operations[row.operation]}</td>
                <td className="p-2"><Badge tone={ROW_TONE[row.status]}>{statusLabel(lang, row.status)}</Badge></td>
                <td className="p-2"><RowDetails row={row} lang={lang} actionId={actionId} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li key={row.row_id} className="space-y-2 rounded border border-border bg-surface p-3 text-sm">
            <div className="flex items-start justify-between gap-2"><RowName row={row} /><Badge tone={ROW_TONE[row.status]}>{statusLabel(lang, row.status)}</Badge></div>
            <p className="text-xs text-muted">{text.operations[row.operation]} · <span className="num">{row.source_row}</span></p>
            <RowDetails row={row} lang={lang} actionId={actionId} />
          </li>
        ))}
      </ul>
    </>
  );
}

function RowName({ row }: { row: ExecutionRow }) {
  return (
    <div className="space-y-0.5">
      <bdi dir="auto" className="block font-medium">{row.display?.name ?? '—'}</bdi>
      <span className="block text-xs text-muted" dir="ltr">{row.display?.sku ?? row.display?.barcode ?? ''}</span>
    </div>
  );
}

function RowDetails({ row, lang, actionId }: { row: ExecutionRow; lang: 'ar' | 'en'; actionId: string }) {
  const text = execText(lang);
  return (
    <div className="space-y-1 text-xs">
      {row.status === 'failed' && row.error_message && (
        <p className="flex items-start gap-1.5 text-negative"><XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /><span>{row.error_message}{row.retryable ? ` (${text.retryable})` : ''}</span></p>
      )}
      {row.status === 'success' && row.product_id && (
        <p><Link className="text-primary underline" href={`/products/${row.product_id}`}>{text.openProduct}</Link></p>
      )}
      {row.status === 'success' && row.changed_fields.length > 0 && (
        <p className="text-muted">{text.changed}: {row.changed_fields.map((field) => fieldLabel(field)).join('، ')}</p>
      )}
      {row.deferred.length > 0 && (
        <p className="text-warning">{text.deferredRow}: {row.deferred.map((item) => text.deferredFields[item] ?? item).join(lang === 'ar' ? '، ' : ', ')}</p>
      )}
      {row.attempts > 1 && <p className="text-muted"><span className="num">{row.attempts}</span> {text.attempts}</p>}
      <ExecutionImagesList actionId={actionId} images={row.images ?? []} />
    </div>
  );
}
