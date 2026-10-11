/**
 * CUST-HV V7e-2 — the Published footer link groups, resolved against the live catalogue (the footer twin of
 * `public-navigation.ts`). Kept apart from `public.ts` (pure, no I/O) because it reads categories and products.
 */

import type { Category } from "@spree/sdk";
import { fetchCategories } from "@/lib/commerce/categories";
import { fetchProductsByIds } from "@/lib/commerce/products";
import type { StorefrontPresentationConfig } from "./config";
import type { NavItem, NavMenu } from "./navigation";
import {
  collectNavTargetIds,
  type NavResolveContext,
  type ResolvedFooterGroup,
  resolveFooterGroups,
} from "./navigation-resolve";

function flatten(categories: readonly Category[], into: Map<string, string>) {
  for (const category of categories) {
    into.set(category.id, category.permalink);
    if (category.children?.length) flatten(category.children, into);
  }
}

/**
 * `null` ⇒ the footer has no `groups` (the fixed legacy columns apply). A present list that resolves to nothing yields `[]`
 * (a merchant who configured groups and emptied them sees no link groups, not the legacy ones coming back).
 */
export async function publishedFooterGroups(
  presentation: StorefrontPresentationConfig | null,
  basePath: string,
): Promise<ResolvedFooterGroup[] | null> {
  const groups = presentation?.footer.groups;
  if (!groups) return null;
  const menus = presentation?.navigation?.menus ?? [];

  // Everything the groups can point at: referenced menus + inline links, as one pseudo-menu for the id collection.
  const referenced = groups.flatMap((g) =>
    g.menu ? menus.filter((m) => m.id === g.menu) : [],
  );
  const inline: NavMenu[] = groups
    .filter((g) => !(g.menu && menus.some((m) => m.id === g.menu)))
    .map((g) => ({
      id: g.id,
      name: g.title,
      items: (g.links ?? []) as NavItem[],
    }));
  const { categoryIds, productIds } = collectNavTargetIds([
    ...referenced,
    ...inline,
  ]);

  const categories = new Map<string, string>();
  if (categoryIds.length > 0) {
    await fetchCategories()
      .then((res) => flatten(res.data, categories))
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

  const ctx: NavResolveContext = { basePath, categories, products };
  return resolveFooterGroups(groups, menus, ctx);
}
