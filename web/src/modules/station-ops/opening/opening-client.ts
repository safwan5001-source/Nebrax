import type { z } from 'zod';
import { api, ApiError } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { StationOpsError, isAbort, toStationOpsError } from '../read-client';
import { accountsResponse, blockerSchema, docResponse, docsResponse, previewResponse, settingsResponse, type OpeningBlocker, type OpeningDoc } from './schemas';
import type { DraftBody } from './logic';

/**
 * PR-2 — العميل الوحيد لمعالج الرصيد الافتتاحي للوقود داخل «تشغيل المحطات».
 *
 * - **قراءة بقائمة بيضاء**: قائمة المستندات · مستند بمعرّف UUID مُحقَّق · معاينته · إعدادات المحطة والمؤسسة · حسابات الأستاذ (للاختيار).
 * - **أربع كتابات فقط** من مرسِل واحد `send()`: إنشاء مسودة (POST) · استبدال مسودة (PUT) · ترحيل (POST) · حفظ حساب الأرصدة الافتتاحية في إعدادات المحطة أو المؤسسة (PUT، مفتاح واحد).
 *   لا حذف مسودة، ولا أي إعداد آخر، ولا مسار يمرّره المستدعي.
 * - نتيجة صادقة بخمس حالات: `ok` · `unverified` · `rejected` (4xx: لا أثر — مع موانع الخادم كما هي) · `unknown` (مهلة/انقطاع/5xx بعد الإرسال: **قد تكون تمّت** —
 *   تُقرأ الحالة ولا تُرسَل عملية أخرى عمياء) · `not_sent`. لا إعادة محاولة تلقائية أبداً.
 * - السلطة كلها للخادم (بوابة النشر، الصلاحيات، نطاق المحطة، السعة، المجمّع الفارغ، الفترة المحاسبية): لا يمنح هذا العميل ولا يتجاوز.
 */

const UUID = '[0-9a-fA-F-]{36}';
const ID = '[A-Za-z0-9_-]{1,64}';
const READ_PATHS: RegExp[] = [
  /^\/fuel-stations\/opening-balances$/,
  new RegExp(`^/fuel-stations/opening-balances/${UUID}$`),
  new RegExp(`^/fuel-stations/opening-balances/${UUID}/preview$`),
  /^\/fuel-stations\/settings$/,
  new RegExp(`^/fuel-stations/stations/${ID}/settings$`),
  /^\/accounts$/,
];

export function isValidDocId(id: string): boolean {
  return new RegExp(`^${UUID}$`).test(id);
}

export function docPath(id: string): string {
  if (!isValidDocId(id)) throw new StationOpsError('not_found', 404);
  return `/fuel-stations/opening-balances/${id}`;
}

function stationSettingsPath(stationId: string): string {
  if (!new RegExp(`^${ID}$`).test(stationId)) throw new StationOpsError('not_found', 404);
  return `/fuel-stations/stations/${stationId}/settings`;
}

export function isAllowedOpeningReadPath(path: string): boolean {
  return READ_PATHS.some((pattern) => pattern.test(path));
}

type ReadOptions = { query?: Record<string, string | number | undefined>; signal?: AbortSignal; branchId?: string | null };

