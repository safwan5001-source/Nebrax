/**
 * CUST-HV V7d-3 — resolves a Published `NavMenu` (typed targets, V0 §11.1) into the plain
 * link tree the Header / MobileMenu render. Pure: everything it needs to know about the live
 * catalogue arrives in `NavResolveContext`, so a deleted category / product is simply absent
 * from the context and the item is **omitted** (never a dead link, never a placeholder).
 *
 * Storefront-only — the Canvas draws labels, not hrefs, so there is no web twin.
 */

import type { IconKey } from "./icon-registry";
import {
  isServedContentSlug,
  type NavBadge,
  type NavItem,
  type NavMenu,
  type NavTarget,
} from "./navigation";
import { sanitizeExternalUrl } from "./urls";

/** Product targets resolved per menu — the batch read the backend accepts (`MAX_FEATURED_PRODUCTS`). */
export const MAX_NAV_PRODUCT_TARGETS = 8;

export interface NavResolveContext {
  basePath: string;
  /** category id → permalink. An id that is absent is a deleted / inactive category. */
  categories: ReadonlyMap<string, string>;
  /** product ids that exist and are published. */
  products: ReadonlySet<string>;
}

export interface ResolvedNavChild {
  id: string;
  label: string;
  href: string;
  newTab: boolean;
  icon?: IconKey;
  badge?: NavBadge;
}

export interface ResolvedNavItem extends ResolvedNavChild {
  /** Renders as a disclosure (trigger + panel) rather than a plain link. */
  dropdown: boolean;
  children: ResolvedNavChild[];
}

export function navTargetHref(
  target: NavTarget,
  ctx: NavResolveContext,
): string | null {
  const base = ctx.basePath;
  switch (target.kind) {
    case "home":
      return base || "/";
    case "category": {
      const permalink = ctx.categories.get(target.id);
      return permalink ? `${base}/c/${permalink}` : null;
    }
    case "product":
      return ctx.products.has(target.id)
        ? `${base}/products/${target.id}`
        : null;
    case "content":
      if (!isServedContentSlug(target.slug)) return null;
      return target.slug === "contact"
        ? `${base}/#contact`
        : `${base}/policies/${target.slug}`;
    case "external":
      return sanitizeExternalUrl(target.href);
  }
}

function resolveOne(
  item: NavItem,
  ctx: NavResolveContext,
): ResolvedNavChild | null {
  if (!item.enabled) return null;
  const label = item.label.trim();
  if (!label) return null;
  const href = navTargetHref(item.target, ctx);
  if (!href) return null;
  return {
    id: item.id,
    label,
    href,
    newTab: item.target.kind === "external" && item.target.newTab === true,
    ...(item.icon ? { icon: item.icon } : {}),
    ...(item.badge ? { badge: item.badge } : {}),
  };
}

export function resolveNavMenu(
  menu: NavMenu,
  ctx: NavResolveContext,
): ResolvedNavItem[] {
  const out: ResolvedNavItem[] = [];
  for (const item of menu.items) {
    const head = resolveOne(item, ctx);
    if (!head) continue;
    const children = (item.children ?? []).flatMap((child) => {
      const resolved = resolveOne(child, ctx);
      return resolved ? [resolved] : [];
    });
    out.push({
      ...head,
      children,
      dropdown: item.presentation?.kind === "dropdown" && children.length > 0,
    });
  }
  return out;
}

/** Every category / product id a menu targets, in document order, products capped. */
export function collectNavTargetIds(menu: NavMenu): {
  categoryIds: string[];
  productIds: string[];
} {
  const categoryIds = new Set<string>();
  const productIds = new Set<string>();
  const visit = (item: NavItem) => {
    if (!item.enabled) return;
    if (item.target.kind === "category") categoryIds.add(item.target.id);
    if (
      item.target.kind === "product" &&
      productIds.size < MAX_NAV_PRODUCT_TARGETS
    ) {
      productIds.add(item.target.id);
    }
    for (const child of item.children ?? []) visit(child);
  };
  for (const item of menu.items) visit(item);
  return { categoryIds: [...categoryIds], productIds: [...productIds] };
}
