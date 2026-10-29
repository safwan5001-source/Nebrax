/**
 * عميل تشغيلة الاستيراد الدائم (PR-DUR-1..4) — هوية ملف/تشغيلة واحدة تبقى
 * على الخادم من الرفع حتى الاكتمال. لا إعادة رفع للملف بعد إنشاء التشغيلة:
 * كل نداء لاحق (فحص الحالة، تطبيق قطعة، إلغاء) يخاطب `id` التشغيلة فقط.
 *
 * مطابقٌ حرفياً لعقد الخادم في `ImportJobResource`/`ImportJobController` —
 * لا تُخترع حالة أو حقل غير موجود هناك.
 */

import { api, downloadFile, type DownloadOutcome } from '@/lib/api';

export type ImportJobDomain =
  | 'product_catalog'
  | 'product_workbook'
  | 'inventory_opening'
  | 'partner_master'
  | 'product_taxonomy'
  | 'price_list_items'
  | 'unit_templates'
  | 'stocktake_count'
  | 'expense_import'
  | 'purchase_import'
  | 'stock_permit_import';

/** مطابقٌ حرفياً لـ`App\Support\ImportJobStatus`. `queued` مفردة مُقرَّرة سلفاً بلا مسار كودٍ يبلغها اليوم. */
export type ImportJobStatus =
  | 'uploaded'
  | 'ready'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** حالاتٌ نهائية — لا انتقال بعدها، ولا يجوز لحالة عميل قديمة أن تتجاوزها. */
export const TERMINAL_STATUSES: ReadonlySet<ImportJobStatus> = new Set(['completed', 'failed', 'cancelled']);

/** الحالات التي يصح فيها استدعاء `/apply`. */
export const APPLICABLE_STATUSES: ReadonlySet<ImportJobStatus> = new Set(['ready', 'processing', 'completed']);

/** الحالات التي يصح فيها الإلغاء. */
export const CANCELLABLE_STATUSES: ReadonlySet<ImportJobStatus> = new Set(['uploaded', 'ready']);

/** معاينةٌ أحادية الاستعمال يحفظها الخادم (IMP-H1-S3b) — تُرفَق بإنشاء التشغيلة فيُنفَّذ ما عُوين حرفياً. */
export interface ImportBinding {
  id: string;
  hash: string;
  expires_at: string;
}

export interface ImportJob {
  id: string;
  domain: ImportJobDomain;
  /** الفرع الذي أُنشئت فيه التشغيلة؛ ثابتٌ بعد الإنشاء (IMP-H1-S3a). */
  branch_id?: string | null;
  /** مربوطةٌ بمعاينة (خياراتها مجمَّدة منذ الإنشاء). */
  preview_bound?: boolean;
  /** الهدف المجمَّد لمجال أعداد الجرد (معرّف الجرد)؛ غائب لغيره. */
  target_id?: string | null;
  /** تشغيلة إصلاح فرعية: معرّف التشغيلة الأم الفاشلة (IMP-H1-S8b)؛ `null` لغيرها. */
  parent_job_id?: string | null;
  /** عدد الوحدات الفاشلة/غير المنجزة القابلة للإصلاح — يظهر في عرض التشغيلة المفردة فقط (IMP-H1-S8a). */
  failed_units?: number;
  status: ImportJobStatus;
  original_filename: string;
  extension: string;
  byte_size: number;
  content_sha256: string;
  media_archive: { original_filename: string; byte_size: number; content_sha256: string } | null;
  row_count: number | null;
  column_count: number | null;
  processed_rows: number;
  apply_result: Record<string, unknown> | null;
  error_message: string | null;
  created_by: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  purge_after: string | null;
  created_at: string;
  updated_at: string;
}

/** خيارات `/apply` — حقلٌ فضفاض عمداً، يفهم كل مجالٍ حقوله وحدها (انظر `ApplyImportJobRequest`). */
export type ApplyOptions = Record<string, string | number | boolean | Record<number, string | null> | number[] | undefined>;

/**
 * خيارات الإنشاء كحقول multipart متداخلة `options[...]` — مطابقة الأعمدة تُرسَل كما في المعاينة والتطبيق تماماً (العمود المتجاهَل
 * `ignore` صراحةً) كي تتطابق بصمة المعاينة حرفياً.
 */
