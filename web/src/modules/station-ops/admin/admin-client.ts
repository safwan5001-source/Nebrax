import type { z } from 'zod';
import { api, ApiError } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { StationOpsError, isAbort, toStationOpsError } from '../read-client';
import { staffOneResponse, type StaffView } from './schemas';

/**
 * FUEL-B4 — العميل الوحيد لإدارة موظفي المحطات داخل «تشغيل المحطات».
 *
 * - **قراءة بقائمة بيضاء**: قوالب · قائمة الموظفين · مرشحون · سجل التدقيق · موظف بمعرّف UUID مُحقَّق. أي مسار آخر يُرفض قبل أي طلب.
 * - **كتابة واحدة فقط**: `PUT /fuel-stations/staff/{uuid}` (إسناد قالب/صلاحيات/محطات). لا POST ولا PATCH ولا DELETE، ولا مسار يمرّره المستدعي.
 *   السلطة الكاملة للخادم (سقف المنح، منع التصعيد الذاتي، نطاق الفاعل، المفاتيح المحجوزة): هذا العميل لا يمنح شيئاً ولا يتجاوز رفضاً.
 * - نتيجة الكتابة صادقة: `ok` (مؤكد بقراءة الخادم) · `rejected` (403/404/409/422… بلا أي أثر) · `unknown` (مهلة/انقطاع/5xx — قد تكون تمت: تُعاد القراءة
 *   ولا تُعاد الكتابة عمياء) · `not_sent`. لا إعادة محاولة تلقائية أبداً، و`expected_revision` يحمي من الكتابة فوق مسؤول آخر.
 */

const UUID = '[0-9a-fA-F-]{36}';
const READ_PATHS: RegExp[] = [
  /^\/fuel-stations\/staff$/,
  /^\/fuel-stations\/staff\/templates$/,
  /^\/fuel-stations\/staff\/candidates$/,
  /^\/fuel-stations\/staff\/audit$/,
  new RegExp(`^/fuel-stations/staff/${UUID}$`),
];

export function isValidStaffId(id: string): boolean {
  return new RegExp(`^${UUID}$`).test(id);
}

export function staffPath(id: string): string {
  if (!isValidStaffId(id)) throw new StationOpsError('not_found', 404);
  return `/fuel-stations/staff/${id}`;
}

export function isAllowedAdminReadPath(path: string): boolean {
  return READ_PATHS.some((pattern) => pattern.test(path));
}

export type AdminQuery = Record<string, string | number | undefined>;

export async function adminGet<S extends z.ZodTypeAny>(path: string, schema: S, options: { query?: AdminQuery; signal?: AbortSignal } = {}): Promise<z.infer<S>> {
  if (!isAllowedAdminReadPath(path)) throw new Error(`station-ops/admin: path is not an allowed read endpoint: ${path}`);
  if (isDemo()) throw new StationOpsError('demo');

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined && value !== '') search.set(key, String(value));
  const url = search.size > 0 ? `${path}?${search.toString()}` : path;

  let body: unknown;
  try {
    body = await api<unknown>(url, { method: 'GET', signal: options.signal });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw toStationOpsError(error);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new StationOpsError('invalid_shape');
  return parsed.data;
}

// ───────────────────────── الكتابة الوحيدة ─────────────────────────

export interface StaffUpdateBody {
  /** يطابق `UpdateFuelStaffRequest`: تغيير تفاضلي فوق الحالة؛ الخادم يحسب النتيجة ويفحص السقف. */
  add_permissions?: string[];
  remove_permissions?: string[];
  /** المحطات الجديدة كاملةً (غائب = بلا تغيير). */
  station_ids?: string[];
  expected_revision: string;
  reason?: string;
}

export type StaffRejectionCode = 'forbidden' | 'not_found' | 'revision_conflict' | 'validation' | 'unauthorized' | 'rate_limited' | 'demo';

export type StaffSaveResult =
  | { kind: 'ok'; staff: StaffView }
  | { kind: 'unverified' }
  | { kind: 'rejected'; status: number; code: StaffRejectionCode; serverMessage: string | null; currentRevision: string | null }
  | { kind: 'unknown'; reason: 'timeout' | 'network' | 'server' }
  | { kind: 'not_sent'; reason: 'offline' | 'demo' };

export const SAVE_TIMEOUT_MS = 25_000;

function classify(status: number, body: unknown): { code: StaffRejectionCode; currentRevision: string | null } {
  const reason = body && typeof body === 'object' ? (body as { reason?: unknown }).reason : undefined;
  const current = body && typeof body === 'object' ? (body as { current_revision?: unknown }).current_revision : undefined;
  if (status === 409 && reason === 'staff_revision_conflict') return { code: 'revision_conflict', currentRevision: typeof current === 'string' ? current : null };
  if (status === 401) return { code: 'unauthorized', currentRevision: null };
  if (status === 403) return { code: 'forbidden', currentRevision: null };
  if (status === 404) return { code: 'not_found', currentRevision: null };
  if (status === 429) return { code: 'rate_limited', currentRevision: null };
  return { code: 'validation', currentRevision: null };
}

export async function saveStaff(userId: string, body: StaffUpdateBody, options: { timeoutMs?: number } = {}): Promise<StaffSaveResult> {
  const path = staffPath(userId);
  if (isDemo()) return { kind: 'not_sent', reason: 'demo' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { kind: 'not_sent', reason: 'offline' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? SAVE_TIMEOUT_MS);
  try {
    const raw = await api<unknown>(path, { method: 'PUT', body, signal: controller.signal });
    const parsed = staffOneResponse.safeParse(raw);
    return parsed.success ? { kind: 'ok', staff: parsed.data.data } : { kind: 'unverified' };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status >= 500) return { kind: 'unknown', reason: 'server' };
      const message = typeof error.message === 'string' && error.message !== 'حدث خطأ' ? error.message : null;
      return { kind: 'rejected', status: error.status, serverMessage: message, ...classify(error.status, error.body) };
    }
    if (isAbort(error)) return { kind: 'unknown', reason: 'timeout' };
    return { kind: 'unknown', reason: 'network' };
  } finally {
    clearTimeout(timer);
  }
}
