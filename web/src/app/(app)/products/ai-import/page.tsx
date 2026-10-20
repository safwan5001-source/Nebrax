'use client';

import { ChangeEvent, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, FileSpreadsheet, Loader2, Search, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ProductPreviewPanel } from '@/modules/ai-actions/product-preview-panel';
import { DECISION_LABEL, FIELD_LABEL, type RowDecision, apiErrorMessage } from '@/modules/ai-actions/product-preview';
import { isExecutionLocked } from '@/modules/ai-actions/product-execution';

type Field = { value: string | number | boolean | null; origin: 'extracted' | 'user' | 'ai_suggested' | 'erp_existing' | 'missing'; confidence: number | null };
type Row = { row_id: string; source_row: number; decision: RowDecision; fields: Record<string, Field>; violations: { field: string | null; severity: string; message: string }[]; media: unknown };
type Review = { action: { id: string; version: number; status: string; cost_hidden?: boolean }; proposal: { rows: Row[] } };
type Pending = Record<string, { fields: Record<string, string | null>; decision?: 'create' | 'update' | 'skip' }>;
const fields = ['name', 'sku', 'barcode', 'type', 'purchase_price', 'sale_price', 'unit', 'category', 'tax_rate', 'primary_image_url'] as const;
const decisions = ['create', 'update', 'skip'] as const;

function key(): string { return `ai-review-${crypto.randomUUID()}`; }

