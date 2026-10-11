/**
 * CUST-HV V7d-4 — pure editing operations over the `main` navigation menu (V0 §11.2). Every function returns a
 * NEW menu (or the SAME object when the operation is not allowed — the panel disables the matching control from
 * the `can*` predicates, so a refused call is only ever a stale click). Limits are the shared constants, never
 * restated: depth is one child level (`MAX_NAV_DEPTH`), ≤ 24 top-level items, ≤ 12 children per parent.
 */

import type { PresentationNavLink } from "./presentation/config";
import { CONTENT_PAGE_SLUGS } from "./presentation/tokens";
import {
  MAIN_MENU_ID,
  MAX_NAV_CHILDREN,
  MAX_NAV_ITEMS,
  NAV_LABEL_MAX,
  type NavItem,
  type NavMenu,
  type NavTarget,
  type NavigationDoc,
  isServedContentSlug,
  normalizeNavTarget,
} from "./presentation/navigation";

/** Product targets the storefront resolves per menu (one batched read); the editor refuses more. */
export const MAX_NAV_PRODUCT_TARGETS = 8;

let counter = 0;
/** A fresh id inside the stored-id alphabet (`[A-Za-z0-9_-]{1,64}`). */
export function newNavId(): string {
  counter += 1;
  return `nav-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function emptyMainMenu(): NavMenu {
  return { id: MAIN_MENU_ID, name: "", items: [] };
}

/** Replaces (or appends) the `main` menu in a document, preserving every other menu. */
export function withMainMenu(
  doc: NavigationDoc | undefined,
  menu: NavMenu,
): NavigationDoc {
  const others = (doc?.menus ?? []).filter((m) => m.id !== MAIN_MENU_ID);
  return { menus: [menu, ...others] };
}

interface Located {
  item: NavItem;
  /** `null` ⇒ top level. */
  parent: NavItem | null;
  index: number;
}

export function locate(menu: NavMenu, id: string): Located | null {
  for (const [index, item] of menu.items.entries()) {
    if (item.id === id) return { item, parent: null, index };
    for (const [childIndex, child] of (item.children ?? []).entries()) {
      if (child.id === id) return { item: child, parent: item, index: childIndex };
    }
  }
  return null;
}

function mapItems(
  menu: NavMenu,
  fn: (item: NavItem) => NavItem,
): NavMenu {
  return {
    ...menu,
    items: menu.items.map((item) => {
      const next = fn(item);
      return next.children
        ? { ...next, children: next.children.map(fn) }
        : next;
    }),
  };
}

function setChildren(item: NavItem, children: NavItem[]): NavItem {
  const { children: _drop, ...rest } = item;
  return children.length > 0 ? { ...rest, children } : rest;
}

export function countItems(menu: NavMenu): number {
  return menu.items.reduce((n, item) => n + 1 + (item.children?.length ?? 0), 0);
}

export function productTargetCount(menu: NavMenu): number {
  let n = 0;
  const visit = (item: NavItem) => {
    if (item.target.kind === "product") n += 1;
    for (const child of item.children ?? []) visit(child);
  };
  for (const item of menu.items) visit(item);
  return n;
}

export function canAddTopLevel(menu: NavMenu): boolean {
  return menu.items.length < MAX_NAV_ITEMS;
}

export function canAddProduct(menu: NavMenu): boolean {
  return productTargetCount(menu) < MAX_NAV_PRODUCT_TARGETS;
}

export function newItem(label: string, target: NavTarget): NavItem {
  return {
    id: newNavId(),
    label: label.slice(0, NAV_LABEL_MAX),
    target,
    enabled: true,
  };
}

export function addItem(menu: NavMenu, item: NavItem): NavMenu {
  if (!canAddTopLevel(menu)) return menu;
  if (item.target.kind === "product" && !canAddProduct(menu)) return menu;
  return { ...menu, items: [...menu.items, item] };
}

export function updateItem(
  menu: NavMenu,
  id: string,
  patch: Partial<Omit<NavItem, "id" | "children">>,
): NavMenu {
  if (!locate(menu, id)) return menu;
  return mapItems(menu, (item) => {
    if (item.id !== id) return item;
    const next: NavItem = { ...item, ...patch };
    // `undefined` in a patch means "clear" (icon / badge / presentation).
    for (const key of ["icon", "badge", "presentation"] as const) {
      if (key in patch && patch[key] === undefined) delete next[key];
    }
    return next;
  });
}

/** Replaces a target; refused when it would exceed the product-target budget. */
export function setTarget(menu: NavMenu, id: string, target: NavTarget): NavMenu {
  const at = locate(menu, id);
  if (!at) return menu;
  if (
    target.kind === "product" &&
    at.item.target.kind !== "product" &&
    !canAddProduct(menu)
  ) {
    return menu;
  }
  return updateItem(menu, id, { target });
}

export function removeItem(menu: NavMenu, id: string): NavMenu {
  const at = locate(menu, id);
  if (!at) return menu;
  if (!at.parent) {
    return { ...menu, items: menu.items.filter((item) => item.id !== id) };
  }
  const parentId = at.parent.id;
  return {
    ...menu,
    items: menu.items.map((item) =>
      item.id === parentId
        ? setChildren(item, (item.children ?? []).filter((c) => c.id !== id))
        : item,
    ),
  };
}

export function hasChildren(item: NavItem): boolean {
  return (item.children?.length ?? 0) > 0;
}

function swap<T>(list: T[], a: number, b: number): T[] {
  const out = list.slice();
  [out[a], out[b]] = [out[b] as T, out[a] as T];
  return out;
}

export function canMove(menu: NavMenu, id: string, delta: -1 | 1): boolean {
  const at = locate(menu, id);
  if (!at) return false;
  const siblings = at.parent ? (at.parent.children ?? []) : menu.items;
  const to = at.index + delta;
  return to >= 0 && to < siblings.length;
}

export function moveItem(menu: NavMenu, id: string, delta: -1 | 1): NavMenu {
  if (!canMove(menu, id, delta)) return menu;
  const at = locate(menu, id) as Located;
  if (!at.parent) {
    return { ...menu, items: swap(menu.items, at.index, at.index + delta) };
  }
  const parentId = at.parent.id;
  return {
    ...menu,
    items: menu.items.map((item) =>
      item.id === parentId
        ? setChildren(item, swap(item.children ?? [], at.index, at.index + delta))
        : item,
    ),
  };
}

/** "Make child ↴": a childless top-level item becomes the last child of the item above it. */
export function canIndent(menu: NavMenu, id: string): boolean {
  const at = locate(menu, id);
  if (!at || at.parent || at.index === 0) return false;
  if (hasChildren(at.item)) return false; // depth is one child level
  const above = menu.items[at.index - 1] as NavItem;
  return (above.children?.length ?? 0) < MAX_NAV_CHILDREN;
}

export function indentItem(menu: NavMenu, id: string): NavMenu {
  if (!canIndent(menu, id)) return menu;
  const at = locate(menu, id) as Located;
  const aboveId = (menu.items[at.index - 1] as NavItem).id;
  const rest = menu.items.filter((item) => item.id !== id);
  return {
    ...menu,
    items: rest.map((item) => {
      if (item.id !== aboveId) return item;
      const next = setChildren(item, [...(item.children ?? []), at.item]);
      // the first child makes its parent a disclosure unless the merchant already chose
      return item.presentation ? next : { ...next, presentation: { kind: "dropdown" } };
    }),
  };
}

/** "Move out ↰": a child becomes a top-level item right after its parent. */
export function canOutdent(menu: NavMenu, id: string): boolean {
  const at = locate(menu, id);
  return Boolean(at?.parent) && menu.items.length < MAX_NAV_ITEMS;
}

export function outdentItem(menu: NavMenu, id: string): NavMenu {
  if (!canOutdent(menu, id)) return menu;
  const at = locate(menu, id) as Located;
  const parent = at.parent as NavItem;
  const out: NavItem[] = [];
  for (const item of menu.items) {
    if (item.id === parent.id) {
      out.push(setChildren(item, (item.children ?? []).filter((c) => c.id !== id)), at.item);
    } else {
      out.push(item);
    }
  }
  return { ...menu, items: out };
}

// ── legacy `header.links` → typed items (V0 §11.1 "lazy migration on first nav edit") ─────────────────

export interface LegacyMigration {
  items: NavItem[];
  /** Labels of legacy links that used a free path the typed model cannot represent (re-add them with the pickers). */
  skipped: string[];
}

/**
 * Converts what can be converted *exactly*: `home`, `external` (https — already sanitised), and a content link
 * whose path IS a content-page slug (`/about`, `/policies/privacy-policy`, `contact`). A `category` / `product`
 * legacy link stores a free path, never an id, so it cannot be mapped without guessing — it is reported, not
 * converted. Disabled links stay (disabled) so nothing the merchant configured silently vanishes.
 */
export function migrateLegacyLinks(links: readonly PresentationNavLink[]): LegacyMigration {
  const items: NavItem[] = [];
  const skipped: string[] = [];
  for (const link of links) {
    const label = link.label.trim();
    // A label-less link never rendered on the storefront (the default "home" placeholder): nothing to preserve.
    if (!label) continue;
    let target: NavTarget | undefined;
    if (link.kind === "home") target = { kind: "home" };
    else if (link.kind === "external") target = normalizeNavTarget({ kind: "external", href: link.href });
    else if (link.kind === "content") {
      const slug = link.href.trim().replace(/^\/+/, "").replace(/^policies\//, "");
      if ((CONTENT_PAGE_SLUGS as readonly string[]).includes(slug)) target = { kind: "content", slug } as NavTarget;
    }
    if (!target || items.length >= MAX_NAV_ITEMS) {
      skipped.push(label);
      continue;
    }
    items.push({ id: newNavId(), label: label.slice(0, NAV_LABEL_MAX), target, enabled: link.enabled });
  }
  return { items, skipped };
}

export { isServedContentSlug };
