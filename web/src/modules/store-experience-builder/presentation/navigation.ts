/**
 * CUST-HV V7d-2 — the navigation document (contract: docs/plans/store/CUST-HV-V0-DECISIONS-AND-ARCHITECTURE-
 * CONTRACT.md §11, D-18).
 *
 * One optional, additive key — `navigation: { menus }` — nested now, mega-menu-ready later. **Absent ⇒ the storefront
 * renders byte-identically to before** (§2.2) and `PRESENTATION_CONFIG_VERSION` stays 3. The legacy flat
 * `header.links` (≤ 12) keeps working untouched: only when a menu with the id `main` exists does it supersede them for the
 * header (§11.1 back-compat); old versions are never rewritten.
 *
 * Shape: ≤ 6 menus × ≤ 24 items; an item has ≤ 12 children (`MAX_NAV_DEPTH = 1` — a constant, not the shape, so a second
 * level or a mega panel later is a capability change, never a schema break). A target is **typed**, never a free path:
 * `home` · `category {id}` · `product {id}` · `content {slug ∈ CONTENT_PAGE_SLUGS}` · `external {https href, newTab?}`.
 * The renderer resolves the URL, so a deleted category / product is an omitted item, never a dead link. An item with an
 * invalid target is dropped, an invalid optional field is dropped on its own, duplicate ids are renamed deterministically,
 * and reserved extension points (`presentation.kind = mega`, `meta`) are dropped fail-closed.
 *
 * Twin of `web/.../presentation/navigation.ts` (byte-identical, test-enforced) and of PHP
 * `App\Support\Commerce\StorefrontNavigationNormalizer` (the authority); all three are pinned by
 * `tests/Fixtures/presentation/navigation.json`.
 */

import { type IconKey, normalizeIconKey } from "./icon-registry";
import { CONTENT_PAGE_SLUGS, type ContentPageSlug } from "./tokens";
import { sanitizeExternalUrl } from "./urls";

export const MAX_NAV_MENUS = 6;
export const MAX_NAV_ITEMS = 24;
export const MAX_NAV_CHILDREN = 12;
/** Child levels below a top-level item. 1 ⇒ items may have children, children may not. */
export const MAX_NAV_DEPTH = 1;
export const NAV_LABEL_MAX = 80;
export const NAV_BADGE_TEXT_MAX = 12;
export const NAV_TARGET_KINDS = [
  "home",
  "category",
  "product",
  "content",
  "external",
] as const;
export const NAV_BADGE_TONES = ["brand", "accent"] as const;
export const NAV_PRESENTATIONS = ["link", "dropdown"] as const;
/** The menu the header uses; when present it supersedes the legacy `header.links`. */
export const MAIN_MENU_ID = "main";

export type NavTarget =
  | { kind: "home" }
  | { kind: "category"; id: string }
  | { kind: "product"; id: string }
  | { kind: "content"; slug: ContentPageSlug }
  | { kind: "external"; href: string; newTab?: true };

export interface NavBadge {
  text: string;
  tone?: (typeof NAV_BADGE_TONES)[number];
}

export interface NavItem {
  id: string;
  label: string;
  target: NavTarget;
  enabled: boolean;
  icon?: IconKey;
  badge?: NavBadge;
  children?: NavItem[];
  presentation?: { kind: (typeof NAV_PRESENTATIONS)[number] };
}

export interface NavMenu {
  id: string;
  name: string;
  items: NavItem[];
}

export interface NavigationDoc {
  menus: NavMenu[];
}

/**
 * Content pages the storefront actually serves today (policies + the home `#contact` anchor).
 * `about` / `faq` are valid stored targets (V0 §11.1) but have no public route yet, so the storefront
 * omits them and the pickers mark them unavailable — the capability is not invented.
 */
export const SERVED_CONTENT_SLUGS: readonly ContentPageSlug[] = [
  "shipping-policy",
  "privacy-policy",
  "returns-policy",
  "terms-of-service",
  "contact",
];

export function isServedContentSlug(slug: string): boolean {
  return (SERVED_CONTENT_SLUGS as readonly string[]).includes(slug);
}

const ID = /^[a-zA-Z0-9_-]{1,64}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeId(value: unknown, fallback: string): string {
  const text = str(value).trim();
  return ID.test(text) ? text : fallback;
}

/** Unique within `seen`: a repeat becomes `<id>-2`, `<id>-3`, … (the base is cut so the result still fits 64). */
function uniqueId(base: string, seen: Set<string>): string {
  let id = base;
  for (let n = 2; seen.has(id); n++) {
    const suffix = `-${n}`;
    id = `${base.slice(0, 64 - suffix.length)}${suffix}`;
  }
  seen.add(id);
  return id;
}

