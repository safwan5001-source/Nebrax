/**
 * CUST-HV V7d-3 — the Published `main` menu, resolved against the live catalogue.
 * Kept apart from `public.ts` (pure, synchronous, no I/O) because it reads categories and products.
 */

import { fetchCategories } from "@/lib/commerce/categories";
import { fetchProductsByIds } from "@/lib/commerce/products";
import type { StoreCategoryNode } from "@/lib/commerce/types";
import type { PolicyAvailability } from "@/lib/policy/availability";
import type { StorefrontPresentationConfig } from "./config";
import { mainMenu } from "./navigation";
import {
  collectNavTargetIds,
  type NavResolveContext,
  type ResolvedNavItem,
  resolveNavMenu,
} from "./navigation-resolve";
import { publishedPolicySlugs } from "./public";

function flattenCategories(
  categories: readonly StoreCategoryNode[],
  into: Map<string, string>,
): void {
  for (const category of categories) {
    into.set(category.id, category.permalink);
    if (category.children?.length) flattenCategories(category.children, into);
  }
}

/**
 * `null` ⇒ the document has no `main` menu, so the legacy `header.links` list applies (V0 §11.1).
 * A `main` menu — even one that resolves to nothing — supersedes the legacy list.
 */
export async function publishedMainNav(
  presentation: StorefrontPresentationConfig | null,
  basePath: string,
  policyAvailability: PolicyAvailability,
): Promise<ResolvedNavItem[] | null> {
  const menu = mainMenu(presentation?.navigation);
  if (!menu) return null;

  const { categoryIds, productIds } = collectNavTargetIds(menu);
  const categories = new Map<string, string>();
  if (categoryIds.length > 0) {
    // A failed read leaves the map empty: category items are omitted, never guessed.
    await fetchCategories()
      .then((res) => flattenCategories(res.data, categories))
      .catch(() => undefined);
  }
  const products = new Set<string>();
  if (productIds.length > 0) {
    await fetchProductsByIds(productIds)
      .then((found) => {
        for (const product of found) products.add(product.id);
      })
      .catch(() => undefined);
  }

  const ctx: NavResolveContext = {
    basePath,
    categories,
    products,
    policySlugs: new Set(
      publishedPolicySlugs(presentation, policyAvailability),
    ),
  };
  return resolveNavMenu(menu, ctx);
}
