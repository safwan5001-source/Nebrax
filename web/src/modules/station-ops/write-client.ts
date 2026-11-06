import { api, ApiError } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { isValidShiftId } from './read-client';
import { collectionResponse, type CollectionBody, type CollectionView } from './collection';
import { shiftDetailResponse, type ShiftDetail } from './schemas';

/**
 * UI-2 — عميل الكتابة الوحيد لمساحة «تشغيل المحطات».
 *
 * - **سبعة إجراءات فقط** (قائمة بيضاء حتمية بالنوع): فتح وردية · إسناد الموظف الحالي · قراءة عداد · قراءة خزان · حركة نقد تشغيلية · إغلاق/تسليم
 *   · **إقرار تحصيل الوردية** (`collection`: توزيع المحصَّل حسب طرق الدفع، تشغيلي فقط — لا سند ولا فاتورة ولا قيد؛ بوابة نشر مغلقة ⇒ 404).
 *   لا اعتماد، لا مبيعات/تحصيل رسمي، لا أسعار، لا PUT/PATCH/DELETE. المستدعي لا يمرّر مساراً أبداً — المسار يُبنى هنا من المعرّف المُحقَّق.
 * - يمرّ عبر `api()` المشترك: نفس Bearer ونفس معالجة 401. `X-Branch-Id` = فرع المحطة المختارة (طلب لا إذن؛ الخادم يتجاهل ما خارج نطاق المستخدم).
 * - **نتيجة صادقة بأربع حالات** (لا استثناءات تُبتلع): `ok` مؤكد من الخادم · `unverified` (2xx بجسم غير مفهوم) · `rejected` (الخادم رفض — لا أثر)
 *   · `unknown` (مهلة/انقطاع/5xx بعد الإرسال — **قد تكون العملية تمت**: تُعاد القراءة ولا تُعاد الكتابة عمياء) · `not_sent` (لم يُرسَل شيء).
 * - لا إعادة محاولة تلقائية أبداً.
 */

export type WriteAction = 'open' | 'assign_staff' | 'meter_reading' | 'tank_reading' | 'cash_movement' | 'close' | 'collection' | 'approve' | 'review_cash_variance' | 'review_collection';

export type WriteRequest =
  | { action: 'open'; body: { fuel_station_id: string; idempotency_key: string; opening_float_minor?: number } }
  | { action: 'assign_staff'; shiftId: string; body: { user_id: string; role: 'attendant' } }
  | { action: 'meter_reading'; shiftId: string; body: { fuel_nozzle_id: string; reading_stage: 'opening' | 'closing'; meter_milliliters: number; evidence_key: string } }
  | { action: 'tank_reading'; shiftId: string; body: { fuel_tank_id: string; reading_stage: 'opening' | 'closing'; reading_type: 'physical' | 'atg'; quantity_milliliters: number; evidence_key: string } }
  | { action: 'cash_movement'; shiftId: string; body: { type: 'cash_in' | 'cash_out' | 'expense'; amount_minor: number; reason: string; idempotency_key: string } }
  | { action: 'close'; shiftId: string; body: { counted_cash_minor: number; closing_note?: string } }
  // اعتماد المشرف (واجهات الخادم القائمة نفسها؛ الصلاحيات والقواعد يفرضها الخادم): اعتماد الوردية المغلقة ومراجعة فرق نقد الدرج
  | { action: 'approve'; shiftId: string; body: { note?: string } }
  | { action: 'review_cash_variance'; shiftId: string; body: { note: string } };

/** مراجعة المشرف لفرق مطابقة التحصيل: ردّها عرض التحصيل (لا الوردية) فله دالة مستقلة `opsWriteReviewCollection`. */
type ReviewCollectionRequest = { action: 'review_collection'; shiftId: string; body: { note: string } };

/** إقرار تحصيل الوردية: نتيجته من نوع مختلف (`CollectionWriteResult`) فله دالة مستقلة `opsWriteCollection`. */
type CollectionRequest = { action: 'collection'; shiftId: string; body: CollectionBody };
type AnyRequest = WriteRequest | CollectionRequest | ReviewCollectionRequest;

export type RejectionCode =
  // رسائل الخادم المعروفة (تصنيف بالنص — الخادم يعيد 422 + رسالة عربية حرة)
  | 'shift_already_open' | 'idempotency_conflict' | 'float_required' | 'station_branch' | 'station_inactive' | 'shift_not_open'
  | 'reading_exists' | 'evidence_conflict' | 'asset_unavailable' | 'staff_already_assigned' | 'cash_exceeds_balance' | 'closing_below_opening'
  | 'close_needs_readings' | 'close_needs_staff' | 'close_blocked_cash_variance' | 'close_blocked_tank_variance' | 'tank_type_mismatch'
  // إقرار التحصيل: رموز مسبوقة بـFUEL_COLLECTION_ (رسالة) أو `reason` في جسم 409
  | 'collection_method_not_allowed' | 'collection_methods_changed' | 'collection_invalid' | 'collection_stale_revision'
  // شرط الإغلاق (Q1/Q3) عند رفض `close`
  | 'collection_required' | 'collection_incomplete' | 'collection_no_methods' | 'collection_reason_required'
  // اعتماد المشرف ومراجعة الفروق
  | 'approve_needs_closed' | 'approve_needs_other_supervisor' | 'collection_review_required' | 'cash_variance_review_required' | 'review_already_done' | 'review_not_needed' | 'review_needs_closed'
  // حالات HTTP
  | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'rate_limited' | 'validation' | 'demo';

