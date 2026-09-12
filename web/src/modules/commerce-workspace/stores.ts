/**
 * Store selector / View Store foundation.
 *
 * Inspected existing contracts on main:
 * - Public `GET store/v1/storefront` resolves tenant + store from Host via
 *   StorefrontDomain. It is not an ERP admin list and must not be called with
 *   a client-chosen tenant or host.
 * - `SalesChannel` and `Storefront` are tenant-owned models, but there is no
 *   authenticated ERP list/show API for either in `routes/api.php`.
 *
 * This module therefore does not invent a commerce store API. The workspace
 * keeps the selector and View Store action in an explicit unavailable state
 * until a tenant-scoped admin contract exists.
 */

export type CommerceStoreOption = {
  id: string;
  name: string;
  salesChannelId: string | null;
  isActive: boolean;
  previewUrl: string | null;
};

export type CommerceStoreCatalog =
  | { status: 'unavailable'; reason: 'missing_admin_api' }
  | { status: 'ready'; stores: CommerceStoreOption[] }
  | { status: 'empty' }
  | { status: 'error'; message: string };

/** No tenant-scoped admin list path exists on current main. Keep null. */
export const COMMERCE_STORE_ADMIN_LIST_PATH: string | null = null;

export function loadCommerceStoreCatalog(): CommerceStoreCatalog {
  if (COMMERCE_STORE_ADMIN_LIST_PATH === null) {
    return { status: 'unavailable', reason: 'missing_admin_api' };
  }

  return { status: 'unavailable', reason: 'missing_admin_api' };
}

export function resolveViewStoreUrl(
  catalog: CommerceStoreCatalog,
  selectedStoreId: string | null,
): string | null {
  if (catalog.status !== 'ready' || !selectedStoreId) return null;
  const store = catalog.stores.find((item) => item.id === selectedStoreId);
  if (!store?.previewUrl) return null;
  try {
    const url = new URL(store.previewUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.toString();
  } catch {
    return null;
  }
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
