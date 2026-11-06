import type { z } from 'zod';
import { api, ApiError, downloadFile, fetchPrivateFileUrl } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { StationOpsError, isAbort, toStationOpsError } from '../read-client';
import { attachmentsResponse, deliveryResponse, readingResponse, receiptDocumentResponse, receiptReportResponse, type Attachment, type Delivery, type ReceiptDocument, type ReceiptReport, type TankReading } from './schemas';

/**
 * FUEL-B5/B5.1 — العميل الوحيد لدورة استلام الوقود داخل «تشغيل المحطات».
 *
 * - **قراءة بقائمة بيضاء**: قائمة الاستلامات · كشف الاستلامات · استلام بمعرّف UUID مُحقَّق وسنده ومرفقاته · موردو الاستلام · قراءات الخزانات.
 * - **كتابات محددة فقط** تمرّ كلها من مرسِل واحد `send()`: تسجيل قراءة خزان · إنشاء **مسودة** · اعتماد · **تسجيل التكلفة** · رفع مرفقات السند · حذف مرفق مسودة.
 *   لا PUT/PATCH، ولا مسار يمرّره المستدعي، ولا «رفض/تعديل/إلغاء استلام» (غير موجودة في الخادم فلا تُخترع).
 * - تنزيل/معاينة الملفات (مرفق، Excel) عبر مساعدَي `fetchPrivateFileUrl`/`downloadFile` المركزيين (مصادقة API + الفرع)، لا `fetch` مباشر.
 * - نتيجة الكتابة صادقة: `ok` (مؤكد بردّ الخادم) · `unverified` · `rejected` (4xx: لا أثر) · `unknown` (مهلة/انقطاع/5xx بعد الإرسال: **قد تكون تمّت** —
 *   تُقرأ الحالة ولا تُنشأ عملية جديدة تلقائياً) · `not_sent`. لا إعادة محاولة تلقائية أبداً.
 * - السلطة كلها للخادم (الصلاحيات الدقيقة، نطاق المحطة/الفرع/المخزن، فصل المعتمِد، سلطة التكلفة، idempotency): هذا العميل لا يمنح ولا يتجاوز.
 */

const UUID = '[0-9a-fA-F-]{36}';
const READ_PATHS: RegExp[] = [
  /^\/fuel-stations\/deliveries$/,
  /^\/fuel-stations\/deliveries\/report$/,
  new RegExp(`^/fuel-stations/deliveries/${UUID}$`),
  new RegExp(`^/fuel-stations/deliveries/${UUID}/document$`),
  new RegExp(`^/fuel-stations/deliveries/${UUID}/attachments$`),
  /^\/fuel-stations\/delivery-suppliers$/,
  /^\/fuel-stations\/readings$/,
];

export function isValidDeliveryId(id: string): boolean {
  return new RegExp(`^${UUID}$`).test(id);
}

export function deliveryPath(id: string): string {
  if (!isValidDeliveryId(id)) throw new StationOpsError('not_found', 404);
  return `/fuel-stations/deliveries/${id}`;
}

export function isAllowedReceivingReadPath(path: string): boolean {
  return READ_PATHS.some((pattern) => pattern.test(path));
}

export type ReceivingQuery = Record<string, string | number | undefined>;

export async function receivingGet<S extends z.ZodTypeAny>(path: string, schema: S, options: { query?: ReceivingQuery; signal?: AbortSignal; branchId?: string | null } = {}): Promise<z.infer<S>> {
  if (!isAllowedReceivingReadPath(path)) throw new Error(`station-ops/receiving: path is not an allowed read endpoint: ${path}`);
  if (isDemo()) throw new StationOpsError('demo');

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined && value !== '') search.set(key, String(value));
  const url = search.size > 0 ? `${path}?${search.toString()}` : path;

  let body: unknown;
  try {
    const headers = options.branchId ? { 'X-Branch-Id': options.branchId } : undefined;
    body = await api<unknown>(url, { method: 'GET', signal: options.signal, ...(headers ? { headers } : {}) });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw toStationOpsError(error);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new StationOpsError('invalid_shape');
  return parsed.data;
}

// ───────────────────────── الكتابات الثلاث ─────────────────────────