const KNOWN_MESSAGES: ReadonlyArray<[RegExp, RejectionCode]> = [
  [/FUEL_COLLECTION_METHOD_NOT_ALLOWED/, 'collection_method_not_allowed'],
  [/FUEL_COLLECTION_METHODS_CHANGED/, 'collection_methods_changed'],
  [/FUEL_COLLECTION_INVALID/, 'collection_invalid'],
  [/FUEL_COLLECTION_REVIEW_REQUIRED/, 'collection_review_required'],
  [/FUEL_CASH_VARIANCE_REVIEW_REQUIRED/, 'cash_variance_review_required'],
  [/لا تعتمد إلا وردية مغلقة/, 'approve_needs_closed'],
  [/مشرف مختلف عن فاتح الشفت/, 'approve_needs_other_supervisor'],
  [/(تمت مراجعة فرق النقد|روجع فرق التحصيل).*بالفعل/, 'review_already_done'],
  [/لا يوجد فرق (نقد|تحصيل)/, 'review_not_needed'],
  [/لا (تراجع|تراجَع) .*(إلا بعد إغلاق|إلا لوردية مغلقة)/, 'review_needs_closed'],
  [/FUEL_COLLECTION_REQUIRED/, 'collection_required'],
  [/FUEL_COLLECTION_INCOMPLETE/, 'collection_incomplete'],
  [/FUEL_COLLECTION_NO_METHODS/, 'collection_no_methods'],
  [/FUEL_COLLECTION_REASON_REQUIRED/, 'collection_reason_required'],
  [/FUEL_COLLECTION_STALE_REVISION/, 'collection_stale_revision'],
  [/FUEL_COLLECTION_IDEMPOTENCY_CONFLICT/, 'idempotency_conflict'],
  [/توجد وردية وقود مفتوحة/, 'shift_already_open'],
  [/مفتاح منع التكرار استُخدم/, 'idempotency_conflict'],
  [/تتطلب تسجيل float/, 'float_required'],
  [/محطة الشفت لا تخص الفرع النشط/, 'station_branch'],
  [/محطة غير نشطة/, 'station_inactive'],
  [/الشفت ليس مفتوحاً/, 'shift_not_open'],
  [/مفتاح دليل قراءة .* لسجل مختلف/, 'evidence_conflict'],
  [/مسجلة بالفعل/, 'reading_exists'],
  [/(الفوهة لا تنتمي|الخزان لا ينتمي)/, 'asset_unavailable'],
  [/العامل مسند بالفعل/, 'staff_already_assigned'],
  [/يتجاوز الرصيد التشغيلي المتوقع/, 'cash_exceeds_balance'],
  [/قراءة إغلاق العداد لا تكون أقل/, 'closing_below_opening'],
  [/تتطلب قراءات .* لكل أصول المحطة النشطة/, 'close_needs_readings'],
  [/تتطلب إسناد عامل/, 'close_needs_staff'],
  [/تمنع إغلاق الشفت قبل حل فرق النقد/, 'close_blocked_cash_variance'],
  [/فرق خزان تشغيلي خارج التفاوت/, 'close_blocked_tank_variance'],
  [/نوع قراءة فتح وإغلاق الخزان/, 'tank_type_mismatch'],
];

export function classifyRejection(status: number, message: string | null | undefined, body?: unknown): RejectionCode {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) {
    // إقرار التحصيل يعيد `reason` منظّماً: نسخة أساس قديمة (جهاز آخر) ≠ مفتاح مستخدم لإقرار مختلف.
    const reason = body && typeof body === 'object' ? (body as { reason?: unknown }).reason : undefined;
    if (reason === 'stale_revision') return 'collection_stale_revision';
    if (reason === 'idempotency_conflict') return 'idempotency_conflict';
    return 'conflict';
  }
  if (status === 429) return 'rate_limited';
  if (message) for (const [pattern, code] of KNOWN_MESSAGES) if (pattern.test(message)) return code;
  return 'validation';
}

export type WriteResult =
  | { kind: 'ok'; shift: ShiftDetail }
  | { kind: 'unverified' }
  | { kind: 'rejected'; status: number; code: RejectionCode; serverMessage: string | null }
  | { kind: 'unknown'; reason: 'timeout' | 'network' | 'server' }
  | { kind: 'not_sent'; reason: 'offline' | 'demo' };

export const WRITE_TIMEOUT_MS = 25_000;

