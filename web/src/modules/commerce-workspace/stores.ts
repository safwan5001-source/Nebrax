/**
 * Store selector / View Store catalog.
 *
 * Tenant authority is server-side (SetTenant → TenantContext). This module
 * only fetches the current session's admin list and never sends a tenant,
 * storefront, or domain identifier as authority. Public GET store/v1/storefront
 * is Host-resolved buyer traffic and must not be called here.
 */

import { api } from '@/lib/api';

/**
 * FLOWERS-H1 — ملفات نشاط المتجر. قائمة محدودة تملكها المنصة وتطابق
 * `App\Support\Commerce\BusinessVertical`؛ مفتاحٌ مجهول يقرأ `general`.
 */
export const COMMERCE_BUSINESS_VERTICALS = ['general', 'flowers_gifts'] as const;
export type CommerceBusinessVertical = (typeof COMMERCE_BUSINESS_VERTICALS)[number];

export type CommerceVerticalCapability = { key: string; available: boolean };

export type CommerceStoreOption = {
  id: string;
  name: string;
  salesChannelId: string | null;
  isActive: boolean;
  previewUrl: string | null;
  defaultLocale: string | null;
  businessVertical: CommerceBusinessVertical;
  /** القدرات الموصى بها لملف النشاط المحفوظ، وهل بُنيت (من الخادم لا من العميل). */
  recommendedCapabilities: CommerceVerticalCapability[];
};

/** STORE-ADMIN-ADOPT-1B-1 — الحقيقة الوحيدة للغات المدعومة، تطابق الخادم. */
export const COMMERCE_STORE_LOCALES = ['ar', 'en'] as const;
export type CommerceStoreLocale = (typeof COMMERCE_STORE_LOCALES)[number];

export type CommerceStoreCatalog =
  | { status: 'loading' }
  | { status: 'unavailable'; reason: 'missing_admin_api' }
  | { status: 'ready'; stores: CommerceStoreOption[] }
  | { status: 'empty' }
  | { status: 'error'; message: string };

/** Tenant-scoped ERP admin list. Not the public Host-resolved storefront API. */
export const COMMERCE_STORE_ADMIN_LIST_PATH = '/commerce/workspace/storefronts';

export async function loadCommerceStoreCatalog(): Promise<CommerceStoreCatalog> {
  if (!COMMERCE_STORE_ADMIN_LIST_PATH) {
    return { status: 'unavailable', reason: 'missing_admin_api' };
  }

  try {
    const payload = await api<unknown>(COMMERCE_STORE_ADMIN_LIST_PATH);
    return mapCommerceStoreAdminList(payload);
  } catch {
    return { status: 'error', message: 'load_failed' };
  }
}

/**
 * COM-STORE-PROVISION-1 — يزوّد أول متجر إلكتروني للمستأجر الحالي. لا يقبل
 * أي هوية (مستأجر/نطاق/قناة) — الخادم وحده يشتقّها من `TenantContext`
 * الموثوق. `name` اختياري ويُستعمل فقط عند إنشاء متجر جديد فعلياً.
 */
export async function provisionCommerceStorefront(
  name?: string,
  businessVertical?: CommerceBusinessVertical,
): Promise<{ ok: true; store: CommerceStoreOption } | { ok: false; message: string }> {
  try {
    const body: Record<string, string> = {};
    if (name && name.trim() !== '') body.name = name.trim();
    if (businessVertical) body.business_vertical = businessVertical;
    const payload = await api<unknown>(COMMERCE_STORE_ADMIN_LIST_PATH, {
      method: 'POST',
      body,
    });
    const store = extractProvisionedStore(payload);
    if (!store) return { ok: false, message: 'invalid_payload' };
    return { ok: true, store };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'provision_failed';
    return { ok: false, message };
  }
}

/**
 * STORE-ADMIN-ADOPT-1B-1 — تحديث `name`/`default_locale` فقط لمتجرٍ قائم.
 * `{id}` يحدّد أي صفّ — لا هوية مستأجر/قناة/نطاق تُرسَل هنا أبداً؛ الخادم
 * يحسم الملكية من `TenantContext` وحده. كلا الحقلين اختياري ومستقل.
 */
export async function updateCommerceStorefrontIdentity(
  id: string,
  attributes: {
    name?: string;
    default_locale?: CommerceStoreLocale;
    business_vertical?: CommerceBusinessVertical;
  },
): Promise<{ ok: true; store: CommerceStoreOption } | { ok: false; message: string }> {
  try {
    const payload = await api<unknown>(`${COMMERCE_STORE_ADMIN_LIST_PATH}/${id}`, {
      method: 'PUT',
      body: attributes,
    });
    const store = extractProvisionedStore(payload);
    if (!store) return { ok: false, message: 'invalid_payload' };
    return { ok: true, store };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'update_failed';
    return { ok: false, message };
  }
}

