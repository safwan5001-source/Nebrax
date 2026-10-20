'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Image as ImageIcon, Loader2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Money } from '@/components/ui/money';
import { Tabs } from '@/components/ui/tabs';
import { ProductExecutionPanel } from './product-execution-panel';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/formatting';
import {
  type PreviewChange,
  type PreviewOperation,
  type PreviewRow,
  type ProductPreview,
  ISSUE_TITLE,
  MONEY_FIELDS,
  OPERATION_LABEL,
  OPERATION_TONE,
  PRICE_LABEL,
  apiErrorMessage,
  appliesChanges,
  approvalBlockReason,
  canSubmitApproval,
  errorCode,
  fieldLabel,
  isStalePreviewCode,
  issueCounts,
  minorToRiyal,
  shortHash,
} from './product-preview';
import { isExecutionLocked } from './product-execution';

const PAGE_SIZE = 50;

function key(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function Value({ field, value, redacted }: { field: string; value: PreviewChange['after']; redacted?: boolean }) {
  if (redacted) return <span className="text-muted">محجوب</span>;
  if (value === null || value === undefined || value === '') return <span className="text-muted">—</span>;
  if ((MONEY_FIELDS as readonly string[]).includes(field) && typeof value === 'number') return <Money value={minorToRiyal(value)} />;
  if (field === 'tax_rate') return <span className="num" dir="ltr">{String(value)}%</span>;
  if (typeof value === 'boolean') return <span>{value ? 'نعم' : 'لا'}</span>;
  return <bdi dir="auto" className="break-words">{String(value)}</bdi>;
}

function Issues({ issues }: { issues: PreviewRow['issues'] }) {
  if (issues.length === 0) return <span className="text-muted">—</span>;
  return (
    <ul className="space-y-1">
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${index}`} className={`flex items-start gap-1.5 text-xs ${issue.severity === 'error' ? 'text-negative' : 'text-warning'}`}>
          {issue.severity === 'error' ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
          <span><span className="sr-only">{issue.severity === 'error' ? 'خطأ: ' : 'تنبيه: '}</span>{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}

function Changes({ row }: { row: PreviewRow }) {
  const shown = row.changes.filter((change) => !MONEY_FIELDS.includes(change.field as (typeof MONEY_FIELDS)[number]) && change.field !== 'tax_rate');
  if (row.operation === 'skip') return <span className="text-muted">{row.skip_reason === 'user_skip' ? 'تخطٍّ بقرارك' : 'لا فروق مع المنتج الحالي'}</span>;
  if (shown.length === 0) return <span className="text-muted">—</span>;
  return (
    <dl className="space-y-1 text-xs">
      {shown.map((change) => (
        <div key={change.field} className="flex flex-wrap items-baseline gap-x-1.5">
          <dt className="text-muted">{fieldLabel(change.field)}:</dt>
          <dd className="flex flex-wrap items-baseline gap-1">
            {row.operation === 'update' && <><span className="text-muted line-through"><Value field={change.field} value={change.before} redacted={change.redacted} /></span><span aria-hidden>←</span><span className="sr-only">إلى</span></>}
            <Value field={change.field} value={change.after} redacted={change.redacted} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Prices({ row }: { row: PreviewRow }) {
  const entries = Object.entries(row.prices ?? {});
  if (entries.length === 0 || row.operation === 'skip') return <span className="text-muted">—</span>;
  return (
    <dl className="space-y-1 text-xs">
      {entries.map(([name, price]) => {
        const changed = price.before !== null && price.after !== null && price.before !== price.after;
        return (
          <div key={name} className="flex flex-wrap items-baseline gap-x-1.5">
            <dt className="text-muted">{PRICE_LABEL[name] ?? name}:</dt>
            <dd className="flex flex-wrap items-baseline gap-1">
              {changed && <><span className="text-muted line-through"><Value field={name} value={price.before} redacted={price.redacted} /></span><span aria-hidden>←</span></>}
              <Value field={name} value={price.after ?? price.before} redacted={price.redacted} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function Images({ row }: { row: PreviewRow }) {
  const images = row.images;
  if (!images || images.count === 0) return <span className="text-muted">—</span>;
  const first = images.primary ?? images.additional[0];
  return (
    <div className="space-y-1 text-xs">
      <p className="flex items-center gap-1"><ImageIcon className="h-3.5 w-3.5" aria-hidden /> {images.count} {images.count === 1 ? 'صورة' : 'صور'}</p>
      {first && <p className="max-w-48 truncate text-muted" dir="ltr" title={first}>{first}</p>}
      <p className="text-muted">{images.status === 'deferred' ? 'مؤجَّلة — لا تُنزَّل ولا تُرفق في هذه المرحلة' : 'لن تُطبَّق'}</p>
    </div>
  );
}

function MatchCell({ row }: { row: PreviewRow }) {
  const match = row.match;
  if (match.target_product_id === null) return <span className="text-muted">{row.operation === 'create' ? 'منتج جديد' : 'لا مطابقة'}</span>;
  return (
    <div className="space-y-0.5 text-xs">
      <bdi dir="auto" className="block font-medium">{match.target_name}</bdi>
      {match.target_sku && <span className="block text-muted" dir="ltr">{match.target_sku}</span>}
      <span className="text-muted">{match.kind === 'nebrax_id' ? 'بمعرّف نبراكس' : match.kind === 'sku' ? 'برمز الصنف' : 'بالباركود'}</span>
    </div>
  );
}

function RowIdentity({ row }: { row: PreviewRow }) {
  return (
    <div className="space-y-0.5">
      <bdi dir="auto" className="block font-medium">{row.display.name ?? '—'}</bdi>
      <span className="block text-xs text-muted" dir="ltr">{row.display.sku ?? row.display.barcode ?? ''}</span>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'positive' | 'neutral' | 'muted' | 'negative' }) {
  return (
    <div className="space-y-1.5 rounded border border-border bg-surface p-3">
      <Badge tone={tone}>{label}</Badge>
      <p className="num text-xl font-semibold">{value}</p>
    </div>
  );
}

interface PanelProps {
  actionId: string;
  version: number;
  /** تعديلات لم تُحفظ بعد: المعاينة لا تعكسها، فتُمنع الموافقة حتى تُحفظ وتُنشأ معاينة جديدة. */
  dirty: boolean;
  onEdit: () => void;
  onStatus: (status: string) => void;
}

export function ProductPreviewPanel({ actionId, version, dirty, onEdit, onStatus }: PanelProps) {
  const { success, error } = useToast();
  const [preview, setPreview] = useState<ProductPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<PreviewOperation | 'all'>('all');
  const [page, setPage] = useState(1);
  const [acknowledged, setAcknowledged] = useState(false);
  const [stale, setStale] = useState<string | null>(null);
  // بعد بدء التنفيذ لا يُسمح بالعودة إلى التعديل ولا بمعاينة جديدة (الخادم يرفضهما أيضاً).
  const [executionLocked, setExecutionLocked] = useState(false);
  const started = useRef(false);

  const generate = useCallback(async () => {
    setLoading(true);
    setStale(null);
    setAcknowledged(false);
    try {
      const result = await api<{ data: ProductPreview }>(`/ai-actions/${actionId}/previews?per_page=${PAGE_SIZE}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key('ai-preview') },
        body: { expected_version: version },
      });
      setPreview(result.data);
      setOperation('all');
      setPage(1);
      onStatus(result.data.approvable ? 'ready_for_approval' : 'editing');
    } catch (exception) {
      const body = exception instanceof ApiError ? exception.body : null;
      error(apiErrorMessage(body, 'تعذر إنشاء المعاينة النهائية.'));
      if (isStalePreviewCode(errorCode(body))) setStale(apiErrorMessage(body, 'تغيّرت المسودة؛ حدّث الصفحة.'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionId, version]);

  const load = useCallback(async (id: string, nextOperation: PreviewOperation | 'all', nextPage: number) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ per_page: String(PAGE_SIZE), page: String(nextPage) });
      if (nextOperation !== 'all') query.set('operation', nextOperation);
      const result = await api<{ data: ProductPreview }>(`/ai-actions/${actionId}/previews/${id}?${query}`);
      setPreview(result.data);
      onStatus(result.data.approval?.status === 'active' ? 'approved' : result.data.approvable && result.data.status === 'active' ? 'ready_for_approval' : 'editing');
    } catch (exception) {
      error(apiErrorMessage(exception instanceof ApiError ? exception.body : null, 'تعذر تحميل المعاينة.'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionId]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void generate();
  }, [generate]);

  function changeFilter(next: string) {
    const value = next as PreviewOperation | 'all';
    setOperation(value);
    setPage(1);
    if (preview) void load(preview.id, value, 1);
  }

  function changePage(next: number) {
    setPage(next);
    if (preview) void load(preview.id, operation, next);
  }

  async function approve() {
    if (!preview || !canSubmitApproval(preview, acknowledged, busy, dirty)) return;
    setBusy(true);
    try {
      await api(`/ai-actions/${actionId}/approvals`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key('ai-approve') },
        body: { expected_version: version, preview_id: preview.id, preview_hash: preview.preview_hash, acknowledged: true },
      });
      success('سُجّلت الموافقة على هذه المعاينة. لم يُنشأ أو يُحدَّث أي منتج.');
      await load(preview.id, operation, page);
    } catch (exception) {
      const body = exception instanceof ApiError ? exception.body : null;
      const message = apiErrorMessage(body, 'تعذرت الموافقة.');
      error(message);
      if (isStalePreviewCode(errorCode(body))) setStale(message);
    } finally {
      setBusy(false);
    }
  }

  if (!preview) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm" role="status">
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> جارٍ إنشاء المعاينة النهائية وفحص بيانات المؤسسة…</> : (
            <div className="space-y-3"><p>{stale ?? 'تعذر إنشاء المعاينة.'}</p><Button variant="outline" onClick={() => void generate()}><RefreshCw className="h-4 w-4" aria-hidden /> إعادة المحاولة</Button></div>
          )}
        </CardContent>
      </Card>
    );
  }

  const totals = preview.totals;
  const approved = preview.approval?.status === 'active';
  const reason = approvalBlockReason(preview, dirty);
  const counts = issueCounts(preview.rows);
  const tabs = [
    { id: 'all', label: 'الكل', count: totals.rows },
    { id: 'create', label: OPERATION_LABEL.create, count: totals.create },
    { id: 'update', label: OPERATION_LABEL.update, count: totals.update },
    { id: 'skip', label: OPERATION_LABEL.skip, count: totals.skip },
    { id: 'blocked', label: OPERATION_LABEL.blocked, count: totals.blocked, alert: totals.blocked > 0, alertLabel: 'صفوف موقوفة' },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle as="h2" className="text-base text-text">المعاينة النهائية قبل الاستيراد</CardTitle>
            <p className="mt-1 text-sm text-muted">هذه صورة ما سيحدث فقط — لا تُنشأ منتجات ولا تُحدَّث ولا تتغيّر أسعار أو مخزون أو قيود في هذه المرحلة.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {approved ? <Badge tone="positive"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> تمت الموافقة</Badge>
              : preview.status === 'invalidated' ? <Badge tone="negative">معاينة مُبطلة</Badge>
              : preview.status === 'expired' ? <Badge tone="warning">منتهية الصلاحية</Badge>
              : preview.approvable ? <Badge tone="neutral">جاهزة للموافقة</Badge> : <Badge tone="negative">بها أخطاء تمنع التنفيذ</Badge>}
            <Button variant="outline" size="sm" onClick={() => void generate()} disabled={loading || executionLocked}><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden /> معاينة جديدة</Button>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
            <div className="flex gap-1.5"><dt className="text-muted">إصدار المسودة:</dt><dd className="num">{preview.action_version}</dd></div>
            <div className="flex gap-1.5"><dt className="text-muted">بصمة المعاينة:</dt><dd className="num" dir="ltr" title={preview.preview_hash}>{shortHash(preview.preview_hash)}</dd></div>
            <div className="flex gap-1.5"><dt className="text-muted">صالحة حتى:</dt><dd>{formatDateTime(preview.expires_at)}</dd></div>
          </dl>
        </CardContent>
      </Card>

      {stale && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded border border-warning/40 bg-warning/10 p-3 text-sm">
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden /> {stale}</span>
          <Button size="sm" onClick={() => void generate()}><RefreshCw className="h-3.5 w-3.5" aria-hidden /> إنشاء معاينة جديدة</Button>
        </div>
      )}
      {dirty && <p role="status" className="rounded border border-warning/40 bg-warning/10 p-3 text-sm">لديك تعديلات غير محفوظة لا تظهر في هذه المعاينة. احفظ إصدار المراجعة ثم أنشئ معاينة جديدة.</p>}
      {preview.permissions.cost_hidden && <p className="rounded border border-border bg-surface p-3 text-sm text-muted">أسعار الشراء محجوبة عنك لأنها تتطلب صلاحية عرض التكلفة.</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={OPERATION_LABEL.create} value={totals.create} tone="positive" />
        <Stat label={OPERATION_LABEL.update} value={totals.update} tone="neutral" />
        <Stat label={OPERATION_LABEL.skip} value={totals.skip} tone="muted" />
        <Stat label={OPERATION_LABEL.blocked} value={totals.blocked} tone="negative" />
      </div>

      {(preview.issues.length > 0 || counts.length > 0) && (
        <Card>
          <CardHeader><CardTitle as="h2">ما الذي يحتاج انتباهك؟</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {preview.issues.length > 0 && <Issues issues={preview.issues} />}
            {counts.length > 0 && (
              <ul className="flex flex-wrap gap-2 text-xs">
                {counts.map((item) => (
                  <li key={`${item.severity}-${item.code}`}>
                    <Badge tone={item.severity === 'error' ? 'negative' : 'warning'} wrap>{item.severity === 'error' ? <XCircle className="h-3 w-3" aria-hidden /> : <AlertTriangle className="h-3 w-3" aria-hidden />}{ISSUE_TITLE[item.code] ?? item.code} · <span className="num">{item.count}</span></Badge>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted">الأخطاء تمنع الموافقة؛ التنبيهات معلومات لا تمنعها ولا تُخترع لها قيم.</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        <Tabs tabs={tabs} value={operation} onChange={changeFilter} />
        <div aria-busy={loading} className={loading ? 'opacity-60' : undefined}>
          <div className="hidden overflow-x-auto rounded border border-border md:block">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-primary-soft/40 text-muted">
                <tr>{['الصف', 'المنتج', 'العملية', 'المطابقة', 'التغييرات', 'الأسعار', 'الصور', 'الملاحظات'].map((title) => <th key={title} scope="col" className="p-2 text-start font-medium">{title}</th>)}</tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.row_id} className="border-t border-border align-top">
                    <td className="num p-2 text-muted">{row.source_row}</td>
                    <td className="p-2"><RowIdentity row={row} /></td>
                    <td className="p-2"><Badge tone={OPERATION_TONE[row.operation]}>{OPERATION_LABEL[row.operation]}</Badge></td>
                    <td className="p-2"><MatchCell row={row} /></td>
                    <td className="p-2"><Changes row={row} /></td>
                    <td className="p-2"><Prices row={row} /></td>
                    <td className="p-2"><Images row={row} /></td>
                    <td className="p-2"><Issues issues={row.issues} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-3 md:hidden">
            {preview.rows.map((row) => (
              <li key={row.row_id} className="space-y-2 rounded border border-border bg-surface p-3 text-sm">
                <div className="flex items-start justify-between gap-2"><RowIdentity row={row} /><Badge tone={OPERATION_TONE[row.operation]}>{OPERATION_LABEL[row.operation]}</Badge></div>
                <p className="text-xs text-muted">الصف <span className="num">{row.source_row}</span></p>
                <MatchCell row={row} />
                <Changes row={row} />
                <Prices row={row} />
                <Images row={row} />
                <Issues issues={row.issues} />
              </li>
            ))}
          </ul>
          {preview.rows.length === 0 && <p className="rounded border border-border p-6 text-center text-sm text-muted">لا توجد صفوف في هذا التصنيف.</p>}
        </div>
        {preview.pagination.last_page > 1 && (
          <nav aria-label="صفحات المعاينة" className="flex items-center justify-between gap-2 text-sm">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => changePage(page - 1)}>السابق</Button>
            <span className="num text-muted">{page} / {preview.pagination.last_page}</span>
            <Button variant="outline" size="sm" disabled={page >= preview.pagination.last_page || loading} onClick={() => changePage(page + 1)}>التالي</Button>
          </nav>
        )}
      </div>

      <Card data-testid="approval-box">
        <CardHeader><CardTitle as="h2" className="flex items-center gap-2 text-base text-text"><ClipboardCheck className="h-4 w-4" aria-hidden /> الموافقة</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {approved && preview.approval ? (
            <div role="status" className="space-y-2 rounded border border-positive/40 bg-positive/10 p-3 text-sm">
              <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4 text-positive" aria-hidden /> وُوفق على هذه المعاينة بعينها (<span className="num" dir="ltr">{shortHash(preview.approval.preview_hash)}</span>).</p>
              <p>الموافقة سارية حتى {formatDateTime(preview.approval.expires_at)}. التنفيذ غير مفعّل في هذه المرحلة: لم يُنشأ أو يُحدَّث أي منتج، ولا يتغيّر المخزون أو الحسابات.</p>
              <p className="text-muted">أي تعديل على البيانات يُبطل هذه الموافقة والمعاينة معاً.</p>
            </div>
          ) : (
            <>
              <p className="text-sm">ستوافق على {appliesChanges(totals) === 0 ? 'لا شيء' : <>إنشاء <span className="num font-medium">{totals.create}</span> وتحديث <span className="num font-medium">{totals.update}</span> منتجاً</>}{totals.skip > 0 && <>، وتخطي <span className="num">{totals.skip}</span> صفاً</>}. الموافقة مرتبطة بهذه البصمة وهذا الإصدار فقط، وتُبطل بأي تعديل.</p>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={!preview.approvable || preview.status !== 'active' || !preview.permissions.can_approve} />
                <span>راجعت المعاينة أعلاه وأوافق على هذه التغييرات بهذه البصمة (<span className="num" dir="ltr">{shortHash(preview.preview_hash)}</span>).</span>
              </label>
              {reason && <p role="status" className="text-sm text-warning">{reason}</p>}
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void approve()} disabled={!canSubmitApproval(preview, acknowledged, busy, dirty)}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />} الموافقة على المعاينة
                </Button>
                <Button variant="outline" onClick={onEdit}>العودة إلى التعديل</Button>
              </div>
            </>
          )}
          {approved && !executionLocked && <Button variant="outline" onClick={onEdit}>تعديل البيانات (يُبطل الموافقة)</Button>}
        </CardContent>
      </Card>

      {approved && preview.approval && (
        <ProductExecutionPanel
          actionId={actionId}
          version={version}
          totals={{ create: totals.create, update: totals.update, skip: totals.skip }}
          onStatus={(status) => { setExecutionLocked(isExecutionLocked(status)); onStatus(status); }}
        />
      )}
    </div>
  );
}
