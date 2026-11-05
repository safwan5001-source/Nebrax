import { api, ApiError } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { isValidShiftId } from './read-client';
import { shiftDetailResponse, type ShiftDetail } from './schemas';

/**
 * UI-2 — عميل الكتابة الوحيد لمساحة «تشغيل المحطات».
 *
 * - **ستة إجراءات فقط** (قائمة بيضاء حتمية بالنوع): فتح وردية · إسناد الموظف الحالي · قراءة عداد · قراءة خزان · حركة نقد تشغيلية · إغلاق/تسليم.
 *   لا اعتماد، لا مبيعات/تحصيل، لا أسعار، لا PUT/PATCH/DELETE. المستدعي لا يمرّر مساراً أبداً — المسار يُبنى هنا من المعرّف المُحقَّق.
 * - يمرّ عبر `api()` المشترك: نفس Bearer ونفس معالجة 401. `X-Branch-Id` = فرع المحطة المختارة (طلب لا إذن؛ الخادم يتجاهل ما خارج نطاق المستخدم).
 * - **نتيجة صادقة بأربع حالات** (لا استثناءات تُبتلع): `ok` مؤكد من الخادم · `unverified` (2xx بجسم غير مفهوم) · `rejected` (الخادم رفض — لا أثر)
 *   · `unknown` (مهلة/انقطاع/5xx بعد الإرسال — **قد تكون العملية تمت**: تُعاد القراءة ولا تُعاد الكتابة عمياء) · `not_sent` (لم يُرسَل شيء).
 * - لا إعادة محاولة تلقائية أبداً.
 */

export type WriteAction = 'open' | 'assign_staff' | 'meter_reading' | 'tank_reading' | 'cash_movement' | 'close';

export type WriteRequest =
  | { action: 'open'; body: { fuel_station_id: string; idempotency_key: string; opening_float_minor?: number } }
  | { action: 'assign_staff'; shiftId: string; body: { user_id: string; role: 'attendant' } }
  | { action: 'meter_reading'; shiftId: string; body: { fuel_nozzle_id: string; reading_stage: 'opening' | 'closing'; meter_milliliters: number; evidence_key: string } }
  | { action: 'tank_reading'; shiftId: string; body: { fuel_tank_id: string; reading_stage: 'opening' | 'closing'; reading_type: 'physical' | 'atg'; quantity_milliliters: number; evidence_key: string } }
  | { action: 'cash_movement'; shiftId: string; body: { type: 'cash_in' | 'cash_out' | 'expense'; amount_minor: number; reason: string; idempotency_key: string } }
  | { action: 'close'; shiftId: string; body: { counted_cash_minor: number; closing_note?: string } };

export type RejectionCode =
  // رسائل الخادم المعروفة (تصنيف بالنص — الخادم يعيد 422 + رسالة عربية حرة)
  | 'shift_already_open' | 'idempotency_conflict' | 'float_required' | 'station_branch' | 'station_inactive' | 'shift_not_open'
  | 'reading_exists' | 'evidence_conflict' | 'asset_unavailable' | 'staff_already_assigned' | 'cash_exceeds_balance' | 'closing_below_opening'
  | 'close_needs_readings' | 'close_needs_staff' | 'close_blocked_cash_variance' | 'close_blocked_tank_variance' | 'tank_type_mismatch'
  // حالات HTTP
  | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'rate_limited' | 'validation' | 'demo';

const KNOWN_MESSAGES: ReadonlyArray<[RegExp, RejectionCode]> = [
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

export function classifyRejection(status: number, message: string | null | undefined): RejectionCode {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
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

function buildPath(request: WriteRequest): string {
  if (request.action === 'open') return '/fuel-stations/shifts/open';
  if (!isValidShiftId(request.shiftId)) throw new Error('station-ops: invalid shift id for write');
  const base = `/fuel-stations/shifts/${request.shiftId}`;
  switch (request.action) {
    case 'assign_staff': return `${base}/staff`;
    case 'meter_reading': return `${base}/meter-readings`;
    case 'tank_reading': return `${base}/tank-readings`;
    case 'cash_movement': return `${base}/cash-movements`;
    case 'close': return `${base}/close`;
  }
}

/** أعداد الهللات/mL صحيحة آمنة حصراً قبل أي إرسال (لا float ولا NaN يصل إلى الخادم). */
function assertIntegers(request: WriteRequest): void {
  const numbers: Array<number | undefined> = [];
  if (request.action === 'open') numbers.push(request.body.opening_float_minor);
  else if (request.action === 'meter_reading') numbers.push(request.body.meter_milliliters);
  else if (request.action === 'tank_reading') numbers.push(request.body.quantity_milliliters);
  else if (request.action === 'cash_movement') numbers.push(request.body.amount_minor);
  else if (request.action === 'close') numbers.push(request.body.counted_cash_minor);
  for (const value of numbers) if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new Error('station-ops: amounts must be non-negative safe integers');
}

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError';
}

export async function opsWrite(request: WriteRequest, options: { branchId?: string | null; timeoutMs?: number } = {}): Promise<WriteResult> {
  assertIntegers(request);
  const path = buildPath(request);
  if (isDemo()) return { kind: 'not_sent', reason: 'demo' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { kind: 'not_sent', reason: 'offline' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? WRITE_TIMEOUT_MS);
  let response: unknown;
  try {
    const headers = options.branchId ? { 'X-Branch-Id': options.branchId } : undefined;
    response = await api<unknown>(path, { method: 'POST', body: request.body, signal: controller.signal, ...(headers ? { headers } : {}) });
  } catch (error) {
    if (error instanceof ApiError) {
      const message = typeof error.message === 'string' && error.message !== 'حدث خطأ' ? error.message : null;
      // 5xx بعد الإرسال: قد يكون الالتزام تمّ قبل الخطأ ⇒ غير مؤكد. 4xx = رفض نهائي بلا أثر.
      if (error.status >= 500) return { kind: 'unknown', reason: 'server' };
      return { kind: 'rejected', status: error.status, code: classifyRejection(error.status, message), serverMessage: message };
    }
    if (isAbort(error)) return { kind: 'unknown', reason: 'timeout' };
    return { kind: 'unknown', reason: 'network' };
  } finally {
    clearTimeout(timer);
  }

  const parsed = shiftDetailResponse.safeParse(response);
  return parsed.success ? { kind: 'ok', shift: parsed.data.data } : { kind: 'unverified' };
}
