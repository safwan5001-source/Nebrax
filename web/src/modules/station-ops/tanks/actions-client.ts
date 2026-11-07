import { api, ApiError } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { isAbort } from '../read-client';
import { classifyRejection, type RejectionCode } from '../receiving/receiving-client';
import { lateRequestResponse, type BackdatingPolicy, type LateRequest } from './schemas';

/**
 * FUEL-B6 (تعديل) — العميل الوحيد لكتابتين خاصتين بالقراءات المتأخرة، بمسارين ثابتين يبنيهما العميل (لا مسار يمرّره المستدعي):
 *  1) **قرار طلب قراءة متأخرة** `POST /fuel-stations/reading-requests/{uuid}/(approve|reject)` — بصلاحية `fuel.reading.late.approve` والنطاق (الخادم يفرضهما ولا اعتماد ذاتي).
 *  2) **سياسة التأريخ الرجعي للمحطة** `PUT /fuel-stations/stations/{uuid}/settings` — مفاتيحها الثلاثة فقط (الخادم يشترط `fuel_stations.manage` + `fuel.governance.manage`).
 * تسجيل القراءة نفسها (وطلب القراءة المتأخرة) يبقى عبر `recordReading` في `receiving-client`. نتيجة صادقة: `ok` · `rejected` (4xx بلا أثر) · `unknown` (مهلة/انقطاع/5xx
 * بعد الإرسال: قد يكون تمّ — تُقرأ الحالة ولا تُعاد تلقائياً) · `not_sent`. لا إعادة محاولة تلقائية.
 */

const UUID = /^[0-9a-fA-F-]{36}$/;
const TIMEOUT_MS = 25_000;

export type ActionFailure =
  | { kind: 'rejected'; status: number; code: RejectionCode; serverMessage: string | null; currentStatus: string | null }
  | { kind: 'unverified' }
  | { kind: 'unknown'; reason: 'timeout' | 'network' | 'server' }
  | { kind: 'not_sent'; reason: 'offline' | 'demo' };

export type DecideResult = { kind: 'ok'; request: LateRequest } | ActionFailure;
export type PolicyResult = { kind: 'ok' } | ActionFailure;

export function requestDecisionPath(id: string, decision: 'approve' | 'reject'): string {
  if (!UUID.test(id)) throw new Error('station-ops/tanks: invalid request id');
  return `/fuel-stations/reading-requests/${id}/${decision}`;
}

export function stationSettingsWritePath(stationId: string): string {
  if (!UUID.test(stationId)) throw new Error('station-ops/tanks: invalid station id');
  return `/fuel-stations/stations/${stationId}/settings`;
}

async function send(path: string, method: 'POST' | 'PUT', body: unknown, branchId?: string | null): Promise<{ raw: unknown } | ActionFailure> {
  if (isDemo()) return { kind: 'not_sent', reason: 'demo' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { kind: 'not_sent', reason: 'offline' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = branchId ? { 'X-Branch-Id': branchId } : undefined;
    return { raw: await api<unknown>(path, { method, body, signal: controller.signal, ...(headers ? { headers } : {}) }) };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status >= 500) return { kind: 'unknown', reason: 'server' };
      const message = typeof error.message === 'string' && error.message !== 'حدث خطأ' ? error.message : null;
      const body = error.body && typeof error.body === 'object' ? (error.body as { current_status?: unknown }) : null;
      return { kind: 'rejected', status: error.status, code: classifyRejection(error.status, message), serverMessage: message, currentStatus: typeof body?.current_status === 'string' ? body.current_status : null };
    }
    if (isAbort(error)) return { kind: 'unknown', reason: 'timeout' };
    return { kind: 'unknown', reason: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/** اعتماد/رفض طلب. الرفض يلزمه `note` (الخادم يفرضه). الإعادة بالقرار نفسه من المقرِّر نفسه آمنة (idempotent)، وقرار مختلف ⇒ 409. */
export async function decideRequest(id: string, decision: 'approve' | 'reject', note: string, branchId?: string | null): Promise<DecideResult> {
  const clean = note.trim();
  const sent = await send(requestDecisionPath(id, decision), 'POST', clean === '' ? {} : { note: clean.slice(0, 500) }, branchId);
  if (!('raw' in sent)) return sent;
  const parsed = lateRequestResponse.safeParse(sent.raw);
  return parsed.success ? { kind: 'ok', request: parsed.data.data } : { kind: 'unverified' };
}

export interface PolicyBody {
  tank_reading_backdating_policy: BackdatingPolicy | null;
  tank_reading_backdating_max_hours: number | null;
  tank_reading_backdating_reason_required: boolean | null;
  reason?: string;
}

/** حفظ تجاوز المحطة. `null` لمفتاح = مسح التجاوز (العودة لإعداد المؤسسة). */
export async function saveBackdatingPolicy(stationId: string, body: PolicyBody, branchId?: string | null): Promise<PolicyResult> {
  const clean: PolicyBody = { ...body };
  if (!clean.reason || clean.reason.trim() === '') delete clean.reason;
  const sent = await send(stationSettingsWritePath(stationId), 'PUT', clean, branchId);
  return 'raw' in sent ? { kind: 'ok' } : sent;
}
