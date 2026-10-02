export interface PreviewCategory {
  id: string;
  name: { ar: string; en: string };
  color: string;
  childCount: number;
}

/**
 * Preview-only header/footer chrome fixture for Customizer layout (category
 * nav chips, footer "shop" links) — not AWJ commerce facts: no prices, no
 * stock, no publication state. The canvas labels them as fixtures so they
 * cannot be read as the live store.
 *
 * CUST-H4-3 — the Home "categories"/"newArrivals" *sections'* own Canvas
 * preview no longer uses this fixture (or the equivalent product fixture,
 * removed in this slice): they render real, tenant/storefront-scoped
 * catalog data via `ExperienceBuilder`'s `homeCategories`/`homeNewArrivals`
 * state. This fixture remains only for the two chrome surfaces named above,
 * which are outside H4-3's scope (see the implementation report).
 */
export const PREVIEW_CATEGORIES: PreviewCategory[] = [
  { id: "c1", name: { ar: "الإلكترونيات", en: "Electronics" }, color: "#1e3a5f", childCount: 4 },
  { id: "c2", name: { ar: "المنزل", en: "Home" }, color: "#12372a", childCount: 3 },
  { id: "c3", name: { ar: "العناية", en: "Care" }, color: "#7f1d1d", childCount: 2 },
  { id: "c4", name: { ar: "الأزياء", en: "Fashion" }, color: "#92400e", childCount: 5 },
  { id: "c5", name: { ar: "المكتب", en: "Office" }, color: "#334155", childCount: 0 },
  { id: "c6", name: { ar: "الرياضة", en: "Sport" }, color: "#0f766e", childCount: 1 },
];

export const PREVIEW_STORE_NAME = {
  ar: "متجر النور",
  en: "Al-Noor Store",
} as const;
