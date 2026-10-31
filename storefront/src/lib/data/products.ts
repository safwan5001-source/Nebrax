"use server";

import {
  fetchProduct,
  fetchProductFilters,
  fetchProducts,
} from "@/lib/commerce/products";
import type { StorefrontListParams } from "@/lib/utils/listing-context";

/**
 * COM-7-P1: product data now comes from the AWJ Store catalog adapter
 * (`@/lib/commerce/products`), not `@spree/sdk`. Function names/signatures
 * are kept identical to the pre-P1 Spree-backed implementation so every
 * existing call site (ProductsPage, CategoryPage, SearchBar,
 * FeaturedProducts, ...) keeps working unmodified.
 *
 * No "use cache: remote" here (unlike the Spree-backed version this
 * replaces): the AWJ tenant/channel this deployment serves is a fixed,
 * server-only value for COM-7-P1 (see `@/lib/commerce/config`), so there
 * is exactly one tenant's data this process could ever return — but
 * caching it under a tag that doesn't encode that fact would be the
 * wrong precedent to set ahead of COM-7-P2's real per-request hostname
 * resolution. Caching for the AWJ-backed catalog is deferred to when
 * that tenant/store context varies per request and can be encoded in the
 * cache key/tag, per AWJ_STOREFRONT_PLACEMENT_TENANT_RESOLUTION_DECISION.md §9.
 */
export async function cachedListProducts(
  params: StorefrontListParams | undefined,
  _options?: { locale?: string; country?: string },
  _userToken?: string,
) {
  return fetchProducts(params);
}

export async function getProducts(params?: StorefrontListParams) {
  return cachedListProducts(params, undefined, undefined);
}

export async function cachedGetProduct(
  slugOrId: string,
  _expand?: string[],
  _options?: { locale?: string; country?: string },
  _userToken?: string,
) {
  return fetchProduct(slugOrId);
}

export async function getProduct(
  slugOrId: string,
  params?: { expand?: string[] },
) {
  return cachedGetProduct(slugOrId, params?.expand, undefined, undefined);
}

async function cachedGetProductFilters(
  params: Record<string, unknown> | undefined,
  _options?: { locale?: string; country?: string },
  _userToken?: string,
) {
  return fetchProductFilters(params);
}

export async function getProductFilters(params?: Record<string, unknown>) {
  return cachedGetProductFilters(params, undefined, undefined);
}
