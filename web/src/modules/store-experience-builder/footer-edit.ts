/**
 * CUST-HV V7e-3 — pure editing operations for `footer.layout` / `footer.groups` / `footer.design` (V0 §10). Every write goes back
 * through `normalizeFooterExtras`, so the draft can never hold an invalid or empty value: clearing the last design field removes
 * `design`, emptying `groups` removes it (the fixed columns return), and what the editor produces is exactly what Publish would
 * store. Group links are the same typed navigation items as the header menu, edited with the same item operations.
 */

import {
  FOOTER_MAX_GROUPS,
  FOOTER_MAX_LINKS,
  type FooterDesign,
  type FooterExtras,
  type FooterGroup,
  type FooterLayout,
  normalizeFooterExtras,
} from "./presentation/footer-design";
import type { FooterPaymentLogos } from "./presentation/payment-logos";
import type { StorefrontPresentationConfig } from "./presentation/config";
import { MAX_NAV_ITEMS, type NavItem, type NavMenu, type NavTarget } from "./presentation/navigation";
import { MAX_NAV_PRODUCT_TARGETS, moveItem, newNavId, removeItem, setTarget, updateItem } from "./navigation-edit";

type Footer = StorefrontPresentationConfig["footer"];

/** Re-composes the footer: legacy fields untouched, optional settings re-normalised from `next`. */
export function withFooterExtras(footer: Footer, next: Partial<Record<keyof FooterExtras, unknown>>): Footer {
  const { tagline, showLogo, copyright } = footer;
  const merged = {
    layout: footer.layout,
    groups: footer.groups,
    design: footer.design,
    paymentLogos: footer.paymentLogos,
    ...next,
  };
  return { tagline, showLogo, copyright, ...normalizeFooterExtras(merged) };
}

export function setLayout(footer: Footer, layout: FooterLayout | undefined): Footer {
  return withFooterExtras(footer, { layout });
}

export function setDesign(footer: Footer, design: FooterDesign | undefined): Footer {
  return withFooterExtras(footer, { design });
}

export function setGroups(footer: Footer, groups: FooterGroup[] | undefined): Footer {
  return withFooterExtras(footer, { groups: groups && groups.length > 0 ? groups : undefined });
}

export function setPaymentLogos(footer: Footer, paymentLogos: FooterPaymentLogos): Footer {
  return withFooterExtras(footer, { paymentLogos });
}

export function canAddGroup(groups: readonly FooterGroup[] | undefined): boolean {
  return (groups?.length ?? 0) < FOOTER_MAX_GROUPS;
}

export function addGroup(groups: readonly FooterGroup[] | undefined): FooterGroup[] {
  const list = groups ? [...groups] : [];
  if (!canAddGroup(list)) return list;
  return [...list, { id: newNavId(), title: "" }];
}

export function updateGroup(
  groups: readonly FooterGroup[],
  id: string,
  patch: { title?: string; span?: 1 | 2 | undefined; menu?: string | undefined; links?: NavItem[] | undefined },
): FooterGroup[] {
  return groups.map((group) => {
    if (group.id !== id) return group;
    const next: FooterGroup = { ...group, ...patch };
    for (const key of ["span", "menu", "links"] as const) {
      if (key in patch && patch[key] === undefined) delete next[key];
    }
    if (next.links && next.links.length === 0) delete next.links;
    return next;
  });
}

export function removeGroup(groups: readonly FooterGroup[], id: string): FooterGroup[] {
  return groups.filter((group) => group.id !== id);
}

export function canMoveGroup(groups: readonly FooterGroup[], id: string, delta: -1 | 1): boolean {
  const at = groups.findIndex((g) => g.id === id);
  return at >= 0 && at + delta >= 0 && at + delta < groups.length;
}

export function moveGroup(groups: readonly FooterGroup[], id: string, delta: -1 | 1): FooterGroup[] {
  if (!canMoveGroup(groups, id, delta)) return [...groups];
  const at = groups.findIndex((g) => g.id === id);
  const out = [...groups];
  [out[at], out[at + delta]] = [out[at + delta] as FooterGroup, out[at] as FooterGroup];
  return out;
}

// ── a group's own links (flat; same item operations as a menu) ────────────────────────────────────────────

const asMenu = (group: FooterGroup): NavMenu => ({ id: group.id, name: group.title, items: group.links ?? [] });

/** Product targets across every group's OWN links (a referenced menu is the header editor's concern) — the storefront resolves 8 in total. */
export function footerProductCount(groups: readonly FooterGroup[] | undefined): number {
  let n = 0;
  for (const group of groups ?? []) for (const link of group.links ?? []) if (link.target.kind === "product") n += 1;
  return n;
}

export function canAddFooterProduct(groups: readonly FooterGroup[] | undefined): boolean {
  return footerProductCount(groups) < MAX_NAV_PRODUCT_TARGETS;
}

export function canAddLink(group: FooterGroup): boolean {
  return (group.links?.length ?? 0) < Math.min(FOOTER_MAX_LINKS, MAX_NAV_ITEMS);
}

export function newLink(label: string, target: NavTarget): NavItem {
  return { id: newNavId(), label: label.slice(0, 80), target, enabled: true };
}

/** Adds a link (and drops a referenced menu: a group has one source at a time — its own links win once it has any). */
export function addLink(groups: readonly FooterGroup[], id: string, link: NavItem): FooterGroup[] {
  return groups.map((group) => {
    if (group.id !== id || !canAddLink(group)) return group;
    if (link.target.kind === "product" && !canAddFooterProduct(groups)) return group;
    const { menu: _menu, ...rest } = group;
    return { ...rest, links: [...(group.links ?? []), link] };
  });
}

function mapLinks(groups: readonly FooterGroup[], id: string, fn: (menu: NavMenu) => NavMenu): FooterGroup[] {
  return groups.map((group) => {
    if (group.id !== id) return group;
    const items = fn(asMenu(group)).items;
    const next = { ...group, links: items };
    if (items.length === 0) delete (next as Partial<FooterGroup>).links;
    return next;
  });
}

export const editLink = {
  update: (groups: readonly FooterGroup[], id: string, linkId: string, patch: Partial<Omit<NavItem, "id" | "children">>) =>
    mapLinks(groups, id, (menu) => updateItem(menu, linkId, patch)),
  remove: (groups: readonly FooterGroup[], id: string, linkId: string) => mapLinks(groups, id, (menu) => removeItem(menu, linkId)),
  move: (groups: readonly FooterGroup[], id: string, linkId: string, delta: -1 | 1) =>
    mapLinks(groups, id, (menu) => moveItem(menu, linkId, delta)),
  retarget: (groups: readonly FooterGroup[], id: string, linkId: string, target: NavTarget): FooterGroup[] => {
    const current = groups.find((g) => g.id === id)?.links?.find((l) => l.id === linkId);
    if (target.kind === "product" && current?.target.kind !== "product" && !canAddFooterProduct(groups)) return [...groups];
    return mapLinks(groups, id, (menu) => setTarget(menu, linkId, target));
  },
};

export type { Footer };