function appendOptions(form: FormData, options: ApplyOptions) {
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue;
    if (key === 'mapping' && value && typeof value === 'object') {
      // مطابقة فارغة = لا مطابقة (كالمعاينة: multipart لا يرسل مصفوفةً فارغة)، فتتطابق البصمة.
      for (const [index, field] of Object.entries(value as Record<number, string | null>)) {
        form.append(`options[mapping][${index}]`, field ?? 'ignore');
      }
      continue;
    }
    if (Array.isArray(value)) {
      // قائمة أعداد (مثل صفوف التكرار المؤكَّد): عناصر `options[key][]`؛ القائمة الفارغة لا تُرسَل (كالمعاينة: multipart لا يحمل مصفوفةً فارغة).
      value.forEach((item) => form.append(`options[${key}][]`, String(item)));
      continue;
    }
    form.append(`options[${key}]`, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
  }
}

/**
 * خياراتها مجمَّدة منذ الإنشاء: مربوطةٌ بمعاينة، أو تشغيلة إصلاح فرعية ترث خيارات أمّها. تنفيذ مثل هذه التشغيلة لا يحمل خياراتٍ دلالية (`{}`)؛ وإرسال خيارات
 * الصفحة الحالية لها يُرفض أو يُقرأ خطأً، وتشغيلةٌ لا تنطبق عليها لا تُستأنف من رابط (IMP-WIZARD-STATE-01).
 */
export function hasFrozenOptions(job: { preview_bound?: boolean; parent_job_id?: string | null }): boolean {
  return Boolean(job.preview_bound) || Boolean(job.parent_job_id);
}

export async function createImportJob(
  domain: ImportJobDomain,
  file: File,
  idempotencyKey?: string,
  mediaArchive?: File | null,
  bound?: { binding: ImportBinding; options: ApplyOptions } | null
): Promise<ImportJob> {
  const form = new FormData();
  form.append('domain', domain);
  form.append('file', file);
  if (mediaArchive) form.append('media_archive', mediaArchive);
  if (idempotencyKey) form.append('idempotency_key', idempotencyKey);
  if (bound) {
    form.append('preview_id', bound.binding.id);
    form.append('preview_hash', bound.binding.hash);
    appendOptions(form, bound.options);
  }

  const response = await api<{ data: ImportJob }>('/import-jobs', { method: 'POST', body: form });
  return response.data;
}

export async function getImportJob(id: string): Promise<ImportJob> {
  const response = await api<{ data: ImportJob }>(`/import-jobs/${id}`);
  return response.data;
}

/** يرحّل قطعةً واحدة — قد تُنجز التشغيلة كلّها (مصنّف/رصيد افتتاحي) أو جزءاً منها (كتالوج). */
export async function applyImportJobChunk(id: string, options: ApplyOptions): Promise<ImportJob> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue;
    if (key === 'mapping' && value && typeof value === 'object') {
      if (Object.keys(value as object).length === 0) continue; // مطابقة فارغة لا تُرسَل (انظر `appendOptions`).
      body.mapping = Object.fromEntries(
        Object.entries(value as Record<number, string | null>).map(([index, field]) => [index, field ?? 'ignore'])
      );
      continue;
    }
    body[key] = value;
  }

  const response = await api<{ data: ImportJob }>(`/import-jobs/${id}/apply`, { method: 'POST', body });
  return response.data;
}

export async function cancelImportJob(id: string): Promise<ImportJob> {
  const response = await api<{ data: ImportJob }>(`/import-jobs/${id}/cancel`, { method: 'POST' });
  return response.data;
}

/**
 * ينزّل الصفوف الفاشلة بقيمها الأصلية + معرّف المصدر `_awj_unit_ref` ورمز الخطأ (IMP-H1-S8a). XLSX دائماً: CSV يسبق قيمَ `= + - @` بعلامة
 * اقتباس (حماية من حقن الصيغ) فتتشوّه عند إعادة الرفع، والخادم يرفض CSV يحمل تلك العلامة.
 */
export function downloadImportFailures(id: string): Promise<DownloadOutcome> {
  return downloadFile(`/import-jobs/${id}/failures?format=xlsx`, 'failures.xlsx');
}

/**
 * تشغيلة إصلاح **فرعية** من الملف المصحَّح (IMP-H1-S8b). المجال والفرع من التشغيلة الأم؛ كل صفٍّ يحمل `_awj_unit_ref` كما نزل. تُرحَّل بعدها
 * كأي تشغيلة (`applyImportJobChunk`) — الخادم هو من يطالب بالوحدات وحدةً وحدة.
 */
export async function createRepairJob(parentId: string, file: File, idempotencyKey?: string): Promise<ImportJob> {
  const form = new FormData();
  form.append('file', file);
  if (idempotencyKey) form.append('idempotency_key', idempotencyKey);

  const response = await api<{ data: ImportJob }>(`/import-jobs/${parentId}/repairs`, { method: 'POST', body: form });
  return response.data;
}
