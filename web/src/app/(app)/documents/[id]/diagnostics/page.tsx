'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CircleAlert, Stethoscope } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { api, ApiError } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DocumentOperationsNav } from '@/components/documents/document-operations-nav';

type Diagnostics = { schema_version: string; generated_at: string; scope: { tenant_id: string; branch_id: string }; document: { batch_id: string; workflow_status: string; processing_status: { key: string; message: string; retry_available: boolean }; files: { file_id: string; scan_status: string; purged_at: string | null }[]; processing_runs: { run_id: string; stage: string; status: string; attempt_count: number; safe_error_code: string | null; safe_error_message: string | null }[]; linked_transactions: { type: string; id: string; status: string }[] }; retention: { enabled: boolean; retention_days: number; active_hold_count: number } };

export default function DocumentDiagnosticsPage() {
  const t = useTranslations('documentOperations');
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData((await api<{ data: Diagnostics }>(`/document-batches/${params.id}/diagnostics`)).data); }
    catch (exception) { setError(exception instanceof ApiError ? exception.message : t('loadFailed')); }
    finally { setLoading(false); }
  }, [params.id, t]);
  useEffect(() => { void load(); }, [load]);

  return <div className="space-y-5"><header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-xl font-semibold text-text">{t('diagnosticsTitle')}</h1><p className="mt-1 text-sm text-muted">{t('diagnosticsSubtitle')}</p></div><Button asChild variant="outline"><Link href={`/documents/${params.id}`}>{t('viewReview')}</Link></Button></header><DocumentOperationsNav />
    {loading ? <Card><CardContent className="py-10 text-sm text-muted">{t('loading')}</CardContent></Card> : error ? <Card><CardContent className="flex flex-wrap items-center gap-3 py-10 text-sm text-muted"><CircleAlert className="h-5 w-5" aria-hidden="true" />{error}<Button variant="outline" onClick={() => void load()}>{t('retry')}</Button></CardContent></Card> : data ? <><Card><CardContent className="flex gap-3 py-4"><Stethoscope className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" /><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-medium text-text">{data.schema_version}</h2><Badge tone={data.document.processing_status.retry_available ? 'warning' : 'neutral'}>{data.document.workflow_status}</Badge></div><p className="mt-1 text-sm text-muted">{data.document.processing_status.message}</p></div></CardContent></Card><section className="grid gap-3 lg:grid-cols-3"><Card><CardContent className="py-4"><p className="text-xs text-muted">{t('batch')}</p><p className="mt-1 font-mono text-sm text-text">{data.document.batch_id}</p></CardContent></Card><Card><CardContent className="py-4"><p className="text-xs text-muted">{t('retention')}</p><p className="mt-1 text-sm text-text">{t('retentionDays', { days: data.retention.retention_days })}</p></CardContent></Card><Card><CardContent className="py-4"><p className="text-xs text-muted">{t('activeHolds')}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-text">{data.retention.active_hold_count}</p></CardContent></Card></section><Card><CardContent className="py-4"><h2 className="font-medium text-text">{t('processing')}</h2>{data.document.processing_runs.length === 0 ? <p className="mt-3 text-sm text-muted">{t('empty')}</p> : <div className="mt-3 space-y-2">{data.document.processing_runs.map((run) => <div key={run.run_id} className="rounded border border-border p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-xs text-text">{run.run_id.slice(0, 12)}</span><Badge tone={run.status === 'failed' ? 'negative' : 'muted'}>{run.stage} · {run.status}</Badge></div>{run.safe_error_message && <p className="mt-2 text-muted">{run.safe_error_message}</p>}</div>)}</div>}</CardContent></Card></> : null}
  </div>;
}
