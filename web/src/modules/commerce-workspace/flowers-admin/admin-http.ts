/**
 * FLOWERS-H2 / Horizon 2 — مساعد HTTP مشترك لشاشات إدارة التاجر (الإهداء، الجدولة، منتجات الهدايا).
 *
 * نفس اتفاقية `commerce-workspace`: لا `tenant_id` في أي طلب (المستأجر من الجلسة)، و`{id}` محدِّد صفّ
 * فقط، والخادم سلطة الملكية والتحقق والسعر والتوفّر. كل استدعاء يعيد نتيجة مصنَّفة بدل الرمي حتى تعرض
 * الواجهة سبباً مفهوماً: لا فشل صامت، ولا نصّ خادم خام إلا لرفضٍ تحققي (422/409) صاغه الخادم للتاجر.
 */

import { ApiError } from '@/lib/api';

export type AdminFailureKind = 'forbidden' | 'not_found' | 'invalid' | 'conflict' | 'unavailable';

export type AdminFailure = {
  ok: false;
  kind: AdminFailureKind;
  status: number | null;
  /** نصّ الخادم — يُعرض للتاجر فقط عند `invalid`/`conflict`. */
  message: string | null;
  /** أخطاء الحقول كما يعيدها Laravel (`errors`): مفتاح الحقل بنقاط → رسائله. */
  fieldErrors: Record<string, string[]>;
};

export type AdminResult<T> = { ok: true; data: T } | AdminFailure;

export const obj = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
export const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
export const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
export const bool = (value: unknown, fallback = false): boolean => (typeof value === 'boolean' ? value : fallback);
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function fieldErrorsOf(body: unknown): Record<string, string[]> {
  const errors = obj(obj(body)?.errors);
  if (!errors) return {};
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(errors)) {
    const messages = list(value).filter((m): m is string => typeof m === 'string');
    if (messages.length > 0) out[key] = messages;
  }
  return out;
}

export function classifyFailure(error: unknown): AdminFailure {
  if (error instanceof ApiError) {
    const kind: AdminFailureKind =
      error.status === 403 ? 'forbidden'
      : error.status === 404 ? 'not_found'
      : error.status === 422 ? 'invalid'
      : error.status === 409 ? 'conflict'
      : 'unavailable';

    return {
      ok: false,
      kind,
      status: error.status,
      message: kind === 'invalid' || kind === 'conflict' ? error.message || null : null,
      fieldErrors: kind === 'invalid' ? fieldErrorsOf(error.body) : {},
    };
  }

  return { ok: false, kind: 'unavailable', status: null, message: null, fieldErrors: {} };
}

/** يشغّل استدعاءً ويصنّف فشله. حمولةٌ لا تُفهم (`null` من المُحوِّل) تُعامَل `unavailable` لا نجاحاً. */
export async function adminCall<T>(run: () => Promise<T | null>): Promise<AdminResult<T>> {
  try {
    const data = await run();
    return data === null ? { ok: false, kind: 'unavailable', status: null, message: null, fieldErrors: {} } : { ok: true, data };
  } catch (error) {
    return classifyFailure(error);
  }
}

/** `{id}` المتجر في مسارات `commerce/workspace/storefronts/{id}/…`. */
export const storePath = (storeId: string, suffix: string) =>
  `/commerce/workspace/storefronts/${encodeURIComponent(storeId)}/${suffix}`;

/** `{id}` المنتج في مسارات `commerce/workspace/products/{id}/…`. */
export const productPath = (productId: string, suffix: string) =>
  `/commerce/workspace/products/${encodeURIComponent(productId)}/${suffix}`;
