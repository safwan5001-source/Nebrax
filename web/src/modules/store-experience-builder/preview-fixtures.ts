export interface PreviewCategory {
  id: string;
  name: { ar: string; en: string };
  color: string;
  childCount: number;
}

export interface PreviewProduct {
  id: string;
  name: { ar: string; en: string };
  category: { ar: string; en: string };
}

/**
 * Preview-only catalog for Customizer layout. These are not AWJ commerce
 * facts: no prices, no stock, no publication state. The canvas labels them
 * as fixtures so they cannot be read as the live store.
 */
export const PREVIEW_CATEGORIES: PreviewCategory[] = [
  { id: "c1", name: { ar: "الإلكترونيات", en: "Electronics" }, color: "#1e3a5f", childCount: 4 },
  { id: "c2", name: { ar: "المنزل", en: "Home" }, color: "#12372a", childCount: 3 },
  { id: "c3", name: { ar: "العناية", en: "Care" }, color: "#7f1d1d", childCount: 2 },
  { id: "c4", name: { ar: "الأزياء", en: "Fashion" }, color: "#92400e", childCount: 5 },
  { id: "c5", name: { ar: "المكتب", en: "Office" }, color: "#334155", childCount: 0 },
  { id: "c6", name: { ar: "الرياضة", en: "Sport" }, color: "#0f766e", childCount: 1 },
];

export const PREVIEW_PRODUCTS: PreviewProduct[] = [
  { id: "p1", name: { ar: "سماعات لاسلكية", en: "Wireless headphones" }, category: { ar: "الإلكترونيات", en: "Electronics" } },
  { id: "p2", name: { ar: "إبريق ترشيح", en: "Pour-over kettle" }, category: { ar: "المنزل", en: "Home" } },
  { id: "p3", name: { ar: "كريم عناية", en: "Care cream" }, category: { ar: "العناية", en: "Care" } },
  { id: "p4", name: { ar: "قميص كتان", en: "Linen shirt" }, category: { ar: "الأزياء", en: "Fashion" } },
  { id: "p5", name: { ar: "دفتر ملاحظات", en: "Notebook" }, category: { ar: "المكتب", en: "Office" } },
  { id: "p6", name: { ar: "زجاجة ماء", en: "Water bottle" }, category: { ar: "الرياضة", en: "Sport" } },
  { id: "p7", name: { ar: "مصباح مكتب", en: "Desk lamp" }, category: { ar: "المكتب", en: "Office" } },
  { id: "p8", name: { ar: "سجادة تمرين", en: "Training mat" }, category: { ar: "الرياضة", en: "Sport" } },
];

export const PREVIEW_STORE_NAME = {
  ar: "متجر النور",
  en: "Al-Noor Store",
} as const;
