'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Camera, Download, FileText, FileUp, History, Replace, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/formatting';
import { prepareImage } from '@/modules/station-ops/receiving/attachments';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { downloadAttachment, listAttachments, previewUrl, removeAttachment, replaceAttachment, uploadAttachment } from './client';
import {
  acceptAttr, blockKey, checkFiles, formatBytes, imageAcceptAttr, megabytes, mergeRows, reasonKey, SAFE_POLICY,
  type AttachmentState, type FileRejection, type FillAttachment,
} from './logic';

type Phase = 'loading' | 'ready' | 'error' | 'unavailable';
type QueueStatus = 'uploading' | 'error';
interface QueueItem { key: number; file: File; status: QueueStatus; message?: string }

const FALLBACK_STATE: AttachmentState = {
  policy: SAFE_POLICY, active_count: 0, status: 'none', can_add: false, add_blocked_reason: null, can_remove: false, remove_blocked_reason: null, can_view_history: false,
};

/**
 * TANKER-PR5 — مكوّن مرفقات سند تعبئة صهريج **قابل لإعادة الاستخدام** (يُوصَل بصفحة تفاصيل السند في ERP وبتطبيق المحطات PR-7): التقاط صورة السند بكاميرا الآيفون أو اختيارها من الملفات،
 * معاينة وتكبير وتنزيل، وإزالة/استبدال بسبب. **الخادم هو السلطة** (الصلاحيات والسياسة والمحتوى): المكوّن يعرض ما يعلنه `meta` ولا يستنتج. دليل فقط — لا يغيّر السند ولا يمسّ مخزوناً أو محاسبة.
 * يعتمد `useToast()` (مزوّد التنبيهات) و`useTranslations('fuelTankers')`. لا يقرأ تخزين المتصفح.
 */