/**
 * STORE-ADMIN-LIFECYCLE-1 — تفعيل متجر قائم. `{id}` محدِّد صفّ فقط؛ الخادم
 * يحسم الملكية من `TenantContext`. لا نطاق ولا حافة ولا قناة تُرسَل هنا.
 */
export async function activateCommerceStorefront(
  id: string,
): Promise<{ ok: true; store: CommerceStoreOption } | { ok: false; message: string }> {
  try {
    const payload = await api<unknown>(`${COMMERCE_STORE_ADMIN_LIST_PATH}/${id}/activate`, {
      method: 'POST',
      body: {},
    });
    const store = extractProvisionedStore(payload);
    if (!store) return { ok: false, message: 'invalid_payload' };
    return { ok: true, store };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'activate_failed';
    return { ok: false, message };
  }
}

/**
 * STORE-ADMIN-LIFECYCLE-1 — إيقاف متجر قائم. يكتب `Storefront.is_active`
 * فقط على الخادم. ليست تفعيل نطاق ولا فصل نطاق.
 */
export async function deactivateCommerceStorefront(
  id: string,
): Promise<{ ok: true; store: CommerceStoreOption } | { ok: false; message: string }> {
  try {
    const payload = await api<unknown>(`${COMMERCE_STORE_ADMIN_LIST_PATH}/${id}/deactivate`, {
      method: 'POST',
      body: {},
    });
    const store = extractProvisionedStore(payload);
    if (!store) return { ok: false, message: 'invalid_payload' };
    return { ok: true, store };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'deactivate_failed';
    return { ok: false, message };
  }
}

function extractProvisionedStore(payload: unknown): CommerceStoreOption | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return mapStoreOption((data as { store?: unknown }).store);
}

export function mapCommerceStoreAdminList(payload: unknown): CommerceStoreCatalog {
  const storesRaw = extractStores(payload);
  if (storesRaw === null) {
    return { status: 'error', message: 'invalid_payload' };
  }

  const stores = storesRaw
    .map(mapStoreOption)
    .filter((store): store is CommerceStoreOption => store !== null);

  if (stores.length === 0) return { status: 'empty' };
  return { status: 'ready', stores };
}

function extractStores(payload: unknown): unknown[] | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const stores = (data as { stores?: unknown }).stores;
  return Array.isArray(stores) ? stores : null;
}

function mapStoreOption(raw: unknown): CommerceStoreOption | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || row.id === '') return null;
  if (typeof row.name !== 'string' || row.name === '') return null;

  return {
    id: row.id,
    name: row.name,
    salesChannelId: typeof row.sales_channel_id === 'string' ? row.sales_channel_id : null,
    isActive: row.is_active === true,
    previewUrl: sanitizePreviewUrl(row.preview_url),
    defaultLocale: typeof row.default_locale === 'string' ? row.default_locale : null,
    businessVertical: mapBusinessVertical(row.business_vertical),
    recommendedCapabilities: mapRecommendedCapabilities(row.vertical_profile),
  };
}

function mapBusinessVertical(value: unknown): CommerceBusinessVertical {
  return (COMMERCE_BUSINESS_VERTICALS as readonly unknown[]).includes(value)
    ? (value as CommerceBusinessVertical)
    : 'general';
}

function mapRecommendedCapabilities(profile: unknown): CommerceVerticalCapability[] {
  if (!profile || typeof profile !== 'object') return [];
  const raw = (profile as { recommended_capabilities?: unknown }).recommended_capabilities;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item): item is { key: string; available?: unknown } =>
        !!item && typeof item === 'object' && typeof (item as { key?: unknown }).key === 'string',
    )
    .map((item) => ({ key: item.key, available: item.available === true }));
}

function sanitizePreviewUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function resolveViewStoreUrl(
  catalog: CommerceStoreCatalog,
  selectedStoreId: string | null,
): string | null {
  if (catalog.status !== 'ready' || !selectedStoreId) return null;
  const store = catalog.stores.find((item) => item.id === selectedStoreId);
  if (!store?.previewUrl) return null;
  return sanitizePreviewUrl(store.previewUrl);
}

export function selectStoreId(
  catalog: CommerceStoreCatalog,
  requestedId: string | null,
): string | null {
  if (catalog.status !== 'ready') return null;
  if (requestedId && catalog.stores.some((store) => store.id === requestedId)) {
    return requestedId;
  }
  return catalog.stores[0]?.id ?? null;
}
