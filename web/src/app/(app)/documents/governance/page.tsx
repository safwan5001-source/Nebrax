'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CircleAlert, Download, ShieldCheck, ShieldOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { api, ApiError, downloadFile } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DocumentOperationsNav } from '@/components/documents/document-operations-nav';

type Hold = { id: string; batch_id: string | null; file_id: string | null; reason_code: string; created_at: string | null; released_at: string | null; release_reason_code: string | null };
type Overlay = { id: string; result_id: string; field_path: string; reason_code: string; redacted_at: string | null };
type Governance = { policy: { retention_days: number; enabled: boolean; purge_mode: string; policy_source: string; last_run_at: string | null }; active_holds: Hold[]; redactions: Overlay[]; redaction_fields: string[] };
const holdReasons = ['legal_review', 'operational_investigation', 'customer_request', 'compliance_review'];
const releaseReasons = ['review_completed', 'hold_no_longer_required', 'entered_in_error'];
const redactionReasons = ['privacy_request', 'legal_review', 'sensitive_metadata', 'operational_restriction'];

export default function DocumentGovernancePage() {
  const t = useTranslations('documentOperations');
  const [data, setData] = useState<Governance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [batchId, setBatchId] = useState('');
  const [fileId, setFileId] = useState('');
  const [holdReason, setHoldReason] = useState(holdReasons[0]);
  const [resultId, setResultId] = useState('');
  const [fieldPath, setFieldPath] = useState('');
  const [redactionReason, setRedactionReason] = useState(redactionReasons[0]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData((await api<{ data: Governance }>('/document-governance')).data); }
    catch (exception) { setError(exception instanceof ApiError ? exception.message : t('loadFailed')); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  async function createHold(event: FormEvent) {
    event.preventDefault(); setBusy(true); setNotice(null);
    try {
      await api('/document-retention-holds', { method: 'POST', body: { document_batch_id: batchId || undefined, file_id: fileId || undefined, reason_code: holdReason } });
      setBatchId(''); setFileId(''); setNotice(t('holdCreated')); await load();
    } catch (exception) { setNotice(exception instanceof ApiError ? exception.message : t('governanceFailed')); }
    finally { setBusy(false); }
  }
  async function release(hold: Hold) {
    setBusy(true); setNotice(null);
    try { await api(`/document-retention-holds/${hold.id}/release`, { method: 'POST', body: { reason_code: releaseReasons[0] } }); setNotice(t('holdReleased')); await load(); }
    catch (exception) { setNotice(exception instanceof ApiError ? exception.message : t('governanceFailed')); }
    finally { setBusy(false); }
  }
  async function redact(event: FormEvent) {
    event.preventDefault(); setBusy(true); setNotice(null);
    try { await api('/document-redactions', { method: 'POST', body: { document_extraction_result_id: resultId, field_path: fieldPath, reason_code: redactionReason } }); setResultId(''); setNotice(t('redactionCreated')); await load(); }
    catch (exception) { setNotice(exception instanceof ApiError ? exception.message : t('governanceFailed')); }
    finally { setBusy(false); }
  }
  async function auditExport() {
    setNotice(null);
    try { if (await downloadFile('/document-audit/export', 'document-audit.csv') === 'downloaded') setNotice(t('exported')); }
    catch (exception) { setNotice(exception instanceof ApiError ? exception.message : t('governanceFailed')); }
  }

  return <div className="space-y-5">
    <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between"><div><h1 className="text-xl font-semibold text-text">{t('governanceTitle')}</h1><p className="mt-1 text-sm text-muted">{t('governanceSubtitle')}</p></div><Button variant="outline" onClick={() => void auditExport()}><Download className="h-4 w-4" aria-hidden="true" />{t('exportAudit')}</Button></header>
    <DocumentOperationsNav />
    {notice && <div role="status" className="rounded border border-primary/20 bg-primary-soft px-3 py-2 text-sm text-text">{notice}</div>}
    {loading ? <Card><CardContent className="py-10 text-sm text-muted">{t('loading')}</CardContent></Card> : error ? <Card><CardContent className="flex items-center gap-3 py-10 text-sm text-muted"><CircleAlert className="h-5 w-5" aria-hidden="true" />{error}<Button variant="outline" onClick={() => void load()}>{t('retry')}</Button></CardContent></Card> : data ? <>
      <Card><CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" /><div><h2 className="font-medium text-text">{t('retention')}</h2><p className="mt-1 text-sm text-muted">{t('retentionDays', { days: data.policy.retention_days })} · {t('purgeMode')}</p><p className="mt-1 text-xs text-muted">{t('lastRun')}: {data.policy.last_run_at ?? t('notRun')}</p></div></div><Badge tone={data.policy.enabled ? 'positive' : 'warning'}>{data.policy.enabled ? t('retentionEnabled') : t('retentionDisabled')}</Badge></CardContent></Card>
      <div className="grid gap-5 xl:grid-cols-2"><Card><CardContent className="py-4"><h2 className="font-medium text-text">{t('activeHolds')}</h2><form className="mt-4 grid gap-2" onSubmit={createHold}><label className="grid gap-1 text-sm text-text"><span>{t('batchId')}</span><input value={batchId} onChange={(e) => setBatchId(e.target.value)} className="h-10 rounded border border-border bg-surface px-3" /></label><label className="grid gap-1 text-sm text-text"><span>{t('fileId')}</span><input value={fileId} onChange={(e) => setFileId(e.target.value)} className="h-10 rounded border border-border bg-surface px-3" /></label><label className="grid gap-1 text-sm text-text"><span>{t('reason')}</span><select value={holdReason} onChange={(e) => setHoldReason(e.target.value)} className="h-10 rounded border border-border bg-surface px-3">{holdReasons.map((reason) => <option key={reason}>{reason}</option>)}</select></label><Button disabled={busy || (!batchId && !fileId)}>{t('createHold')}</Button></form><div className="mt-5 space-y-2">{data.active_holds.length === 0 ? <p className="text-sm text-muted">{t('noHolds')}</p> : data.active_holds.map((hold) => <div key={hold.id} className="flex flex-col gap-2 rounded border border-border p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="font-mono text-xs text-text">{(hold.file_id ?? hold.batch_id ?? hold.id).slice(0, 12)}</p><p className="text-sm text-muted">{hold.reason_code}</p></div><Button size="sm" variant="outline" disabled={busy} onClick={() => void release(hold)}><ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />{t('releaseHold')}</Button></div>)}</div></CardContent></Card>
      <Card><CardContent className="py-4"><h2 className="font-medium text-text">{t('redactions')}</h2><form className="mt-4 grid gap-2" onSubmit={redact}><label className="grid gap-1 text-sm text-text"><span>{t('resultId')}</span><input value={resultId} onChange={(e) => setResultId(e.target.value)} className="h-10 rounded border border-border bg-surface px-3" /></label><label className="grid gap-1 text-sm text-text"><span>{t('fieldPath')}</span><select value={fieldPath} onChange={(e) => setFieldPath(e.target.value)} className="h-10 rounded border border-border bg-surface px-3"><option value="">{t('selectReason')}</option>{data.redaction_fields.map((field) => <option key={field}>{field}</option>)}</select></label><label className="grid gap-1 text-sm text-text"><span>{t('reason')}</span><select value={redactionReason} onChange={(e) => setRedactionReason(e.target.value)} className="h-10 rounded border border-border bg-surface px-3">{redactionReasons.map((reason) => <option key={reason}>{reason}</option>)}</select></label><Button disabled={busy || !resultId || !fieldPath}>{t('createRedaction')}</Button></form><div className="mt-5 space-y-2">{data.redactions.length === 0 ? <p className="text-sm text-muted">{t('noRedactions')}</p> : data.redactions.map((overlay) => <div key={overlay.id} className="rounded border border-border p-3"><p className="font-mono text-xs text-text">{overlay.result_id.slice(0, 12)}</p><p className="mt-1 text-sm text-muted">{overlay.field_path} · {overlay.reason_code}</p></div>)}</div></CardContent></Card></div>
    </> : null}
  </div>;
}