export function TankerFillAttachments({ fillId, onCountChange }: { fillId: string; onCountChange?: (activeCount: number) => void }) {
  const t = useTranslations('fuelTankers.attachments');
  const locale = useLocale();
  const { success } = useToast();
  const [phase, setPhase] = useState<Phase>('loading');
  const [rows, setRows] = useState<FillAttachment[]>([]);
  const [state, setState] = useState<AttachmentState>(FALLBACK_STATE);
  const [history, setHistory] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [viewing, setViewing] = useState<FillAttachment | null>(null);
  const [removing, setRemoving] = useState<FillAttachment | null>(null);
  const [replacing, setReplacing] = useState<{ row: FillAttachment; busy: boolean; error: string | null } | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<FillAttachment | null>(null);
  const sequence = useRef(0);
  const keys = useRef(0);
  const working = useRef(false);

  const apply = useCallback((next: { rows?: FillAttachment[]; state: AttachmentState }, merge = false) => {
    // رد الرفع يحمل الصفوف المرفوعة في ذلك الطلب وحدها (لا كل مرفقات السند) ⇒ تُدمج بالمعرّف ولا تستبدل القائمة المعروضة.
    if (next.rows) { const incoming = next.rows; setRows((current) => (merge ? mergeRows(current, incoming) : incoming)); }
    setState(next.state);
    onCountChange?.(next.state.active_count);
  }, [onCountChange]);

  const load = useCallback(async (withHistory: boolean) => {
    const mine = ++sequence.current;
    try {
      const result = await listAttachments(fillId, withHistory);
      if (mine !== sequence.current) return;
      apply(result);
      setPhase('ready');
    } catch (error) {
      if (mine !== sequence.current) return;
      setPhase(error instanceof ApiError && (error.status === 404 || error.status === 403) ? 'unavailable' : 'error');
    }
  }, [fillId, apply]);

  useEffect(() => { setPhase('loading'); void load(history); return () => { sequence.current += 1; }; }, [load, history]);

  const message = useCallback((error: unknown): string => {
    const body = error instanceof ApiError && typeof error.body === 'object' && error.body !== null ? (error.body as { reason?: unknown; details?: { max_bytes?: number; max_count?: number } }) : null;
    const key = reasonKey(body?.reason);
    if (key !== null) return t(`errors.${key}`, { mb: megabytes(body?.details?.max_bytes ?? state.policy.max_bytes), count: body?.details?.max_count ?? state.policy.max_count });
    if (error instanceof ApiError && error.status === 0) return t('errors.offline');
    return t('errors.generic');
  }, [t, state.policy.max_bytes, state.policy.max_count]);

  async function sendQueue(items: QueueItem[]) {
    if (working.current) return;
    working.current = true;
    try {
      for (const item of items) {
        setQueue((current) => current.map((q) => (q.key === item.key ? { ...q, status: 'uploading', message: undefined } : q)));
        try {
          const result = await uploadAttachment(fillId, item.file);
          setQueue((current) => current.filter((q) => q.key !== item.key));
          apply({ rows: history ? undefined : result.rows, state: result.state }, true);
          if (history) void load(true);
        } catch (error) {
          // فشل شبكة/خادم: يبقى الملف في القائمة بسببه مع «إعادة المحاولة»؛ لا إعادة إرسال تلقائية (الخادم idempotent بالمحتوى إن أُعيد).
          setQueue((current) => current.map((q) => (q.key === item.key ? { ...q, status: 'error', message: message(error) } : q)));
        }
      }
    } finally {
      working.current = false;
    }
  }

  async function picked(event: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(event.target.files ?? []);
    event.target.value = ''; // يسمح باختيار الملف نفسه مجدداً
    if (list.length === 0 || working.current) return;
    const prepared = await Promise.all(list.map((file) => prepareImage(file)));
    const { accepted, rejected } = checkFiles(prepared, state.policy, state.active_count, queue.length);
    setNotes(rejected.map((r) => t(`rejected.${r.reason satisfies FileRejection}`, { name: r.name, mb: megabytes(state.policy.max_bytes), count: state.policy.max_count })));
    const items = accepted.map((file) => ({ key: ++keys.current, file, status: 'uploading' as QueueStatus }));
    if (items.length === 0) return;
    setQueue((current) => [...current, ...items]);
    void sendQueue(items);
  }

  async function replacePicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const row = replaceTarget.current;
    event.target.value = '';
    if (!file || !row) return;
    const [ready] = await Promise.all([prepareImage(file)]);
    const check = checkFiles([ready], state.policy, 0);
    if (check.accepted.length === 0) {
      setReplacing({ row, busy: false, error: t(`rejected.${check.rejected[0].reason}`, { name: ready.name, mb: megabytes(state.policy.max_bytes), count: state.policy.max_count }) });
      return;
    }
    setReplacing({ row, busy: true, error: null });
    try {
      const result = await replaceAttachment(fillId, row.id, ready);
      setState(result.state);
      onCountChange?.(result.state.active_count);
      success(t('replaced'));
      setReplacing(null);
      void load(history);
    } catch (error) {
      setReplacing({ row, busy: false, error: message(error) });
    }
  }

  const retry = (item: QueueItem) => void sendQueue([item]);
  const dismiss = (item: QueueItem) => setQueue((current) => current.filter((q) => q.key !== item.key));

  const active = useMemo(() => rows.filter((row) => row.status === 'active'), [rows]);
  const past = useMemo(() => rows.filter((row) => row.status !== 'active'), [rows]);
  const uploading = queue.some((q) => q.status === 'uploading');

  if (phase === 'loading') return <p role="status" className="text-sm text-muted">{t('loading')}</p>;
  if (phase === 'unavailable') return <p role="note" className="text-sm text-muted">{t('unavailable')}</p>;
  if (phase === 'error') return (
    <div role="alert" className="space-y-2 rounded-md border border-border p-3">
      <p className="text-sm text-negative">{t('loadFailed')}</p>
      <Button type="button" variant="outline" className="max-md:min-h-11" onClick={() => void load(history)}>{t('retry')}</Button>
    </div>
  );

  const blocked = blockKey(state.add_blocked_reason);
  const removeBlocked = blockKey(state.remove_blocked_reason);
  const buttonClass = 'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50';
  const canPick = state.can_add && !uploading;

  return (
    <section aria-label={t('title')} data-tanker-fill-attachments="" className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-text">{t('title')}</h3>
        <Badge tone={state.status === 'present' ? 'positive' : state.status === 'missing' ? 'warning' : 'neutral'} data-attachment-status={state.status}>
          {t(`status.${state.status}`, { count: state.active_count })}
        </Badge>
      </header>
      <p className="text-xs text-muted">{t('policy', { mb: megabytes(state.policy.max_bytes), count: state.policy.max_count })}</p>
      {state.status === 'missing' ? <p role="note" className="rounded-md border border-border bg-primary-soft px-3 py-2 text-sm text-text">{t('missingNote')}</p> : null}

      {state.can_add ? (
        <div className="grid grid-cols-2 gap-2.5">
          <input ref={camera} type="file" accept={imageAcceptAttr(state.policy)} capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" data-camera-input="" onChange={(event) => void picked(event)} />
          <input ref={library} type="file" accept={acceptAttr(state.policy)} multiple className="sr-only" tabIndex={-1} aria-hidden="true" data-file-input="" onChange={(event) => void picked(event)} />
          <button type="button" disabled={!canPick} onClick={() => camera.current?.click()} className={buttonClass} data-take-photo="">
            <Camera aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />{t('takePhoto')}
          </button>
          <button type="button" disabled={!canPick} onClick={() => library.current?.click()} className={buttonClass} data-choose-file="">
            <FileUp aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />{t('chooseFile')}
          </button>
        </div>
      ) : blocked !== null ? (
        <p role="note" className="rounded-md border border-border bg-primary-soft px-3 py-2 text-sm text-text" data-add-blocked={blocked}>{t(`blocked.add.${blocked}`, { count: state.policy.max_count })}</p>
      ) : null}

      {notes.length > 0 ? (
        <ul role="alert" className="list-disc space-y-1 ps-5 text-sm text-negative">{notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
      ) : null}

      {queue.length > 0 ? (
        <ul className="space-y-2" aria-live="polite" data-upload-queue="">
          {queue.map((item) => (
            <li key={item.key} className="space-y-1 rounded-md border border-border p-2.5">
              <p className="flex items-center justify-between gap-2 text-sm text-text"><bdi className="truncate">{item.file.name}</bdi><span className="num shrink-0 text-xs text-muted">{formatBytes(item.file.size)}</span></p>
              {item.status === 'uploading' ? (
                <progress className="h-2 w-full accent-[var(--primary)]" aria-label={t('uploading', { name: item.file.name })} />
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <p role="alert" className="flex-1 text-sm text-negative">{item.message}</p>
                  <Button type="button" variant="outline" className="max-md:min-h-11" disabled={uploading} onClick={() => retry(item)}>{t('retry')}</Button>
                  <Button type="button" variant="outline" className="max-md:min-h-11" onClick={() => dismiss(item)}>{t('dismiss')}</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {active.length === 0 && queue.length === 0 ? <p className="text-sm text-muted" data-attachments-empty="">{t('empty')}</p> : null}
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3" data-attachment-list="">
        {active.map((row) => (
          <li key={row.id} data-attachment={row.id}>
            <AttachmentCard fillId={fillId} row={row} onOpen={() => setViewing(row)} />
          </li>
        ))}
      </ul>

      {state.can_view_history ? (
        <div className="space-y-2">
          <Button type="button" variant="outline" className="max-md:min-h-11" onClick={() => setHistory((current) => !current)} aria-pressed={history} data-history-toggle="">
            <History aria-hidden="true" className="h-4 w-4" />{history ? t('hideHistory') : t('showHistory')}
          </Button>
          {history && past.length === 0 ? <p className="text-sm text-muted">{t('noHistory')}</p> : null}
          {history && past.length > 0 ? (
            <ul className="space-y-2" data-attachment-history="">
              {past.map((row) => (
                <li key={row.id} className="space-y-1 rounded-md border border-border p-2.5 text-sm">
                  <p className="flex flex-wrap items-center gap-2"><bdi className="font-medium text-text">{row.original_name}</bdi><Badge tone="neutral">{t(`historyStatus.${row.status}`)}</Badge></p>
                  <p className="text-xs text-muted">{t('removedBy', { name: row.removed_by_name ?? '—', when: row.removed_at ? formatDateTime(row.removed_at, locale) : '—' })}</p>
                  {row.removal_reason ? <p className="text-xs text-muted">{t('reason', { reason: row.removal_reason })}</p> : null}
                  <Button type="button" variant="outline" className="max-md:min-h-11" onClick={() => setViewing(row)}>{t('open')}</Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <input ref={replaceInput} type="file" accept={acceptAttr(state.policy)} className="sr-only" tabIndex={-1} aria-hidden="true" data-replace-input="" onChange={(event) => void replacePicked(event)} />
      <Viewer
        fillId={fillId}
        row={viewing}
        canManage={state.can_remove && viewing?.status === 'active'}
        removeBlocked={viewing?.status === 'active' && !state.can_remove ? removeBlocked : null}
        onClose={() => setViewing(null)}
        onRemove={(row) => { setViewing(null); setRemoving(row); }}
        onReplace={(row) => { replaceTarget.current = row; setViewing(null); setReplacing({ row, busy: false, error: null }); }}
      />
      <RemoveDialog
        fillId={fillId}
        row={removing}
        onClose={() => setRemoving(null)}
        onDone={(result) => { setRemoving(null); setState(result); onCountChange?.(result.active_count); success(t('removed')); void load(history); }}
        message={message}
      />
      <Dialog open={replacing !== null} onClose={() => (replacing?.busy ? undefined : setReplacing(null))} title={t('replace.title')} hideClose={replacing?.busy}>
        {replacing ? (
          <div className="space-y-3">
            <p className="text-sm text-text">{t('replace.body', { name: replacing.row.original_name })}</p>
            <p className="text-xs text-muted">{t('replace.keepNote')}</p>
            {replacing.error ? <p role="alert" className="text-sm text-negative">{replacing.error}</p> : null}
            {replacing.busy ? <progress className="h-2 w-full accent-[var(--primary)]" aria-label={t('replace.busy')} /> : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="max-md:min-h-11" disabled={replacing.busy} onClick={() => setReplacing(null)}>{t('cancel')}</Button>
              <Button type="button" className="max-md:min-h-11" disabled={replacing.busy} onClick={() => { replaceTarget.current = replacing.row; replaceInput.current?.click(); }}>{t('replace.choose')}</Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}

/** بطاقة مرفق: مصغَّرة للصور (تُجلب بترويسة المصادقة ككائن محلي) أو أيقونة PDF، واسم وحجم؛ الضغط يفتح المعاينة. */
function AttachmentCard({ fillId, row, onOpen }: { fillId: string; row: FillAttachment; onOpen: () => void }) {
  const t = useTranslations('fuelTankers.attachments');
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    if (row.kind !== 'image') return;
    let url: string | null = null;
    let cancelled = false;
    previewUrl(fillId, row.id, row.mime_type).then((value) => { if (cancelled) URL.revokeObjectURL(value); else { url = value; setThumb(value); } }).catch(() => undefined);
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [fillId, row.id, row.kind, row.mime_type]);

  return (
    <button type="button" onClick={onOpen} aria-label={t('openNamed', { name: row.original_name })} className="flex w-full flex-col overflow-hidden rounded-lg border border-border bg-surface text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <span className="flex aspect-[4/3] items-center justify-center bg-primary-soft">
        {row.kind === 'image' ? (
          thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : <span className="text-xs text-muted">{t('loadingPreview')}</span>
        ) : <FileText aria-hidden="true" className="h-10 w-10 text-muted" strokeWidth={1.5} />}
      </span>
      <span className="space-y-0.5 p-2">
        <bdi className="block truncate text-sm font-medium text-text">{row.original_name}</bdi>
        <span className="num block text-xs text-muted">{formatBytes(row.size)}</span>
      </span>
    </button>
  );
}

/** معاينة مكبَّرة: صورة بتكبير/تصغير (والتمرير للتنقّل) أو PDF مضمَّن، مع بيانات الرفع والتنزيل وإجراءات الإدارة المعلنة من الخادم. */
function Viewer({ fillId, row, canManage, removeBlocked, onClose, onRemove, onReplace }: {
  fillId: string; row: FillAttachment | null; canManage: boolean; removeBlocked: 'fill_voided' | 'shift_closed' | 'limit_reached' | 'removal_disabled' | null;
  onClose: () => void; onRemove: (row: FillAttachment) => void; onReplace: (row: FillAttachment) => void;
}) {
  const t = useTranslations('fuelTankers.attachments');
  const locale = useLocale();
  const { success } = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setUrl(null); setFailed(false); setZoom(1);
    if (!row) return;
    let created: string | null = null;
    let cancelled = false;
    previewUrl(fillId, row.id, row.mime_type).then((value) => { if (cancelled) URL.revokeObjectURL(value); else { created = value; setUrl(value); } }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (created) URL.revokeObjectURL(created); };
  }, [fillId, row]);

  async function download() {
    if (!row || busy) return;
    setBusy(true);
    try {
      const outcome = await downloadAttachment(fillId, row.id, row.original_name);
      if (outcome === 'downloaded') success(t('downloaded'));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={row !== null} onClose={onClose} title={row?.original_name ?? t('title')} className="max-w-3xl">
      {row ? (
        <div className="space-y-3" data-attachment-viewer="">
          <p className="text-xs text-muted">
            {row.fill_number ? <span className="num">{row.fill_number}</span> : null}{row.voucher_number ? <> · {t('voucher')} <bdi className="num">{row.voucher_number}</bdi></> : null}
            {' · '}{t('uploadedBy', { name: row.uploaded_by_name ?? '—', when: row.uploaded_at ? formatDateTime(row.uploaded_at, locale) : '—' })}
            {' · '}<span className="num">{formatBytes(row.size)}</span>
          </p>
          <div className="max-h-[60vh] overflow-auto rounded-md border border-border bg-primary-soft" data-viewer-surface="">
            {failed ? <p role="alert" className="p-4 text-sm text-negative">{t('previewFailed')}</p> : null}
            {!failed && url === null ? <p role="status" className="p-4 text-sm text-muted">{t('loadingPreview')}</p> : null}
            {!failed && url !== null && row.kind === 'image' ? <img src={url} alt={row.original_name} style={{ width: `${zoom * 100}%`, maxWidth: 'none' }} className="block" data-zoom={zoom} /> : null}
            {!failed && url !== null && row.kind === 'pdf' ? <iframe src={url} title={row.original_name} className="h-[60vh] w-full" /> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {row.kind === 'image' ? (
              <>
                <Button type="button" variant="outline" className="max-md:min-h-11" disabled={zoom <= 1} aria-label={t('zoomOut')} onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)))}><ZoomOut aria-hidden="true" className="h-4 w-4" /></Button>
                <span className="num min-w-12 text-center text-sm text-text" aria-live="polite">{Math.round(zoom * 100)}%</span>
                <Button type="button" variant="outline" className="max-md:min-h-11" disabled={zoom >= 4} aria-label={t('zoomIn')} onClick={() => setZoom((z) => Math.min(4, +(z + 0.5).toFixed(1)))}><ZoomIn aria-hidden="true" className="h-4 w-4" /></Button>
                <Button type="button" variant="outline" className="max-md:min-h-11" disabled={zoom === 1} onClick={() => setZoom(1)}>{t('fit')}</Button>
              </>
            ) : null}
            <Button type="button" variant="outline" className="max-md:min-h-11 ms-auto" disabled={busy} onClick={() => void download()}><Download aria-hidden="true" className="h-4 w-4" />{t('download')}</Button>
          </div>
          {row.status !== 'active' ? <p role="note" className="rounded-md border border-border bg-primary-soft px-3 py-2 text-sm text-text">{t(`historyStatus.${row.status}`)}{row.removal_reason ? ` — ${row.removal_reason}` : ''}</p> : null}
          {canManage ? (
            <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="max-md:min-h-11" onClick={() => onReplace(row)}><Replace aria-hidden="true" className="h-4 w-4" />{t('replaceAction')}</Button>
              <Button type="button" variant="outline" className="max-md:min-h-11 text-negative" onClick={() => onRemove(row)}><Trash2 aria-hidden="true" className="h-4 w-4" />{t('removeAction')}</Button>
            </div>
          ) : removeBlocked !== null ? <p role="note" className="text-xs text-muted" data-remove-blocked={removeBlocked}>{t(`blocked.remove.${removeBlocked}`)}</p> : null}
        </div>
      ) : null}
    </Dialog>
  );
}

/** إزالة بسبب إلزامي (3–500 حرف). الإزالة انتقال: الصف والملف يبقيان في السجل التاريخي. */
function RemoveDialog({ fillId, row, onClose, onDone, message }: {
  fillId: string; row: FillAttachment | null; onClose: () => void; onDone: (state: AttachmentState) => void; message: (error: unknown) => string;
}) {
  const t = useTranslations('fuelTankers.attachments');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setReason(''); setBusy(false); setError(null); }, [row]);
  const valid = reason.trim().length >= 3 && reason.trim().length <= 500;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!row || busy || !valid) return;
    setBusy(true);
    setError(null);
    try {
      const result = await removeAttachment(fillId, row.id, reason);
      onDone(result.state);
    } catch (caught) {
      setError(message(caught));
      setBusy(false);
    }
  }

  return (
    <Dialog open={row !== null} onClose={() => (busy ? undefined : onClose())} title={t('remove.title')} hideClose={busy}>
      {row ? (
        <form className="space-y-3" onSubmit={(event) => void submit(event)} data-remove-form="">
          <p className="text-sm text-text">{t('remove.body', { name: row.original_name })}</p>
          <p className="text-xs text-muted">{t('remove.keepNote')}</p>
          <div className="space-y-1.5">
            <label htmlFor="attachment-remove-reason" className="text-sm font-medium text-text">{t('remove.reasonLabel')}</label>
            <Textarea id="attachment-remove-reason" value={reason} maxLength={500} rows={3} onChange={(event) => setReason(event.target.value)} aria-describedby="attachment-remove-reason-hint" />
            <p id="attachment-remove-reason-hint" className="text-xs text-muted">{t('remove.reasonHint')}</p>
          </div>
          {error ? <p role="alert" className="text-sm text-negative">{error}</p> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="max-md:min-h-11" disabled={busy} onClick={onClose}>{t('cancel')}</Button>
            <Button type="submit" className="max-md:min-h-11" disabled={busy || !valid}>{busy ? t('remove.busy') : t('remove.confirm')}</Button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}