export type RejectionCode =
  | 'cost_required' | 'cost_locked' | 'cost_changed' | 'note_required' | 'attachment_invalid' | 'attachment_limit' | 'attachment_locked'
  | 'idempotency_mismatch' | 'duplicate' | 'distinct_approver' | 'already_approved' | 'grni_missing' | 'cost_baseline' | 'warehouse_mismatch' | 'tank_mismatch'
  | 'product_inactive' | 'quantity_invalid' | 'cost_invalid' | 'evidence_exists' | 'reading_mismatch' | 'order_mismatch'
  | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'rate_limited' | 'validation' | 'demo';

const KNOWN: ReadonlyArray<[RegExp, RejectionCode]> = [
  [/FUEL_DELIVERY_COST_REQUIRED/, 'cost_required'],
  [/FUEL_DELIVERY_COST_LOCKED/, 'cost_locked'],
  [/FUEL_DELIVERY_COST_CHANGED/, 'cost_changed'],
  [/FUEL_DELIVERY_NOTE_REQUIRED/, 'note_required'],
  [/لا يمكن حذف مرفق/, 'attachment_locked'],
  [/الحد الأقصى \d+ مرفقات|مرفقات في الطلب/, 'attachment_limit'],
  [/الأنواع المسموحة|حجم الملف|نوع الملف|امتداد الملف|الصورة تالفة|أبعاد الصورة|اسم الملف|تعذر قراءة الملف|ملف غير صالح/, 'attachment_invalid'],
  [/FUEL_IDEMPOTENCY_PAYLOAD_MISMATCH/, 'idempotency_mismatch'],
  [/FUEL_DELIVERY_DUPLICATE/, 'duplicate'],
  [/FUEL_DISTINCT_APPROVER_REQUIRED/, 'distinct_approver'],
  [/معتمد سابقاً|غير مسوّد/, 'already_approved'],
  [/GRNI/, 'grni_missing'],
  [/FUEL_COST_BASELINE_REQUIRED/, 'cost_baseline'],
  [/مخزن المحطة الصريح/, 'warehouse_mismatch'],
  [/الخزان أو منتج الوقود لا ينتمي/, 'tank_mismatch'],
  [/منتج الوقود يجب أن يكون نشطاً/, 'product_inactive'],
  [/الكمية المستلمة فعلياً|كمية الوقود|مطلوب باللترات/, 'quantity_invalid'],
  [/هللات صحيحة/, 'cost_invalid'],
  [/مفتاح دليل القياس مستخدم/, 'evidence_exists'],
  [/دليل قراءة الاستلام|نوع دليل القراءة/, 'reading_mismatch'],
  [/مرجع أمر الشراء/, 'order_mismatch'],
];

export function classifyRejection(status: number, message: string | null | undefined): RejectionCode {
  if (status === 409 && message && /FUEL_DELIVERY_COST_CHANGED/.test(message)) return 'cost_changed';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (message) for (const [pattern, code] of KNOWN) if (pattern.test(message)) return code;
  return 'validation';
}

export type WriteFailure =
  | { kind: 'unverified' }
  | { kind: 'rejected'; status: number; code: RejectionCode; serverMessage: string | null }
  | { kind: 'unknown'; reason: 'timeout' | 'network' | 'server' }
  | { kind: 'not_sent'; reason: 'offline' | 'demo' };

export type DeliveryWrite = { kind: 'ok'; delivery: Delivery } | WriteFailure;
export type ReadingWrite = { kind: 'ok'; reading: TankReading } | WriteFailure;

export const WRITE_TIMEOUT_MS = 25_000;

