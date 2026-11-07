import { z } from 'zod';
import { api, ApiError } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { isAbort } from '../read-client';
import { isValidStaffId } from '../admin/admin-client';
import { staffViewSchema } from '../admin/schemas';

/**
 * STATION-PIN — العميل الوحيد لتعيين/إزالة رمز دخول تطبيق المحطات لموظف (المدير فقط، فوق خدمات إدارة الموظفين).
 *
 * - **كتابتان فقط**: `POST` تعيين/تغيير و`DELETE` إزالة على `/fuel-stations/staff/{uuid}/pin` (المعرّف مُحقَّق قبل أي طلب). لا مسار يمرّره المستدعي.
 * - الرمز المولَّد يعود **مرة واحدة** في الاستجابة، ولا يُخزَّن (لا localStorage/sessionStorage/سجل)؛ يحمله المستدعي في الذاكرة حتى يُغلق العرض.
 * - نتيجة صادقة: `ok` مؤكد بشكل الاستجابة · `rejected` (403/404/422/429…) بلا أثر · `unknown` (مهلة/انقطاع/5xx — قد تكون تمت: لا إعادة آلية، يُطلب التحقق
 *   من حالة الرمز) · `not_sent`. السلطة الكاملة للخادم (حراس الإدارة نفسها، منع النفس/المالك، رفض جلسات PIN).
 */

const responseSchema = z.object({
  data: staffViewSchema.extend({ generated_pin: z.string().regex(/^\d{6}$/).optional() }),
});

export type PinStaff = z.infer<typeof responseSchema>['data'];

export type PinRejection = 'forbidden' | 'not_found' | 'validation' | 'unauthorized' | 'rate_limited';

export type PinResult =
  | { kind: 'ok'; staff: PinStaff; generatedPin: string | null }
  | { kind: 'rejected'; status: number; code: PinRejection; serverMessage: string | null }
  | { kind: 'unknown'; reason: 'timeout' | 'network' | 'server' | 'shape' }
  | { kind: 'not_sent'; reason: 'offline' | 'demo' };

export const PIN_TIMEOUT_MS = 25_000;

function pinPath(userId: string): string {
  if (!isValidStaffId(userId)) throw new Error('station-ops/pin: invalid staff id');
  return `/fuel-stations/staff/${userId}/pin`;
}

function codeFor(status: number): PinRejection {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  return 'validation';
}

async function send(method: 'POST' | 'DELETE', userId: string, body: Record<string, unknown>, timeoutMs: number): Promise<PinResult> {
  const path = pinPath(userId);
  if (isDemo()) return { kind: 'not_sent', reason: 'demo' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { kind: 'not_sent', reason: 'offline' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const raw = await api<unknown>(path, { method, body, signal: controller.signal });
    const parsed = responseSchema.safeParse(raw);
    if (!parsed.success) return { kind: 'unknown', reason: 'shape' };
    return { kind: 'ok', staff: parsed.data.data, generatedPin: parsed.data.data.generated_pin ?? null };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status >= 500) return { kind: 'unknown', reason: 'server' };
      const message = typeof error.message === 'string' && error.message !== 'حدث خطأ' ? error.message : null;
      return { kind: 'rejected', status: error.status, code: codeFor(error.status), serverMessage: message };
    }
    if (isAbort(error)) return { kind: 'unknown', reason: 'timeout' };
    return { kind: 'unknown', reason: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/** `pin` غائب ⇒ الخادم يولّد رمزاً عشوائياً ويعيده مرة واحدة. */
export function setStationPin(userId: string, input: { pin?: string; reason?: string }, options: { timeoutMs?: number } = {}): Promise<PinResult> {
  const body: Record<string, unknown> = {};
  if (input.pin) body.pin = input.pin;
  if (input.reason && input.reason.trim() !== '') body.reason = input.reason.trim();
  return send('POST', userId, body, options.timeoutMs ?? PIN_TIMEOUT_MS);
}

export function clearStationPin(userId: string, input: { reason?: string } = {}, options: { timeoutMs?: number } = {}): Promise<PinResult> {
  const body: Record<string, unknown> = {};
  if (input.reason && input.reason.trim() !== '') body.reason = input.reason.trim();
  return send('DELETE', userId, body, options.timeoutMs ?? PIN_TIMEOUT_MS);
}
