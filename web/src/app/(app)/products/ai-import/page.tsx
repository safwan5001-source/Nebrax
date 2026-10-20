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

type Field = { value: string | number | boolean | null; origin: 'extracted' | 'user' | 'ai_suggested' | 'erp_existing' | 'missing'; confidence: number | null };
type Row = { row_id: string; source_row: number; decision: string; fields: Record<string, Field>; violations: { field: string | null; severity: string; message: string }[]; media: unknown };
type Review = { action: { id: string; version: number }; proposal: { rows: Row[] } };
const fields = ['name', 'sku', 'barcode', 'purchase_price', 'sale_price', 'unit', 'category', 'tax_rate', 'primary_image_url'] as const;

function key(): string { return `ai-review-${crypto.randomUUID()}`; }

export default function AiProductImportReviewPage() {
  const { success, error } = useToast();
  const [review, setReview] = useState<Review | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [query, setQuery] = useState('');
  const [needsReview, setNeedsReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bulkField, setBulkField] = useState('tax_rate');
  const [bulkValue, setBulkValue] = useState('');

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
      const loaded = await api<{ data: Review }>(`/ai-actions/${action.data.id}/review`); setReview(loaded.data); success('تم استخراج الملف؛ راجع الحقول قبل أي موافقة.');
    } catch (exception) { error(exception instanceof ApiError ? exception.message : 'تعذر رفع الملف.'); }
    finally { setSaving(false); }
  }

  function update(rowId: string, field: string, value: string) {
    setReview((current) => current && ({ ...current, proposal: { rows: current.proposal.rows.map((row) => row.row_id !== rowId ? row : { ...row, fields: { ...row.fields, [field]: { value: value === '' ? null : value, origin: value === '' ? 'missing' : 'user', confidence: null } } }) } }));
  }
  function bulkApply() { rows.forEach((row) => update(row.row_id, bulkField, bulkValue)); }
  async function save() {
    if (!review) return; setSaving(true);
    try {
      const edits = review.proposal.rows.map((row) => ({ row_id: row.row_id, fields: Object.fromEntries(Object.entries(row.fields).filter(([, field]) => field.origin === 'user').map(([name, field]) => [name, field.value])) })).filter((edit) => Object.keys(edit.fields).length > 0);
      if (edits.length === 0) return;
      const result = await api<{ data: { version: number; latest_version: { proposal: { rows: Row[] } } } }>(`/ai-actions/${review.action.id}/review/versions`, { method: 'POST', headers: { 'Idempotency-Key': key() }, body: { expected_version: review.action.version, edits } });
      setReview({ action: { ...review.action, version: result.data.version }, proposal: result.data.latest_version.proposal }); success('حُفظ إصدار مراجعة جديد. لا توجد عملية تنفيذ في هذه المرحلة.');
    } catch (exception) { error(exception instanceof ApiError ? exception.message : 'تعارضت المراجعة؛ حدّث الصفحة ثم أعد المحاولة.'); }
    finally { setSaving(false); }
  }

  return <div className="space-y-4 pb-20">
    <header className="flex items-center gap-3"><Button asChild variant="ghost" size="icon" aria-label="العودة"><Link href="/products"><ArrowRight className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" /></Link></Button><div><h1 className="text-xl font-semibold">استيراد عبر مساعد أَوْج</h1><p className="text-sm text-muted-foreground">استخراج ومراجعة فقط — لا تُنشأ منتجات أو تُحدّث في هذه المرحلة.</p></div></header>
    {!review ? <Card><CardHeader><CardTitle>ارفع CSV أو Excel</CardTitle></CardHeader><CardContent><label className="flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center"><FileSpreadsheet className="h-8 w-8 text-primary" /><span>{file?.name ?? 'اختر ملف المنتجات'}</span><Input className="sr-only" type="file" accept=".csv,.xlsx" onChange={upload} disabled={saving} /></label>{saving && <p className="mt-3 flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> جارٍ الاستخراج الآمن…</p>}</CardContent></Card> : <>
      <Card><CardContent className="flex flex-wrap items-center gap-3 py-4"><div className="relative min-w-52 flex-1"><Search className="absolute start-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="ps-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالاسم أو SKU أو الباركود" /></div><Button variant={needsReview ? 'primary' : 'outline'} onClick={() => setNeedsReview((v) => !v)}>يحتاج مراجعة</Button><select className="h-10 rounded-md border bg-background px-2" value={bulkField} onChange={(e) => setBulkField(e.target.value)}>{fields.map((field) => <option key={field}>{field}</option>)}</select><Input className="w-36" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} placeholder="تعديل جماعي" /><Button variant="outline" onClick={bulkApply}>طبّق على الظاهر</Button><Button onClick={save} disabled={saving}>{saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}حفظ إصدار المراجعة</Button></CardContent></Card>
      <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[1100px] text-sm"><thead className="bg-muted/50"><tr>{fields.map((field) => <th className="p-2 text-start" key={field}>{field}</th>)}<th className="p-2 text-start">الحالة</th></tr></thead><tbody>{rows.map((row) => <tr className="border-t" key={row.row_id}>{fields.map((field) => <td className="p-2" key={field}><Input dir={field.includes('price') || field === 'sku' || field === 'barcode' ? 'ltr' : undefined} value={String(row.fields[field]?.value ?? '')} onChange={(e) => update(row.row_id, field, e.target.value)} aria-label={`${field}-${row.source_row}`} /><small className="mt-1 block text-muted-foreground">{row.fields[field]?.origin === 'user' ? 'أدخله المستخدم' : row.fields[field]?.origin === 'missing' ? 'مفقود' : 'مستخرج من الملف'}</small></td>)}<td className="p-2"><Badge tone={row.decision === 'needs_review' ? 'warning' : 'positive'}>{row.decision === 'needs_review' ? 'يحتاج مراجعة' : 'جاهز للمراجعة'}</Badge>{row.violations.map((v, i) => <p className="mt-1 text-xs text-negative" key={i}>{v.message}</p>)}</td></tr>)}</tbody></table></div>
    </>}
  </div>;
}
