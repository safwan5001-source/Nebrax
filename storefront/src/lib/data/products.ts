"use server";

import type { ProductListParams } from "@spree/sdk";
import {
  fetchProduct,
  fetchProductFilters,
  fetchProducts,
} from "@/lib/commerce/products";
import { DEFAULT_SURFACE, type Surface } from "@/lib/spree";

/**
 * COM-7-P1: product data now comes from the AWJ Store catalog adapter
 * (`@/lib/commerce/products`), not `@spree/sdk`. Function names/signatures
 * are kept identical to the pre-P1 Spree-backed implementation so every
 * existing call site (ProductsPage, CategoryPage, SearchBar,
 * FeaturedProducts, ...) keeps working unmodified.
 *
 * `surface` (DTC vs wholesale) is accepted for signature compatibility
 * only and has no effect: AWJ has no wholesale/channel-pricing concept
 * yet (wholesale is explicitly out of scope — see
 * AWJ_COM_7_SPREE_INTEGRATION_GATE.md §11/§9, "LATER"). Every call reads
 * the same AWJ storefront catalog regardless of the value passed.
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
  params: ProductListParams | undefined,
  _options?: { locale?: string; country?: string },
  _surface?: Surface,
  _userToken?: string,
) {
  return fetchProducts(params);
}

export async function getProducts(
  params?: ProductListParams,
  surface: Surface = DEFAULT_SURFACE,
) {
  return cachedListProducts(params, undefined, surface, undefined);
}

export async function cachedGetProduct(
  slugOrId: string,
  _expand?: string[],
  _options?: { locale?: string; country?: string },
  _surface?: Surface,
  _userToken?: string,
) {
  return fetchProduct(slugOrId);
}

export async function getProduct(
  slugOrId: string,
  params?: { expand?: string[] },
  surface: Surface = DEFAULT_SURFACE,
) {
  return cachedGetProduct(
    slugOrId,
    params?.expand,
    undefined,
    surface,
    undefined,
  );
}

async function cachedGetProductFilters(
  params: Record<string, unknown> | undefined,
  _options?: { locale?: string; country?: string },
  _surface?: Surface,
  _userToken?: string,
) {
  return fetchProductFilters(params);
}

export async function getProductFilters(
  params?: Record<string, unknown>,
  surface: Surface = DEFAULT_SURFACE,
) {
  return cachedGetProductFilters(params, undefined, surface, undefined);
}
