/**
 * FLOWERS-H14 / ADR-25 — قائمة تهيئة ملف «الهدايا والورود» والقيم المبدئية.
 *
 * الخادم هو الحقيقة: الحالة (مهيَّأ/غير مهيَّأ) تُشتقّ هناك من الإعداد الفعلي، والعميل لا يحسبها ولا
 * يخزّنها. لا `tenant_id` في أي طلب (المستأجر من الجلسة)، و`{id}` محدِّد متجر فقط. الدوال الكتابية تعيد
 * `{ ok: false }` بدل الرمي حتى تعرض الواجهة سبباً مفهوماً.
 */

import { ApiError, api } from '@/lib/api';

export type SetupItemState = 'configured' | 'not_configured';

export type SetupItem = {
  key: string;
  available: boolean;
  state: SetupItemState;
  count: number;
  /** أين يضبطها التاجر — مفتاحٌ تحوّله الواجهة إلى شاشة، أو لا شاشة بعد. */
  manageIn: string;
};

export type VerticalSetup = { vertical: string; items: SetupItem[] };

export type StarterFacetPlan = {
  systemKey: string;
  /** `existing`: بُعد التاجر قائم · `missing`: سيُنشأ · `blocked`: مفتاحه محجوز لبُعد غير نظامي فلا يُمسّ. */
  facet: 'existing' | 'missing' | 'blocked';
  missingCount: number;
  existingCount: number;
};

export type StarterPreview = { wouldCreate: number; facets: StarterFacetPlan[] };

export type StarterResult = { created: number; blockedKeys: string[] };

export type SetupWrite<T> = { ok: true; data: T } | { ok: false; status: number | null; message: string | null };

/**
 * مفتاح «أين يضبطها» → مسار شاشة في الواجهة، أو `null` حين لا توجد شاشة بعد (تُعرض بصراحة
 * «غير متاحة في لوحة التحكم بعد» لا رابطاً ميتاً).
 */
export const SETUP_DESTINATIONS: Record<string, string | null> = {
  merchandising: '/commerce/merchandising',
  store_builder: '/commerce/appearance',
  products: '/products',
  gift_settings: '/commerce/gifting',
  delivery_schedule: null,
};

const obj = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

const base = (storeId: string) => `/commerce/workspace/storefronts/${encodeURIComponent(storeId)}/vertical-setup`;

export function mapVerticalSetup(payload: unknown): VerticalSetup | null {
  const setup = obj(obj(obj(payload)?.data)?.setup);
  if (!setup || typeof setup.vertical !== 'string' || !Array.isArray(setup.items)) return null;
  const items: SetupItem[] = [];
  for (const raw of setup.items) {
    const row = obj(raw);
    if (!row || typeof row.key !== 'string') continue;
    items.push({
      key: row.key,
      available: row.available === true,
      state: row.state === 'configured' ? 'configured' : 'not_configured',
      count: num(row.count),
      manageIn: typeof row.manage_in === 'string' ? row.manage_in : '',
    });
  }

  return { vertical: setup.vertical, items };
}

function mapFacetPlan(raw: unknown): StarterFacetPlan | null {
  const row = obj(raw);
  if (!row || typeof row.system_key !== 'string') return null;
  const facet = row.facet === 'missing' || row.facet === 'blocked' ? row.facet : 'existing';
  const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);

  return {
    systemKey: row.system_key,
    facet,
    // المعاينة تُرجع `missing_values`؛ نتيجة التطبيق تُرجع `created_values` — نقرأ ما هو موجود.
    missingCount: count(row.missing_values),
    existingCount: count(row.existing_values),
  };
}

export function mapStarterPreview(payload: unknown): StarterPreview | null {
  const starters = obj(obj(obj(payload)?.data)?.starters);
  if (!starters || !Array.isArray(starters.facets)) return null;

  return {
    wouldCreate: num(starters.would_create),
    facets: starters.facets.map(mapFacetPlan).filter((f): f is StarterFacetPlan => f !== null),
  };
}

export function mapStarterResult(payload: unknown): StarterResult | null {
  const starters = obj(obj(obj(payload)?.data)?.starters);
  if (!starters || typeof starters.created !== 'number') return null;
  const blockedKeys = (Array.isArray(starters.facets) ? starters.facets : [])
    .map(obj)
    .filter((row) => row?.facet === 'blocked' && typeof row.system_key === 'string')
    .map((row) => row?.system_key as string);

  return { created: starters.created, blockedKeys };
}

export async function loadVerticalSetup(storeId: string): Promise<VerticalSetup | null> {
  try {
    return mapVerticalSetup(await api<unknown>(base(storeId)));
  } catch {
    return null;
  }
}

async function write<T>(run: () => Promise<T | null>): Promise<SetupWrite<T>> {
  try {
    const data = await run();
    return data === null ? { ok: false, status: null, message: null } : { ok: true, data };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, status: error.status, message: error.message || null };
    return { ok: false, status: null, message: null };
  }
}

export function previewStarters(storeId: string): Promise<SetupWrite<StarterPreview>> {
  return write(async () => mapStarterPreview(await api<unknown>(`${base(storeId)}/starters`)));
}

export function applyStarters(storeId: string): Promise<SetupWrite<StarterResult>> {
  return write(async () => mapStarterResult(await api<unknown>(`${base(storeId)}/starters`, { method: 'POST' })));
}
