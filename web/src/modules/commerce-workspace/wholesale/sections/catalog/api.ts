import {
  loadProductPublication,
  loadProductPublicationList,
  replaceProductPublication,
  type ProductPublicationListPage,
  type PublicationStatusFilter,
} from '@/modules/products/publication';

/**
 * Wholesale Catalog = the product publication of the ACTIVE store's channel (`CommerceListing.is_published`), the
 * single source of truth the storefront reads. No parallel "wholesale catalog" table exists, so this client only
 * scopes the existing publication endpoints to one store.
 */

export type CatalogCounts = { all: number; published: number; unpublished: number };

export function loadStoreCatalogPage(
  storefrontId: string,
  params: { search?: string; status?: PublicationStatusFilter; page?: number; perPage?: number },
): Promise<ProductPublicationListPage> {
  return loadProductPublicationList({ ...params, storefrontId });
}

/** Three light reads (server minimum page size is 10) — the totals come from the server, never from page contents. */
export async function loadStoreCatalogCounts(storefrontId: string): Promise<CatalogCounts> {
  const [all, published, unpublished] = await Promise.all(
    (['all', 'published', 'unpublished'] as const).map((status) =>
      loadProductPublicationList({ storefrontId, status, page: 1, perPage: 10 }),
    ),
  );
  return { all: all.meta.total, published: published.meta.total, unpublished: unpublished.meta.total };
}

/**
 * Publish/unpublish ONE product on ONE store. The server contract replaces the product's publication across ALL web
 * stores, and a store-scoped list only carries the scoped store — so the full current state is read first and only
 * the target store is changed. Publishing here never touches the product's publication on other stores.
 */
export async function setStorePublication(productId: string, storeId: string, publish: boolean) {
  const current = await loadProductPublication(productId);
  const ids = current.filter((store) => store.isPublished).map((store) => store.id);
  const next = publish ? [...new Set([...ids, storeId])] : ids.filter((id) => id !== storeId);
  return replaceProductPublication(productId, next);
}