export default function AiProductImportReviewPage() {
  const { success, error } = useToast();
  const confirm = useConfirm();
  const [review, setReview] = useState<Review | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [query, setQuery] = useState('');
  const [needsReview, setNeedsReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bulkField, setBulkField] = useState('tax_rate');
  const [bulkValue, setBulkValue] = useState('');
  const [bulkDecision, setBulkDecision] = useState<(typeof decisions)[number]>('create');
  const [pending, setPending] = useState<Pending>({});
  const [stage, setStage] = useState<'review' | 'preview'>('review');
  const dirty = Object.keys(pending).length > 0;
  // بلا `products.view_cost` يحجب الخادم سعر الشراء ويرفض تعديله؛ الواجهة تعكس ذلك ولا تعرض حقلاً قابلاً للكتابة.
  const costHidden = review?.action.cost_hidden === true;
  // بعد بدء التنفيذ تُقفل المراجعة: أي تعديل يرفضه الخادم، فلا نعرض له طريقاً.
  const locked = isExecutionLocked(review?.action.status);
  const visibleFields = fields.filter((field) => !(costHidden && field === 'purchase_price'));

  const rows = useMemo(() => (review?.proposal.rows ?? []).filter((row) => {
    const text = [row.fields.name?.value, row.fields.sku?.value, row.fields.barcode?.value].join(' ').toLowerCase();
    return (!needsReview || row.decision === 'needs_review') && text.includes(query.toLowerCase());
  }), [review, query, needsReview]);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null; setFile(next); if (!next) return;
    setSaving(true);
    try {
      const action = await api<{ data: { id: string; version: number } }>('/ai-actions', { method: 'POST', headers: { 'Idempotency-Key': key() }, body: { type: 'product_import.v1', proposal: { schema_version: 1, rows: [] } } });
      const body = new FormData(); body.set('expected_version', String(action.data.version)); body.set('file', next);
      await api(`/ai-actions/${action.data.id}/files`, { method: 'POST', headers: { 'Idempotency-Key': key() }, body });
      const loaded = await api<{ data: Review }>(`/ai-actions/${action.data.id}/review`); setReview(loaded.data); setPending({}); success('تم استخراج الملف؛ راجع الحقول قبل أي موافقة.');
    } catch (exception) { error(exception instanceof ApiError ? apiErrorMessage(exception.body, exception.message) : 'تعذر رفع الملف.'); }
    finally { setSaving(false); }
  }

  function update(rowId: string, field: string, value: string) {
    setReview((current) => current && ({ ...current, proposal: { rows: current.proposal.rows.map((row) => row.row_id !== rowId ? row : { ...row, fields: { ...row.fields, [field]: { value: value === '' ? null : value, origin: value === '' ? 'missing' : 'user', confidence: null } } }) } }));
    setPending((current) => ({ ...current, [rowId]: { ...current[rowId], fields: { ...current[rowId]?.fields, [field]: value === '' ? null : value } } }));
  }
  function decide(rowId: string, decision: (typeof decisions)[number]) {
    setReview((current) => current && ({ ...current, proposal: { rows: current.proposal.rows.map((row) => row.row_id !== rowId ? row : { ...row, decision }) } }));
    setPending((current) => ({ ...current, [rowId]: { fields: current[rowId]?.fields ?? {}, decision } }));
  }
  function bulkApply() { if (costHidden && bulkField === 'purchase_price') return; rows.forEach((row) => update(row.row_id, bulkField, bulkValue)); }
  function bulkDecide() { rows.forEach((row) => decide(row.row_id, bulkDecision)); }

  /** يحفظ التعديلات المعلّقة كإصدار جديد؛ يعيد `true` إن لم يبق شيء غير محفوظ. */
  async function save(): Promise<boolean> {
    if (!review || locked) return false;
    if (!dirty) return true;
    if (['ready_for_approval', 'approved'].includes(review.action.status)) {
      const ok = await confirm({ message: review.action.status === 'approved' ? 'سيؤدي الحفظ إلى إبطال الموافقة والمعاينة الحاليتين، وستحتاج معاينة وموافقة جديدتين.' : 'سيؤدي الحفظ إلى إبطال المعاينة الحالية وستحتاج معاينة جديدة.', confirmLabel: 'حفظ وإبطال' });
      if (!ok) return false;
    }
    setSaving(true);
    try {
      const edits = Object.entries(pending).map(([rowId, edit]) => ({ row_id: rowId, ...(Object.keys(edit.fields).length > 0 ? { fields: edit.fields } : {}), ...(edit.decision ? { decision: edit.decision } : {}) }));
      const result = await api<{ data: { version: number; status: string; cost_hidden?: boolean; latest_version: { proposal: { rows: Row[] } } } }>(`/ai-actions/${review.action.id}/review/versions`, { method: 'POST', headers: { 'Idempotency-Key': key() }, body: { expected_version: review.action.version, edits } });
      setReview({ action: { ...review.action, version: result.data.version, status: result.data.status, cost_hidden: result.data.cost_hidden ?? review.action.cost_hidden }, proposal: result.data.latest_version.proposal }); setPending({});
      success('حُفظ إصدار مراجعة جديد. أُبطلت أي معاينة أو موافقة سابقة.');
      return true;
    } catch (exception) { error(exception instanceof ApiError ? apiErrorMessage(exception.body, 'تعارضت المراجعة؛ حدّث الصفحة ثم أعد المحاولة.') : 'تعارضت المراجعة؛ حدّث الصفحة ثم أعد المحاولة.'); return false; }
    finally { setSaving(false); }
  }

  async function toPreview() {
    if (await save()) setStage('preview');
  }

  function setStatus(status: string) { setReview((current) => current && ({ ...current, action: { ...current.action, status } })); }

  return <div className="space-y-4 pb-20">
    <header className="flex items-center gap-3"><Button asChild variant="ghost" size="icon" aria-label="العودة"><Link href="/products"><ArrowRight className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" /></Link></Button><div><h1 className="text-xl font-semibold">استيراد عبر مساعد أَوْج</h1><p className="text-sm text-muted">{stage === 'review' ? 'استخراج ومراجعة — ثم معاينة نهائية وموافقة. لا تُنشأ منتجات أو تُحدّث في هذه المرحلة.' : 'المعاينة النهائية والموافقة — لا تُنشأ منتجات أو تُحدّث في هذه المرحلة.'}</p></div></header>
    {!review ? <Card><CardHeader><CardTitle>ارفع CSV أو Excel</CardTitle></CardHeader><CardContent><label className="flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center"><FileSpreadsheet className="h-8 w-8 text-primary" /><span>{file?.name ?? 'اختر ملف المنتجات'}</span><Input className="sr-only" type="file" accept=".csv,.xlsx" onChange={upload} disabled={saving} /></label>{saving && <p className="mt-3 flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> جارٍ الاستخراج الآمن…</p>}</CardContent></Card> : <>
      <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label="مراحل الاستيراد">
        <li><Button variant={stage === 'review' ? 'primary' : 'outline'} size="sm" aria-current={stage === 'review' ? 'step' : undefined} onClick={() => setStage('review')} disabled={locked}>١ · مراجعة البيانات</Button></li>
        <li><Button variant={stage === 'preview' ? 'primary' : 'outline'} size="sm" aria-current={stage === 'preview' ? 'step' : undefined} onClick={() => void toPreview()} disabled={saving}>٢ · المعاينة والموافقة</Button></li>
      </ol>
      {stage === 'preview' ? <ProductPreviewPanel actionId={review.action.id} version={review.action.version} dirty={dirty} onEdit={() => setStage('review')} onStatus={setStatus} /> : <>
      <Card><CardContent className="flex flex-wrap items-center gap-3 py-4"><div className="relative min-w-52 flex-1"><Search className="absolute start-3 top-3 h-4 w-4 text-muted" /><Input className="ps-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالاسم أو SKU أو الباركود" aria-label="بحث" /></div><Button variant={needsReview ? 'primary' : 'outline'} onClick={() => setNeedsReview((v) => !v)}>يحتاج مراجعة</Button><select className="h-10 rounded-md border bg-background px-2" aria-label="حقل التعديل الجماعي" value={bulkField} onChange={(e) => setBulkField(e.target.value)}>{visibleFields.map((field) => <option key={field} value={field}>{FIELD_LABEL[field] ?? field}</option>)}</select><Input className="w-36" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} placeholder="تعديل جماعي" aria-label="قيمة التعديل الجماعي" /><Button variant="outline" onClick={bulkApply}>طبّق على الظاهر</Button><select className="h-10 rounded-md border bg-background px-2" aria-label="القرار الجماعي" value={bulkDecision} onChange={(e) => setBulkDecision(e.target.value as (typeof decisions)[number])}>{decisions.map((value) => <option key={value} value={value}>{DECISION_LABEL[value]}</option>)}</select><Button variant="outline" onClick={bulkDecide}>طبّق القرار على الظاهر</Button></CardContent></Card>
      {costHidden && <p className="rounded border border-border bg-surface p-3 text-sm text-muted">سعر الشراء محجوب عنك لأنه يتطلب صلاحية عرض التكلفة؛ لا يظهر هنا ولا يمكن تعديله، وتبقى قيمته المحفوظة كما هي.</p>}
      <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[1100px] text-sm"><thead className="bg-muted/50"><tr>{visibleFields.map((field) => <th scope="col" className="p-2 text-start" key={field}>{FIELD_LABEL[field] ?? field}</th>)}<th scope="col" className="p-2 text-start">القرار</th><th scope="col" className="p-2 text-start">الحالة</th></tr></thead><tbody>{rows.map((row) => <tr className="border-t" key={row.row_id}>{visibleFields.map((field) => <td className="p-2" key={field}><Input dir={field.includes('price') || field === 'sku' || field === 'barcode' ? 'ltr' : undefined} value={String(row.fields[field]?.value ?? '')} onChange={(e) => update(row.row_id, field, e.target.value)} aria-label={`${FIELD_LABEL[field] ?? field}-${row.source_row}`} /><small className="mt-1 block text-muted">{row.fields[field]?.origin === 'user' ? 'أدخله المستخدم' : row.fields[field]?.origin === 'missing' ? 'مفقود' : 'مستخرج من الملف'}</small></td>)}<td className="p-2"><select className="h-10 rounded-md border bg-background px-2" aria-label={`القرار-${row.source_row}`} value={row.decision === 'needs_review' ? '' : row.decision} onChange={(e) => decide(row.row_id, e.target.value as (typeof decisions)[number])}>{row.decision === 'needs_review' && <option value="" disabled>يحتاج قراراً</option>}{decisions.map((value) => <option key={value} value={value}>{DECISION_LABEL[value]}</option>)}</select></td><td className="p-2"><Badge tone={row.decision === 'needs_review' ? 'warning' : 'positive'}>{row.decision === 'needs_review' ? 'يحتاج مراجعة' : 'جاهز للمراجعة'}</Badge>{row.violations.map((v, i) => <p className="mt-1 text-xs text-negative" key={i}>{v.message}</p>)}</td></tr>)}</tbody></table></div>
      <div className="flex flex-wrap items-center gap-2"><Button variant="outline" onClick={() => void save()} disabled={saving || !dirty}>{saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}حفظ إصدار المراجعة</Button><Button onClick={() => void toPreview()} disabled={saving}>{saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Upload className="me-2 h-4 w-4" aria-hidden />}المتابعة إلى المعاينة النهائية</Button>{dirty && <span role="status" className="text-sm text-warning">تعديلات غير محفوظة</span>}</div>
      </>}
    </>}
  </div>;
}
