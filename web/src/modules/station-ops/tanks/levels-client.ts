import type { z } from 'zod';
import { api } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { StationOpsError, isAbort, toStationOpsError } from '../read-client';

/**
 * FUEL-B6 — عميل قراءة «مستويات الخزانات» (قراءة فقط، بقائمة بيضاء من مسارين).
 *
 * - `GET /fuel-stations/tank-levels` (مراقبة: آخر قياس لكل خزان) و`GET /fuel-stations/readings` (سجل القراءات المرقَّم). لا مسار غيرهما.
 * - **الكتابة ليست هنا**: تسجيل القراءة يمرّ عبر `recordReading` القائم في `../receiving/receiving-client` (الكاتب الوحيد لـ`POST /fuel-stations/readings` في التطبيق)
 *   فلا نظام قراءات موازٍ ولا مسار كتابة ثانٍ.
 * - يمرّ عبر `api()` المشترك (نفس Bearer و`X-Branch-Id` ومعالجة 401). السلطة كلها للخادم (الصلاحيات الدقيقة، نطاق المحطة/الفرع/المخزن، 404 موحّد).
 */

const READ_PATHS: RegExp[] = [/^\/fuel-stations\/tank-levels$/, /^\/fuel-stations\/readings$/];

export function isAllowedLevelsPath(path: string): boolean {
  return READ_PATHS.some((pattern) => pattern.test(path));
}

const UUID = /^[0-9a-fA-F-]{36}$/;
export function isValidTankId(id: string): boolean {
  return UUID.test(id);
}

export type LevelsQuery = Record<string, string | number | undefined>;

export async function levelsGet<S extends z.ZodTypeAny>(path: string, schema: S, options: { query?: LevelsQuery; signal?: AbortSignal; branchId?: string | null } = {}): Promise<z.infer<S>> {
  if (!isAllowedLevelsPath(path)) throw new Error(`station-ops/tanks: path is not an allowed read endpoint: ${path}`);
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
