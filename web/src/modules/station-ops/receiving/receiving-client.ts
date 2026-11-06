import type { z } from 'zod';
import { api, ApiError } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { StationOpsError, isAbort, toStationOpsError } from '../read-client';
import { deliveryResponse, readingResponse, type Delivery, type TankReading } from './schemas';

/**
 * FUEL-B5 — العميل الوحيد لدورة استلام الوقود داخل «تشغيل المحطات».
 *
 * - **قراءة بقائمة بيضاء**: قائمة الاستلامات · استلام بمعرّف UUID مُحقَّق · موردو الاستلام · قراءات الخزانات. (المحطات/الخزانات/المنتجات تُقرأ بعميل القراءة الأم.)
 * - **ثلاث كتابات فقط**، كلها POST: تسجيل قراءة خزان · إنشاء **مسودة** استلام · اعتماد مسودة. لا PUT/PATCH/DELETE، ولا مسار يمرّره المستدعي.
 *   لا يوجد «رفض» أو «تعديل» أو «إلغاء» استلام في الخادم، فلا يُخترع هنا.
 * - نتيجة الكتابة صادقة: `ok` (مؤكد بردّ الخادم) · `unverified` · `rejected` (4xx: لا أثر) · `unknown` (مهلة/انقطاع/5xx بعد الإرسال: **قد تكون تمّت** —
 *   تُقرأ الحالة ولا تُنشأ عملية جديدة تلقائياً) · `not_sent`. لا إعادة محاولة تلقائية أبداً.
 * - السلطة كلها للخادم (الصلاحيات الدقيقة، نطاق المحطة/الفرع/المخزن، فصل المعتمِد، idempotency): هذا العميل لا يمنح ولا يتجاوز.
 */

const UUID = '[0-9a-fA-F-]{36}';
const READ_PATHS: RegExp[] = [
  /^\/fuel-stations\/deliveries$/,
  new RegExp(`^/fuel-stations/deliveries/${UUID}$`),
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
  | 'idempotency_mismatch' | 'duplicate' | 'distinct_approver' | 'already_approved' | 'grni_missing' | 'cost_baseline' | 'warehouse_mismatch' | 'tank_mismatch'
  | 'product_inactive' | 'quantity_invalid' | 'cost_invalid' | 'evidence_exists' | 'reading_mismatch' | 'order_mismatch'
  | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'rate_limited' | 'validation' | 'demo';

const KNOWN: ReadonlyArray<[RegExp, RejectionCode]> = [
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

async function send(path: string, body: unknown, options: { timeoutMs?: number; branchId?: string | null }): Promise<{ raw: unknown; status: number } | WriteFailure> {
  if (isDemo()) return { kind: 'not_sent', reason: 'demo' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { kind: 'not_sent', reason: 'offline' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? WRITE_TIMEOUT_MS);
  try {
    const headers = options.branchId ? { 'X-Branch-Id': options.branchId } : undefined;
    const raw = await api<unknown>(path, { method: 'POST', body, signal: controller.signal, ...(headers ? { headers } : {}) });
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
  received_total_cost_minor: number;
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

export async function approveDelivery(id: string, body: { reason?: string }, options: Options = {}): Promise<DeliveryWrite> {
  const path = `${deliveryPath(id)}/approve`;
  const sent = await send(path, body, options);
  if (!('raw' in sent)) return sent;
  const parsed = deliveryResponse.safeParse(sent.raw);
  return parsed.success ? { kind: 'ok', delivery: parsed.data.data } : { kind: 'unverified' };
}