/** The target, or `undefined` when it is not a valid typed target (the item is then dropped). */
export function normalizeNavTarget(raw: unknown): NavTarget | undefined {
  if (!isObject(raw)) return undefined;
  switch (raw.kind) {
    case "home":
      return { kind: "home" };
    case "category":
    case "product": {
      const id = str(raw.id).trim();
      return ID.test(id) ? { kind: raw.kind, id } : undefined;
    }
    case "content": {
      const slug = raw.slug;
      return typeof slug === "string" &&
        (CONTENT_PAGE_SLUGS as readonly string[]).includes(slug)
        ? { kind: "content", slug: slug as ContentPageSlug }
        : undefined;
    }
    case "external": {
      const href = sanitizeExternalUrl(str(raw.href));
      if (!href) return undefined;
      return raw.newTab === true
        ? { kind: "external", href, newTab: true }
        : { kind: "external", href };
    }
    default:
      return undefined;
  }
}

function normalizeBadge(raw: unknown): NavBadge | undefined {
  if (!isObject(raw)) return undefined;
  const text = str(raw.text).trim().slice(0, NAV_BADGE_TEXT_MAX);
  if (!text) return undefined;
  const tone = (NAV_BADGE_TONES as readonly unknown[]).includes(raw.tone)
    ? (raw.tone as (typeof NAV_BADGE_TONES)[number])
    : undefined;
  return tone ? { text, tone } : { text };
}

function normalizeItem(
  raw: unknown,
  index: number,
  depth: number,
  seen: Set<string>,
): NavItem | undefined {
  if (!isObject(raw)) return undefined;
  const target = normalizeNavTarget(raw.target);
  if (!target) return undefined;

  const item: NavItem = {
    id: uniqueId(safeId(raw.id, `nav-${index}`), seen),
    label: str(raw.label).slice(0, NAV_LABEL_MAX),
    target,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
  };
  const icon = normalizeIconKey(raw.icon);
  if (icon) item.icon = icon;
  const badge = normalizeBadge(raw.badge);
  if (badge) item.badge = badge;

  if (depth < MAX_NAV_DEPTH && Array.isArray(raw.children)) {
    const children: NavItem[] = [];
    for (const [i, child] of raw.children.entries()) {
      const normalized = normalizeItem(child, i, depth + 1, seen);
      if (normalized) children.push(normalized);
      if (children.length >= MAX_NAV_CHILDREN) break;
    }
    if (children.length > 0) item.children = children;
  }

  const presentation = isObject(raw.presentation)
    ? (NAV_PRESENTATIONS as readonly unknown[]).find(
        (kind) => kind === (raw.presentation as Record<string, unknown>).kind,
      )
    : undefined;
  if (presentation)
    item.presentation = {
      kind: presentation as (typeof NAV_PRESENTATIONS)[number],
    };
  return item;
}

function normalizeMenu(
  raw: unknown,
  index: number,
  seen: Set<string>,
): NavMenu | undefined {
  if (!isObject(raw)) return undefined;
  const itemIds = new Set<string>();
  const items: NavItem[] = [];
  if (Array.isArray(raw.items)) {
    for (const [i, item] of raw.items.entries()) {
      const normalized = normalizeItem(item, i, 0, itemIds);
      if (normalized) items.push(normalized);
      if (items.length >= MAX_NAV_ITEMS) break;
    }
  }
  return {
    id: uniqueId(safeId(raw.id, `menu-${index}`), seen),
    name: str(raw.name).slice(0, NAV_LABEL_MAX),
    items,
  };
}

/** The valid navigation document, or `undefined` when there is no menu (the key is then absent). */
export function normalizeNavigation(raw: unknown): NavigationDoc | undefined {
  if (!isObject(raw) || !Array.isArray(raw.menus)) return undefined;
  const seen = new Set<string>();
  const menus: NavMenu[] = [];
  for (const [i, menu] of raw.menus.entries()) {
    const normalized = normalizeMenu(menu, i, seen);
    if (normalized) menus.push(normalized);
    if (menus.length >= MAX_NAV_MENUS) break;
  }
  return menus.length > 0 ? { menus } : undefined;
}

/** The header's menu: `main` when the document has one, else `undefined` (the legacy `header.links` then apply). */
export function mainMenu(
  navigation: NavigationDoc | undefined,
): NavMenu | undefined {
  return navigation?.menus.find((menu) => menu.id === MAIN_MENU_ID);
}