async function send(path: string, body: unknown, options: { timeoutMs?: number; branchId?: string | null; method?: 'POST' | 'DELETE' }): Promise<{ raw: unknown; status: number } | WriteFailure> {
  if (isDemo()) return { kind: 'not_sent', reason: 'demo' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { kind: 'not_sent', reason: 'offline' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? WRITE_TIMEOUT_MS);
  try {
    const headers = options.branchId ? { 'X-Branch-Id': options.branchId } : undefined;
    const raw = await api<unknown>(path, { method: options.method ?? 'POST', body, signal: controller.signal, ...(headers ? { headers } : {}) });
    return { raw, status: 200 };
  } catch (error) {
    if (error instanceof ApiError) {
      // 5xx بعد الإرسال: قد يكون الالتزام تمّ قبل الخطأ ⇒ غير مؤكد. 4xx = رفض نهائي بلا أثر.
      if (error.status >= 500) return { kind: 'unknown', reason: 'server' };
      const message = typeof error.message === 'string' && error.message !== 'حدث خطأ' ? error.message : null;
      return { kind: 'rejected', status: error.status, code: classifyRejection(error.status, message), serverMessage: message };
    }
    if (isAbort(error)) return { kind: 'unknown', reason: 'timeout' };
    return { kind: 'unknown', reason: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

export interface ReadingBody { fuel_station_id: string; fuel_tank_id: string; reading_type: 'physical' | 'atg'; quantity_liters: string; evidence_key: string }

export interface DeliveryBody {
  fuel_station_id: string;
  fuel_tank_id: string;
  fuel_product_id: string;
  warehouse_id: string;
  supplier_id: string;
  dispatched_liters: string;
  received_liters: string;
  idempotency_key: string;
  purchase_reference?: string;
  delivery_note_number?: string;
  tanker_identifier?: string;
  driver_name?: string;
  notes?: string;
  before_physical_reading_id?: string;
  after_physical_reading_id?: string;
  before_atg_reading_id?: string;
  after_atg_reading_id?: string;
}

type Options = { timeoutMs?: number; branchId?: string | null };
export type ReceivingExportVariant = 'operational' | 'financial';

export async function recordReading(body: ReadingBody, options: Options = {}): Promise<ReadingWrite> {
  const sent = await send('/fuel-stations/readings', body, options);
  if (!('raw' in sent)) return sent;
  const parsed = readingResponse.safeParse(sent.raw);
  return parsed.success ? { kind: 'ok', reading: parsed.data.data } : { kind: 'unverified' };
}

export async function createDelivery(body: DeliveryBody, options: Options = {}): Promise<DeliveryWrite> {
  const sent = await send('/fuel-stations/deliveries', body, options);
  if (!('raw' in sent)) return sent;
  const parsed = deliveryResponse.safeParse(sent.raw);
  return parsed.success ? { kind: 'ok', delivery: parsed.data.data } : { kind: 'unverified' };
}

export async function approveDelivery(id: string, body: { reason?: string; expected_total_cost_minor?: number }, options: Options = {}): Promise<DeliveryWrite> {
  const path = `${deliveryPath(id)}/approve`;
  const sent = await send(path, body, options);
  if (!('raw' in sent)) return sent;
  const parsed = deliveryResponse.safeParse(sent.raw);
  return parsed.success ? { kind: 'ok', delivery: parsed.data.data } : { kind: 'unverified' };
}

// ───────────────────────── B5.1: التكلفة والمرفقات ─────────────────────────

/** تسجيل (أو تصحيح قبل الاعتماد) تكلفة الاستلام الفعلية الإجمالية بالهللات — موجبة فقط. سلطتها مالية (يفرضها الخادم)، ولا أثر مخزني أو محاسبي. */
export async function recordCost(id: string, totalCostMinor: number, options: Options = {}): Promise<DeliveryWrite> {
  if (!Number.isSafeInteger(totalCostMinor) || totalCostMinor < 1) return { kind: 'rejected', status: 422, code: 'cost_invalid', serverMessage: null };
  const sent = await send(`${deliveryPath(id)}/cost`, { received_total_cost_minor: totalCostMinor }, options);
  if (!('raw' in sent)) return sent;
  const parsed = deliveryResponse.safeParse(sent.raw);
  return parsed.success ? { kind: 'ok', delivery: parsed.data.data } : { kind: 'unverified' };
}

export type AttachmentsWrite = { kind: 'ok'; attachments: Attachment[] } | WriteFailure;

/** رفع ملف أو أكثر (≤ 5 في الطلب) كمرفقات سند. الخادم يفحص المحتوى الفعلي والنوع والحجم والتكرار (SHA-256 فيعيد الموجود). */
export async function uploadAttachments(id: string, files: File[], options: Options = {}): Promise<AttachmentsWrite> {
  const form = new FormData();
  for (const file of files) form.append('attachments[]', file, file.name);
  const sent = await send(`${deliveryPath(id)}/attachments`, form, { ...options, timeoutMs: options.timeoutMs ?? 90_000 });
  if (!('raw' in sent)) return sent;
  const parsed = attachmentsResponse.safeParse(sent.raw);
  return parsed.success ? { kind: 'ok', attachments: parsed.data.data } : { kind: 'unverified' };
}

export function attachmentPath(deliveryId: string, attachmentId: string): string {
  if (!isValidDeliveryId(deliveryId) || !new RegExp(`^${UUID}$`).test(attachmentId)) throw new StationOpsError('not_found', 404);
  return `${deliveryPath(deliveryId)}/attachments/${attachmentId}`;
}

export type VoidWrite = { kind: 'ok' } | WriteFailure;

/** حذف مرفق **مسودة** فقط (الخادم يرفض المعتمد). */
export async function deleteAttachment(deliveryId: string, attachmentId: string, options: Options = {}): Promise<VoidWrite> {
  const sent = await send(attachmentPath(deliveryId, attachmentId), undefined, { ...options, method: 'DELETE' });
  return 'raw' in sent ? { kind: 'ok' } : sent;
}

/** معاينة مرفق: رابط blob محلي بعد جلبه بمصادقة API (المستدعي يلغيه). يفشل صراحةً لا صامتاً. */
export async function attachmentPreviewUrl(deliveryId: string, attachmentId: string, expectedMime?: string): Promise<string> {
  return fetchPrivateFileUrl(`${attachmentPath(deliveryId, attachmentId)}/download`, expectedMime);
}

export async function downloadAttachment(deliveryId: string, attachmentId: string, fallbackName: string): Promise<'downloaded' | 'demo-unavailable'> {
  return downloadFile(`${attachmentPath(deliveryId, attachmentId)}/download`, fallbackName);
}

// ───────────────────────── B5.1: السند والكشف والتصدير ─────────────────────────

/** النسخة المالية يرفضها الخادم 403 لغير المخوَّل؛ الافتراضية تشغيلية بلا أي مبلغ. */
export async function getReceiptDocument(id: string, variant: ReceivingExportVariant, options: { signal?: AbortSignal; branchId?: string | null } = {}): Promise<ReceiptDocument> {
  return (await receivingGet(`${deliveryPath(id)}/document`, receiptDocumentResponse, { ...options, query: { variant } })).data;
}

export async function getReceiptReport(query: ReceivingQuery, variant: ReceivingExportVariant, options: { signal?: AbortSignal; branchId?: string | null } = {}): Promise<ReceiptReport> {
  return (await receivingGet('/fuel-stations/deliveries/report', receiptReportResponse, { ...options, query: { ...query, variant } })).data;
}

function exportQuery(query: ReceivingQuery, variant: ReceivingExportVariant): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...query, variant } as Record<string, string | number | undefined>)) if (value !== undefined && value !== '') search.set(key, String(value));
  return search.toString();
}

export async function downloadReceiptExcel(id: string, variant: ReceivingExportVariant, fallbackName: string): Promise<'downloaded' | 'demo-unavailable'> {
  return downloadFile(`${deliveryPath(id)}/export?${exportQuery({}, variant)}`, fallbackName);
}

export async function downloadReportExcel(query: ReceivingQuery, variant: ReceivingExportVariant, fallbackName: string): Promise<'downloaded' | 'demo-unavailable'> {
  return downloadFile(`/fuel-stations/deliveries/export?${exportQuery(query, variant)}`, fallbackName);
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** رابط blob لملف Excel (للمشاركة): يُجلب بمصادقة API ويُفحص نوعه. المستدعي يلغي الرابط. */
export async function receiptExcelUrl(id: string, variant: ReceivingExportVariant): Promise<string> {
  return fetchPrivateFileUrl(`${deliveryPath(id)}/export?${exportQuery({}, variant)}`, XLSX_MIME);
}

export async function reportExcelUrl(query: ReceivingQuery, variant: ReceivingExportVariant): Promise<string> {
  return fetchPrivateFileUrl(`/fuel-stations/deliveries/export?${exportQuery(query, variant)}`, XLSX_MIME);
}
