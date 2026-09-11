"use server";

import type { CategoryListParams, ProductListParams } from "@spree/sdk";
import { fetchCategories, fetchCategory } from "@/lib/commerce/categories";
import { fetchProducts } from "@/lib/commerce/products";

/**
 * COM-7-P1: category data now comes from the AWJ Store catalog adapter
 * (`@/lib/commerce/categories`), not `@spree/sdk`. Signatures kept
 * identical to the pre-P1 implementation so existing call sites
 * (StorefrontLayout nav, CategoryPage) keep working unmodified. See
 * `src/lib/data/products.ts` for why no `"use cache: remote"` is used.
 *
 * `params`/`options` are accepted for signature compatibility only.
 * AWJ's category tree has no Ransack-style facet params (`depth_eq`,
 * `parent_id_not_null`, ...) and no locale/country dependence yet — the
 * adapter always returns the full active root→2-level tree for the
 * resolved tenant/channel (see `StorefrontCategoryController::index()`).
 */
export async function getCategories(
  _params?: CategoryListParams,
  _options?: { locale?: string; country?: string },
) {
  return fetchCategories();
}

export async function getCategory(
  idOrPermalink: string,
  _params?: { expand?: string[] },
) {
  return fetchCategory(idOrPermalink);
}

export async function cachedGetCategory(
  idOrPermalink: string,
  _params?: { expand?: string[] },
  _options?: { locale?: string; country?: string },
) {
  return fetchCategory(idOrPermalink);
}

export async function getCategoryProducts(
  categoryId: string,
  params?: ProductListParams,
) {
  return fetchProducts({ ...params, in_category: categoryId });
}
