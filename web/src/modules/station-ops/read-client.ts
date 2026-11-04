import type { z } from 'zod';
import { api, ApiError } from '@/lib/api';
import { isDemo } from '@/lib/demo';

/**
 * UI-0 — عميل القراءة الوحيد لمساحة «تشغيل المحطات».
 *
 * - **GET فقط**: لا يقبل المستدعي طريقة HTTP أصلاً، ويحرس ذلك اختبارٌ ساكن يمنع ظهور POST/PUT/PATCH/DELETE في الوحدة.
 * - **قائمة بيضاء للمسارات**: كل مسار يجب أن يطابق نقطة قراءة موثّقة في مصفوفة الربط؛ مسار آخر يُرفض قبل أي طلب.
 * - يمرّ عبر `api()` المشترك: نفس Bearer ونفس `X-Branch-Id` ونفس معالجة 401 — لا جلسة ولا هوية مستقلة.
 * - يصنّف الفشل (`StationOpsError.kind`) كي تعرض الواجهة حالةً صادقة لكل نوع (403 ≠ 404 ≠ انقطاع ≠ شكل غير مفهوم).
 */

export type StationOpsErrorKind = 'unauthorized' | 'forbidden' | 'not_found' | 'offline' | 'server' | 'invalid_shape' | 'demo';

export class StationOpsError extends Error {
  constructor(readonly kind: StationOpsErrorKind, readonly status?: number) {
    super(kind);
    this.name = 'StationOpsError';
  }
}

const ALLOWED_READ_PATHS: RegExp[] = [
  /^\/fuel-stations\/stations$/,
  /^\/fuel-stations\/products$/,
  /^\/fuel-stations\/pumps$/,
  /^\/fuel-stations\/nozzles$/,
  /^\/fuel-stations\/tanks$/,
  /^\/fuel-stations\/prices$/,
  /^\/fuel-stations\/shifts$/,
];

export function isAllowedReadPath(path: string): boolean {
  return ALLOWED_READ_PATHS.some((pattern) => pattern.test(path));
}

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError';
}

/** يحوّل أي استثناء إلى تصنيف صادق. الإلغاء (AbortError) لا يصل إلى هنا — يتجاهله المستدعي. */
export function toStationOpsError(error: unknown): StationOpsError {
  if (error instanceof StationOpsError) return error;
  if (error instanceof ApiError) {
    if (error.status === 401) return new StationOpsError('unauthorized', 401);
    if (error.status === 403) return new StationOpsError('forbidden', 403);
    if (error.status === 404) return new StationOpsError('not_found', 404);
    return new StationOpsError('server', error.status);
  }
  // fetch يرمي TypeError عند انقطاع الشبكة/DNS/CORS؛ أي فشل غير مصنَّف آخر نعامله كخادم.
  if (error instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return new StationOpsError('offline');
  }
  return new StationOpsError('server');
}

export type ReadQuery = Record<string, string | number | undefined>;

export async function opsGet<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  options: { query?: ReadQuery; signal?: AbortSignal; branchId?: string | null } = {},
): Promise<z.infer<S>> {
  if (!isAllowedReadPath(path)) throw new Error(`station-ops: path is not an allowed read endpoint: ${path}`);
  // وضع المعاينة لا يتصل بخادم ويعيد بيانات وهمية؛ لا نعرضها كأنها بيانات محطة.
  if (isDemo()) throw new StationOpsError('demo');

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const url = search.size > 0 ? `${path}?${search.toString()}` : path;

  let body: unknown;
  try {
    // الورديات يقيّدها الخادم بالفرع الفعّال (`X-Branch-Id`)، ومحطات المستخدم قد تكون في فروع مختلفة: يُرسَل فرع المحطة المختارة نفسها
    // (من قائمة المحطات المصرّح بها). الترويسة طلبٌ لا إذن — `SetBranch` يتجاهل فرعاً خارج نطاق المستخدم، فلا تصعيد من الواجهة.
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

export { isAbort };
