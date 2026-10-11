"use client";

import { useEffect, useMemo, useState } from "react";
import { listWorkspaceCategories } from "@/modules/commerce-workspace/workspace-categories";
import { listWorkspaceProducts } from "@/modules/commerce-workspace/workspace-products";
import type { NavMenu } from "./presentation/navigation";

/** Categories fetched when resolving names: 5 pages × 100 — beyond that a target is reported "unknown", never "missing". */
const CATEGORY_PAGE_SIZE = 100;
const CATEGORY_MAX_PAGES = 5;

export interface NavTargetNames {
  state: "idle" | "loading" | "ready" | "error";
  categories: ReadonlyMap<string, string>;
  products: ReadonlyMap<string, string>;
  /** `true` only when the category list was read completely, so "absent" really means deleted. */
  categoriesComplete: boolean;
}

const EMPTY: NavTargetNames = {
  state: "idle",
  categories: new Map(),
  products: new Map(),
  categoriesComplete: false,
};

function targetIds(menu: NavMenu | undefined): { categoryIds: string[]; productIds: string[] } {
  const categoryIds = new Set<string>();
  const productIds = new Set<string>();
  const visit = (item: NavMenu["items"][number]) => {
    if (item.target.kind === "category") categoryIds.add(item.target.id);
    if (item.target.kind === "product") productIds.add(item.target.id);
    for (const child of item.children ?? []) visit(child);
  };
  for (const item of menu?.items ?? []) visit(item);
  return { categoryIds: [...categoryIds].sort(), productIds: [...productIds].sort() };
}

/**
 * CUST-HV V7d-4 — resolves the names (and existence) of the category / product targets a menu points at, so the
 * editor can say "this target no longer exists — hidden on the store" exactly where the storefront would omit it.
 * Re-runs only when the SET of targeted ids (or the storefront) changes — typing a label never refetches — and a
 * response that arrives after the inputs changed is discarded (stale guard).
 */
export function useNavTargetNames(
  storefrontId: string | null | undefined,
  menu: NavMenu | undefined,
): NavTargetNames {
  const { categoryIds, productIds } = useMemo(() => targetIds(menu), [menu]);
  const key = `${categoryIds.join(",")}|${productIds.join(",")}`;
  const [result, setResult] = useState<NavTargetNames>(EMPTY);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the memoised identity of both id lists
  useEffect(() => {
    if (!storefrontId || (categoryIds.length === 0 && productIds.length === 0)) {
      setResult(EMPTY);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setResult((prev) => ({ ...prev, state: "loading" }));

    (async () => {
      const products = new Map<string, string>();
      const categories = new Map<string, string>();
      let categoriesComplete = false;
      if (productIds.length > 0) {
        const res = await listWorkspaceProducts(storefrontId, { ids: productIds.slice(0, 8) }, controller.signal);
        if (!res.ok) return { error: true as const };
        for (const row of res.data) products.set(row.id, row.name);
      }
      if (categoryIds.length > 0) {
        for (let page = 1; page <= CATEGORY_MAX_PAGES; page++) {
          const res = await listWorkspaceCategories(storefrontId, { page, perPage: CATEGORY_PAGE_SIZE }, controller.signal);
          if (!res.ok) return { error: true as const };
          for (const row of res.data) categories.set(row.id, row.name);
          if (!res.hasMore) {
            categoriesComplete = true;
            break;
          }
        }
      }
      return { error: false as const, products, categories, categoriesComplete };
    })()
      .then((out) => {
        if (cancelled) return;
        setResult(
          out.error
            ? { ...EMPTY, state: "error" }
            : { state: "ready", products: out.products, categories: out.categories, categoriesComplete: out.categoriesComplete },
        );
      })
      .catch(() => {
        if (!cancelled) setResult({ ...EMPTY, state: "error" });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [storefrontId, key]);

  return result;
}
