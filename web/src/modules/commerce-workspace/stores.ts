/**
 * Store selector / View Store catalog.
 *
 * Tenant authority is server-side (SetTenant → TenantContext). This module
 * only fetches the current session's admin list and never sends a tenant,
 * storefront, or domain identifier as authority. Public GET store/v1/storefront
 * is Host-resolved buyer traffic and must not be called here.
 */

import { api } from '@/lib/api';

export type CommerceStoreOption = {
  id: string;
  name: string;
  salesChannelId: string | null;
  isActive: boolean;
  previewUrl: string | null;
};

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
  };
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