function buildPath(request: AnyRequest): string {
  if (request.action === 'open') return '/fuel-stations/shifts/open';
  if (!isValidShiftId(request.shiftId)) throw new Error('station-ops: invalid shift id for write');
  const base = `/fuel-stations/shifts/${request.shiftId}`;
  switch (request.action) {
    case 'assign_staff': return `${base}/staff`;
    case 'meter_reading': return `${base}/meter-readings`;
    case 'tank_reading': return `${base}/tank-readings`;
    case 'cash_movement': return `${base}/cash-movements`;
    case 'close': return `${base}/close`;
    case 'collection': return `${base}/collection`;
    case 'approve': return `${base}/approve`;
    case 'review_cash_variance': return `${base}/cash-variance/review`;
    case 'review_collection': return `${base}/collection/review`;
  }
}

/** أعداد الهللات/mL صحيحة آمنة حصراً قبل أي إرسال (لا float ولا NaN يصل إلى الخادم). */
function assertIntegers(request: AnyRequest): void {
  const numbers: Array<number | undefined> = [];
  if (request.action === 'open') numbers.push(request.body.opening_float_minor);
  else if (request.action === 'meter_reading') numbers.push(request.body.meter_milliliters);
  else if (request.action === 'tank_reading') numbers.push(request.body.quantity_milliliters);
  else if (request.action === 'cash_movement') numbers.push(request.body.amount_minor);
  else if (request.action === 'close') numbers.push(request.body.counted_cash_minor);
  else if (request.action === 'collection') numbers.push(request.body.base_revision, ...request.body.lines.map((line) => line.amount_minor));
  for (const value of numbers) if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new Error('station-ops: amounts must be non-negative safe integers');
}

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError';
}

type NonOk = Exclude<WriteResult, { kind: 'ok' }>;

/** الإرسال المشترك: يعيد الجسم الخام عند 2xx أو نتيجة صادقة غير ناجحة. لا إعادة محاولة تلقائية. */
async function send(request: AnyRequest, options: { branchId?: string | null; timeoutMs?: number }): Promise<{ raw: unknown } | NonOk> {
  assertIntegers(request);
  const path = buildPath(request);
  if (isDemo()) return { kind: 'not_sent', reason: 'demo' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { kind: 'not_sent', reason: 'offline' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? WRITE_TIMEOUT_MS);
  try {
    const headers = options.branchId ? { 'X-Branch-Id': options.branchId } : undefined;
    const raw = await api<unknown>(path, { method: 'POST', body: request.body, signal: controller.signal, ...(headers ? { headers } : {}) });
    return { raw };
  } catch (error) {
    if (error instanceof ApiError) {
      const message = typeof error.message === 'string' && error.message !== 'حدث خطأ' ? error.message : null;
      // 5xx بعد الإرسال: قد يكون الالتزام تمّ قبل الخطأ ⇒ غير مؤكد. 4xx = رفض نهائي بلا أثر.
      if (error.status >= 500) return { kind: 'unknown', reason: 'server' };
      return { kind: 'rejected', status: error.status, code: classifyRejection(error.status, message, error.body), serverMessage: message };
    }
    if (isAbort(error)) return { kind: 'unknown', reason: 'timeout' };
    return { kind: 'unknown', reason: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

export async function opsWrite(request: WriteRequest, options: { branchId?: string | null; timeoutMs?: number } = {}): Promise<WriteResult> {
  const sent = await send(request, options);
  if (!('raw' in sent)) return sent;
  const parsed = shiftDetailResponse.safeParse(sent.raw);
  return parsed.success ? { kind: 'ok', shift: parsed.data.data } : { kind: 'unverified' };
}

/** نتيجة حفظ إقرار التحصيل: ناجحة بالعرض الجديد، أو أي نتيجة غير ناجحة بالدلالات نفسها (`rejected`/`unknown`/`unverified`/`not_sent`). */
export type CollectionWriteResult = NonOk | { kind: 'ok'; view: CollectionView; replayed: boolean; unchanged: boolean };

export async function opsWriteCollection(shiftId: string, body: CollectionBody, options: { branchId?: string | null; timeoutMs?: number } = {}): Promise<CollectionWriteResult> {
  const sent = await send({ action: 'collection', shiftId, body }, options);
  if (!('raw' in sent)) return sent;
  const parsed = collectionResponse.safeParse(sent.raw);
  return parsed.success ? { kind: 'ok', view: parsed.data.data, replayed: parsed.data.meta?.replayed ?? false, unchanged: parsed.data.meta?.unchanged ?? false } : { kind: 'unverified' };
}

/** مراجعة المشرف لفرق مطابقة التحصيل (`POST …/collection/review`، `fuel.shift.cash_variance_review`): النجاح يُعلَن فقط إن أعاد الخادم `review.state = reviewed`. */
export async function opsWriteReviewCollection(shiftId: string, note: string, options: { branchId?: string | null; timeoutMs?: number } = {}): Promise<CollectionWriteResult> {
  const sent = await send({ action: 'review_collection', shiftId, body: { note } }, options);
  if (!('raw' in sent)) return sent;
  const parsed = collectionResponse.safeParse(sent.raw);
  return parsed.success ? { kind: 'ok', view: parsed.data.data, replayed: false, unchanged: false } : { kind: 'unverified' };
}
