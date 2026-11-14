import type { z } from 'zod';
import { api, ApiError } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { StationOpsError, isAbort, toStationOpsError } from '../read-client';
import { isKnownReason, type FillBody, type IntentPayload, type KnownReason } from './logic';
import { fillResponse, fillsResponse, ownersResponse, tankersResponse, type Owner, type Tanker, type TankerFill } from './schemas';

/**
 * TANKER-PR7 — **العميل الوحيد** لتسجيل تعبئة الصهاريج في «تشغيل المحطات» (يحرسه `tanker-fill-boundary.test.ts`).
 *
 * - **قراءة بقائمة بيضاء من أربعة مسارات** (تطابق بالضبط قراءات `StationSessionBoundary` لجلسة PIN): قائمة أصحاب الصهاريج · قائمة الصهاريج · قائمة السندات · سند بمعرّف UUID مُحقَّق.
 *   قراءة المحطة/الفوهات/المضخات/الخزانات/الوردية/سياسة المحطة تمرّ بعميل القراءة المشترك `opsGet`.
 * - **كتابة واحدة فقط**: `POST fuel-stations/tanker-fills` (تسجيل التعبئة). لا إلغاء ولا ترحيل ولا عكس ولا مرفقات ولا PUT/PATCH/DELETE، ولا مسار يمرّره المستدعي.
 * - **نتيجة صادقة بأربع حالات** كباقي كتابات التطبيق: `ok` (مؤكد بردّ الخادم) · `unverified` (2xx بجسم غير مفهوم) · `rejected` (4xx: لا أثر) · `unknown` (مهلة/انقطاع/5xx **بعد الإرسال**:
 *   قد يكون السند سُجِّل — تُحسم بالقراءة `findRecordedFill`، لا بإعادة إرسال تلقائية) · `not_sent`. لا إعادة محاولة تلقائية أبداً.
 * - لا `tenant_id` ولا `branch_id` في أي حمولة، ولا ساعة عميل، ولا كمية/منتج/خزان/مضخة مشتقة (من الفوهة). `X-Branch-Id` = فرع المحطة (طلب لا إذن).
 * - **التسجيل لا يخصم مخزوناً**: الخادم يُبقي `inventory_status = pending_integration` حتى ترحيل مخوَّل بجلسة كاملة.
 */

const UUID = '[0-9a-fA-F-]{36}';
const READ_PATHS: RegExp[] = [
  /^\/fuel-stations\/tanker-owners$/,
  /^\/fuel-stations\/tankers$/,
  /^\/fuel-stations\/tanker-fills$/,
  new RegExp(`^/fuel-stations/tanker-fills/${UUID}$`),
];
const WRITE_PATH = '/fuel-stations/tanker-fills';

export function isValidFillId(id: string): boolean {
  return new RegExp(`^${UUID}$`).test(id);
}

export function fillPath(id: string): string {
  if (!isValidFillId(id)) throw new StationOpsError('not_found', 404);
  return `${WRITE_PATH}/${id}`;
}

export function isAllowedTankerReadPath(path: string): boolean {
  return READ_PATHS.some((pattern) => pattern.test(path));
}

type Query = Record<string, string | number | undefined>;

