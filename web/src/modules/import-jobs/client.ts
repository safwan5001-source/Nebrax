/**
 * عميل تشغيلة الاستيراد الدائم (PR-DUR-1..4) — هوية ملف/تشغيلة واحدة تبقى
 * على الخادم من الرفع حتى الاكتمال. لا إعادة رفع للملف بعد إنشاء التشغيلة:
 * كل نداء لاحق (فحص الحالة، تطبيق قطعة، إلغاء) يخاطب `id` التشغيلة فقط.
 *
 * مطابقٌ حرفياً لعقد الخادم في `ImportJobResource`/`ImportJobController` —
 * لا تُخترع حالة أو حقل غير موجود هناك.
 */

import { api } from '@/lib/api';

export type ImportJobDomain = 'product_catalog' | 'product_workbook' | 'inventory_opening';

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

export interface ImportJob {
  id: string;
  domain: ImportJobDomain;
  status: ImportJobStatus;
  original_filename: string;
  extension: string;
  byte_size: number;
  content_sha256: string;
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
export type ApplyOptions = Record<string, string | number | boolean | Record<number, string | null> | undefined>;

export async function createImportJob(
  domain: ImportJobDomain,
  file: File,
  idempotencyKey?: string
): Promise<ImportJob> {
  const form = new FormData();
  form.append('domain', domain);
  form.append('file', file);
  if (idempotencyKey) form.append('idempotency_key', idempotencyKey);

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