async function openingGet<S extends z.ZodTypeAny>(path: string, schema: S, options: ReadOptions = {}): Promise<z.infer<S>> {
  if (!isAllowedOpeningReadPath(path)) throw new Error(`station-ops/opening: path is not an allowed read endpoint: ${path}`);
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

export async function listOpeningDocs(stationId: string, options: Omit<ReadOptions, 'query'> = {}): Promise<OpeningDoc[]> {
  return (await openingGet('/fuel-stations/opening-balances', docsResponse, { ...options, query: { station_id: stationId, per_page: 50 } })).data;
}

export async function getOpeningDoc(id: string, options: Omit<ReadOptions, 'query'> = {}): Promise<OpeningDoc> {
  return (await openingGet(docPath(id), docResponse, options)).data;
}

export async function getOpeningPreview(id: string, options: Omit<ReadOptions, 'query'> = {}) {
  return (await openingGet(`${docPath(id)}/preview`, previewResponse, options)).data;
}

/** إعدادات المحطة الفعّالة ذات الصلة: حساب الأرصدة الافتتاحية، وسياسة فصل المعتمِد (`null` = غير معروفة ⇒ لا حجب مسبق، والخادم يحكم). */
export async function getStationOpeningSettings(stationId: string, options: Omit<ReadOptions, 'query'> = {}): Promise<{ account: string | null; distinctApprover: boolean | null }> {
  const data = (await openingGet(stationSettingsPath(stationId), settingsResponse, options)).data;
  return { account: data.fuel_opening_balance_account_id ?? null, distinctApprover: typeof data.fuel_distinct_approver_required === 'boolean' ? data.fuel_distinct_approver_required : null };
}

export async function getTenantOpeningAccount(options: Omit<ReadOptions, 'query'> = {}): Promise<string | null> {
  const data = (await openingGet('/fuel-stations/settings', settingsResponse, options)).data;
  return data.fuel_opening_balance_account_id ?? null;
}

export async function listLedgerAccounts(options: Omit<ReadOptions, 'query'> = {}) {
  return (await openingGet('/accounts', accountsResponse, options)).data;
}

// ───────────────────────── الكتابات الأربع ─────────────────────────

export type RejectionCode =
  | 'blocked' | 'date_future' | 'date_invalid' | 'lines_invalid' | 'quantity_invalid' | 'cost_invalid' | 'cost_authority' | 'idempotency_conflict' | 'not_draft'
  | 'account_required' | 'account_invalid' | 'distinct_approver' | 'period_locked' | 'station_outside_scope' | 'mismatch'
  | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'rate_limited' | 'validation';

const KNOWN: ReadonlyArray<[RegExp, RejectionCode]> = [
  [/FUEL_OPENING_DATE_FUTURE/, 'date_future'],
  [/FUEL_OPENING_DATE_INVALID/, 'date_invalid'],
  [/FUEL_OPENING_LINES_INVALID|FUEL_OPENING_TANK_INVALID/, 'lines_invalid'],
  [/FUEL_OPENING_QUANTITY_INVALID/, 'quantity_invalid'],
  [/FUEL_OPENING_COST_INVALID/, 'cost_invalid'],
  [/سلطة التكلفة المالية/, 'cost_authority'],
  [/FUEL_OPENING_IDEMPOTENCY_CONFLICT|FUEL_OPENING_DUPLICATE/, 'idempotency_conflict'],
  [/FUEL_OPENING_NOT_DRAFT/, 'not_draft'],
  [/FUEL_OPENING_ACCOUNT_REQUIRED/, 'account_required'],
  [/حساب الوقود يجب أن يكون نشطاً/, 'account_invalid'],
  [/FUEL_DISTINCT_APPROVER_REQUIRED/, 'distinct_approver'],
  [/FUEL_OPENING_BALANCE_MISMATCH/, 'mismatch'],
  [/محطة الرصيد الافتتاحي خارج نطاق/, 'station_outside_scope'],
  [/الفترة المحاسبية|فترة محاسبية|السنة المالية|مقفل/, 'period_locked'],
];

export function classifyRejection(status: number, message: string | null | undefined, body?: unknown): RejectionCode {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  const reason = body && typeof body === 'object' ? (body as { reason?: unknown }).reason : undefined;
  if (status === 422 && reason === 'opening_blocked') return 'blocked';
  if (status === 409) return 'conflict';
  if (message) for (const [pattern, code] of KNOWN) if (pattern.test(message)) return code;
  return 'validation';
}

/** موانع الخادم الآلية (`blockers[]`) من جسم 422؛ شكل مخالف ⇒ قائمة فارغة (لا اختلاق). */
export function blockersFrom(body: unknown): OpeningBlocker[] {
  const raw = body && typeof body === 'object' ? (body as { blockers?: unknown }).blockers : undefined;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => { const parsed = blockerSchema.safeParse(item); return parsed.success ? [parsed.data] : []; });
}

export type WriteFailure =
  | { kind: 'unverified' }
  | { kind: 'rejected'; status: number; code: RejectionCode; serverMessage: string | null; blockers: OpeningBlocker[] }
  | { kind: 'unknown'; reason: 'timeout' | 'network' | 'server' }
  | { kind: 'not_sent'; reason: 'offline' | 'demo' };