async function tankerGet<S extends z.ZodTypeAny>(path: string, schema: S, options: { query?: Query; signal?: AbortSignal; branchId?: string | null } = {}): Promise<z.infer<S>> {
  if (!isAllowedTankerReadPath(path)) throw new Error(`station-ops/tanker-fill: path is not an allowed read endpoint: ${path}`);
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

// ───────────────────────── القراءات ─────────────────────────

export interface Listing<T> { rows: T[]; /** هناك صفحات أخرى لم تُحمَّل (البحث يضيّق النتيجة). */ truncated: boolean }

const truncatedOf = (meta: { last_page?: number; current_page?: number } | undefined) => (meta?.last_page ?? 1) > (meta?.current_page ?? 1);

/** أصحاب الصهاريج **النشطون** (الاسم/الكود بحث خادمي). الهاتف والملاحظات لا تصل جلسة الموظف. */
export async function listOwners(options: { q?: string; branchId?: string | null; signal?: AbortSignal } = {}): Promise<Listing<Owner>> {
  const page = await tankerGet('/fuel-stations/tanker-owners', ownersResponse, { signal: options.signal, branchId: options.branchId, query: { status: 'active', q: options.q?.trim() || undefined } });
  return { rows: page.data.filter((owner) => owner.status === 'active'), truncated: truncatedOf(page.meta) };
}

/** صهاريج الصاحب **النشطة** فقط (الصهريج الموقوف لا يُسجَّل عليه). */
export async function listTankers(ownerId: string, options: { branchId?: string | null; signal?: AbortSignal } = {}): Promise<Listing<Tanker>> {
  if (!isValidFillId(ownerId)) throw new StationOpsError('not_found', 404);
  const page = await tankerGet('/fuel-stations/tankers', tankersResponse, { signal: options.signal, branchId: options.branchId, query: { owner_id: ownerId, status: 'active' } });
  return { rows: page.data.filter((tanker) => tanker.status === 'active' && tanker.fuel_tanker_owner_id === ownerId), truncated: truncatedOf(page.meta) };
}

export interface FillFilters { stationId: string; shiftId?: string; voucher?: string; perPage?: number }

export async function listFills(filters: FillFilters, options: { branchId?: string | null; signal?: AbortSignal } = {}): Promise<Listing<TankerFill>> {
  const page = await tankerGet('/fuel-stations/tanker-fills', fillsResponse, {
    signal: options.signal, branchId: options.branchId,
    query: { station_id: filters.stationId, shift_id: filters.shiftId, voucher_number: filters.voucher, per_page: filters.perPage ?? 50 },
  });
  // دفاع بالعمق: الخادم يقيّد بنطاق المستخدم، ونتحقق هنا أن الصف يخص المحطة المطلوبة قبل العرض.
  return { rows: page.data.filter((fill) => fill.fuel_station_id === filters.stationId), truncated: truncatedOf(page.meta) };
}

export async function getFill(id: string, options: { branchId?: string | null; signal?: AbortSignal } = {}): Promise<TankerFill> {
  const response = await tankerGet(fillPath(id), fillResponse, options);
  return response.data;
}

/**
 * «تحقق من الحالة» بعد نتيجة غير مؤكدة: **قراءة فقط** — هل سُجِّل السند فعلاً؟ المطابقة بالسند الورقي (المعيار الذي يفلتره الخادم) ثم الفوهة والصاحب والكمية والوردية.
 * لا تُنشئ شيئاً ولا تعيد إرسال أي طلب.
 */
export async function findRecordedFill(payload: IntentPayload, options: { branchId?: string | null; signal?: AbortSignal } = {}): Promise<TankerFill | null> {
  const listing = await listFills({ stationId: payload.fuel_station_id, shiftId: payload.fuel_shift_id, voucher: payload.voucher_number, perPage: 25 }, options);
  return listing.rows.find((fill) => fill.status === 'recorded'
    && fill.voucher_number === payload.voucher_number
    && fill.fuel_nozzle_id === payload.fuel_nozzle_id
    && fill.fuel_tanker_owner_id === payload.fuel_tanker_owner_id
    && fill.quantity_milliliters === payload.quantity_milliliters
    && fill.fuel_shift_id === payload.fuel_shift_id) ?? null;
}

// ───────────────────────── الكتابة الوحيدة ─────────────────────────

export type RejectionCode = KnownReason | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'rate_limited' | 'validation';

export type FillWriteResult =
  | { kind: 'ok'; fill: TankerFill; replayed: boolean }
  | { kind: 'unverified' }
  | { kind: 'rejected'; status: number; code: RejectionCode; serverMessage: string | null }
  | { kind: 'unknown'; reason: 'timeout' | 'network' | 'server' }
  | { kind: 'not_sent'; reason: 'offline' | 'demo' };

export const WRITE_TIMEOUT_MS = 25_000;

/** `reason` منظّم من الخادم أولاً (422/409/404)، ثم حالة HTTP. غير المعروف ⇒ `validation` بنص الخادم ثانوياً. */
export function classifyRejection(status: number, body: unknown): RejectionCode {
  const reason = body && typeof body === 'object' ? (body as { reason?: unknown }).reason : undefined;
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (isKnownReason(reason)) return reason;
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  return 'validation';
}

/** أعداد الكمية صحيحة موجبة آمنة حصراً قبل الإرسال (لا float ولا NaN يصل إلى الخادم). */
function assertBody(body: FillBody): void {
  if (!Number.isSafeInteger(body.quantity_milliliters) || body.quantity_milliliters <= 0) throw new Error('station-ops/tanker-fill: quantity must be a positive safe integer');
  if (typeof body.voucher_number !== 'string' || body.voucher_number === '') throw new Error('station-ops/tanker-fill: voucher is required');
  if (body.idempotency_key.length < 8 || body.idempotency_key.length > 128) throw new Error('station-ops/tanker-fill: invalid idempotency key');
}

/** تسجيل التعبئة. **لا إعادة محاولة تلقائية**؛ النتيجة غير المؤكدة تُحسم بـ`findRecordedFill`. */
export async function recordFill(body: FillBody, options: { branchId?: string | null; timeoutMs?: number } = {}): Promise<FillWriteResult> {
  assertBody(body);
  if (isDemo()) return { kind: 'not_sent', reason: 'demo' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { kind: 'not_sent', reason: 'offline' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? WRITE_TIMEOUT_MS);
  try {
    const headers = options.branchId ? { 'X-Branch-Id': options.branchId } : undefined;
    const raw = await api<unknown>(WRITE_PATH, { method: 'POST', body, signal: controller.signal, ...(headers ? { headers } : {}) });
    const parsed = fillResponse.safeParse(raw);
    return parsed.success ? { kind: 'ok', fill: parsed.data.data, replayed: parsed.data.meta?.replayed ?? false } : { kind: 'unverified' };
  } catch (error) {
    if (error instanceof ApiError) {
      // 5xx بعد الإرسال: قد يكون الالتزام تمّ قبل الخطأ ⇒ غير مؤكد. 4xx = رفض نهائي بلا أثر.
      if (error.status >= 500) return { kind: 'unknown', reason: 'server' };
      const message = typeof error.message === 'string' && error.message !== 'حدث خطأ' ? error.message : null;
      return { kind: 'rejected', status: error.status, code: classifyRejection(error.status, error.body), serverMessage: message };
    }
    if (isAbort(error)) return { kind: 'unknown', reason: 'timeout' };
    return { kind: 'unknown', reason: 'network' };
  } finally {
    clearTimeout(timer);
  }
}