export type DocWrite = { kind: 'ok'; doc: OpeningDoc; replayed: boolean } | WriteFailure;
export type SettingWrite = { kind: 'ok' } | WriteFailure;

export const WRITE_TIMEOUT_MS = 25_000;

async function send(path: string, method: 'POST' | 'PUT', body: unknown, options: { timeoutMs?: number; branchId?: string | null }): Promise<{ raw: unknown } | WriteFailure> {
  if (isDemo()) return { kind: 'not_sent', reason: 'demo' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { kind: 'not_sent', reason: 'offline' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? WRITE_TIMEOUT_MS);
  try {
    const headers = options.branchId ? { 'X-Branch-Id': options.branchId } : undefined;
    const raw = await api<unknown>(path, { method, body, signal: controller.signal, ...(headers ? { headers } : {}) });
    return { raw };
  } catch (error) {
    if (error instanceof ApiError) {
      // 5xx بعد الإرسال: قد يكون الالتزام تمّ قبل الخطأ ⇒ غير مؤكد. 4xx = رفض نهائي بلا أثر.
      if (error.status >= 500) return { kind: 'unknown', reason: 'server' };
      const message = typeof error.message === 'string' && error.message !== 'حدث خطأ' ? error.message : null;
      return { kind: 'rejected', status: error.status, code: classifyRejection(error.status, message, error.body), serverMessage: message, blockers: blockersFrom(error.body) };
    }
    if (isAbort(error)) return { kind: 'unknown', reason: 'timeout' };
    return { kind: 'unknown', reason: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

type Options = { timeoutMs?: number; branchId?: string | null };

function asDoc(sent: { raw: unknown }): DocWrite {
  const parsed = docResponse.safeParse(sent.raw);
  return parsed.success ? { kind: 'ok', doc: parsed.data.data, replayed: parsed.data.meta?.replayed === true } : { kind: 'unverified' };
}

/** إنشاء مسودة. `idempotency_key` إلزامي في العقد: إعادة الإرسال بالمفتاح نفسه والحمولة نفسها آمنة (الخادم يعيد المسودة الأولى). */
export async function createOpeningDraft(stationId: string, body: DraftBody, idempotencyKey: string, options: Options = {}): Promise<DocWrite> {
  const sent = await send('/fuel-stations/opening-balances', 'POST', { fuel_station_id: stationId, idempotency_key: idempotencyKey, ...body }, options);
  return 'raw' in sent ? asDoc(sent) : sent;
}

/** استبدال كامل لمحتوى مسودة قائمة (المحطة لا تتغيّر). */
export async function updateOpeningDraft(id: string, body: DraftBody, options: Options = {}): Promise<DocWrite> {
  const sent = await send(docPath(id), 'PUT', body, options);
  return 'raw' in sent ? asDoc(sent) : sent;
}

/** الترحيل: مرة واحدة منطقياً (الخادم يقفل المستند ويعيد `replayed` لمرحَّل). لا مفتاح؛ المحروس بحالة المستند. غير المؤكد يُحسم بالقراءة لا بإعادة الإرسال. */
export async function postOpening(id: string, options: Options = {}): Promise<DocWrite> {
  const sent = await send(`${docPath(id)}/post`, 'POST', undefined, options);
  return 'raw' in sent ? asDoc(sent) : sent;
}

/** حفظ **حساب الأرصدة الافتتاحية** وحده. محطة (تخصيص) أو المؤسسة (افتراضي). لا مفتاح إعداد آخر يمرّ من هنا. */
export async function saveOpeningAccount(scope: { kind: 'station'; stationId: string } | { kind: 'org' }, accountId: string, options: Options = {}): Promise<SettingWrite> {
  const path = scope.kind === 'station' ? stationSettingsPath(scope.stationId) : '/fuel-stations/settings';
  const sent = await send(path, 'PUT', { fuel_opening_balance_account_id: accountId, reason: 'fuel_opening_balance_wizard' }, options);
  return 'raw' in sent ? { kind: 'ok' } : sent;
}
