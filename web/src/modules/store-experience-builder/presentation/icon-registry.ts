/**
 * CUST-HV V7d-1 — the curated icon registry (contract: docs/plans/store/CUST-HV-V0-DECISIONS-AND-ARCHITECTURE-
 * CONTRACT.md §11.4, D-22).
 *
 * `IconKey` is a key into **this static, code-owned list** — never an upload, never an SVG string, never a path. An unknown
 * key normalises to `undefined` (fail-closed: the icon is simply not drawn). Keys are **stable and append-only**: removing or
 * renaming one is a breaking change for stored documents and needs a deprecation alias (a test pins the exact ordered list).
 * Icons are decorative by default (`aria-hidden`); one used alone needs a text alternative, which the renderer takes from the
 * caller. Directional icons mirror under RTL.
 *
 * This file is data only (no React): the glyphs live in each app's `StoreIcon` renderer, mapped by key. Twin of
 * `web/.../presentation/icon-registry.ts` (byte-identical, test-enforced). Consumers: navigation items (V7d), then benefits,
 * announcements and buttons (later slices) — the same list everywhere.
 */

export const ICON_KEYS = [
  "truck",
  "shield-check",
  "credit-card",
  "gift",
  "clock",
  "phone",
  "message-circle",
  "mail",
  "map-pin",
  "store",
  "star",
  "heart",
  "tag",
  "percent",
  "package",
  "refresh-ccw",
  "headphones",
  "leaf",
  "sparkles",
  "badge-check",
  "calendar",
  "users",
  "lock",
  "globe",
] as const;

export type IconKey = (typeof ICON_KEYS)[number];

export interface IconInfo {
  /** Merchant-facing name, per editor locale. */
  label: { ar: string; en: string };
  /** Search terms for the picker (lower-case, both languages). */
  tags: readonly string[];
  /** Points in a reading direction: mirrored under RTL. */
  directional: boolean;
}

export const ICON_REGISTRY: Readonly<Record<IconKey, IconInfo>> = {
  truck: {
    label: { ar: "شاحنة", en: "Truck" },
    tags: ["delivery", "shipping", "توصيل", "شحن"],
    directional: true,
  },
  "shield-check": {
    label: { ar: "حماية", en: "Shield" },
    tags: ["secure", "warranty", "guarantee", "ضمان", "أمان"],
    directional: false,
  },
  "credit-card": {
    label: { ar: "بطاقة دفع", en: "Credit card" },
    tags: ["payment", "pay", "دفع"],
    directional: false,
  },
  gift: {
    label: { ar: "هدية", en: "Gift" },
    tags: ["present", "offer", "هدايا"],
    directional: false,
  },
  clock: {
    label: { ar: "ساعة", en: "Clock" },
    tags: ["time", "hours", "fast", "وقت", "سريع"],
    directional: false,
  },
  phone: {
    label: { ar: "هاتف", en: "Phone" },
    tags: ["call", "contact", "اتصال"],
    directional: false,
  },
  "message-circle": {
    label: { ar: "رسالة", en: "Message" },
    tags: ["chat", "whatsapp", "support", "محادثة"],
    directional: false,
  },
  mail: {
    label: { ar: "بريد", en: "Mail" },
    tags: ["email", "contact", "إيميل"],
    directional: false,
  },
  "map-pin": {
    label: { ar: "موقع", en: "Location" },
    tags: ["address", "branch", "map", "عنوان", "فرع"],
    directional: false,
  },
  store: {
    label: { ar: "متجر", en: "Store" },
    tags: ["shop", "branch", "محل"],
    directional: false,
  },
  star: {
    label: { ar: "نجمة", en: "Star" },
    tags: ["favourite", "rating", "featured", "تقييم", "مميز"],
    directional: false,
  },
  heart: {
    label: { ar: "قلب", en: "Heart" },
    tags: ["love", "wishlist", "like", "مفضلة"],
    directional: false,
  },
  tag: {
    label: { ar: "وسم", en: "Tag" },
    tags: ["price", "label", "sale", "سعر"],
    directional: false,
  },
  percent: {
    label: { ar: "خصم", en: "Discount" },
    tags: ["sale", "offer", "discount", "عرض", "تخفيض"],
    directional: false,
  },
  package: {
    label: { ar: "طرد", en: "Package" },
    tags: ["order", "box", "parcel", "طلب"],
    directional: false,
  },
  "refresh-ccw": {
    label: { ar: "استرجاع", en: "Returns" },
    tags: ["return", "exchange", "refund", "استبدال"],
    directional: false,
  },
  headphones: {
    label: { ar: "دعم", en: "Support" },
    tags: ["help", "service", "مساعدة", "خدمة"],
    directional: false,
  },
  leaf: {
    label: { ar: "طبيعي", en: "Leaf" },
    tags: ["natural", "organic", "fresh", "eco", "طازج", "عضوي"],
    directional: false,
  },
  sparkles: {
    label: { ar: "لمعان", en: "Sparkles" },
    tags: ["new", "premium", "special", "جديد", "فاخر"],
    directional: false,
  },
  "badge-check": {
    label: { ar: "موثّق", en: "Verified" },
    tags: ["trusted", "authentic", "original", "أصلي", "موثوق"],
    directional: false,
  },
  calendar: {
    label: { ar: "تقويم", en: "Calendar" },
    tags: ["date", "schedule", "booking", "موعد", "حجز"],
    directional: false,
  },
  users: {
    label: { ar: "فريق", en: "People" },
    tags: ["team", "community", "about", "عنا"],
    directional: false,
  },
  lock: {
    label: { ar: "أمان", en: "Lock" },
    tags: ["secure", "private", "privacy", "خصوصية"],
    directional: false,
  },
  globe: {
    label: { ar: "عالمي", en: "Globe" },
    tags: ["world", "international", "language", "دولي", "لغة"],
    directional: false,
  },
};

export function isIconKey(value: unknown): value is IconKey {
  return (
    typeof value === "string" &&
    (ICON_KEYS as readonly string[]).includes(value)
  );
}

/** A known key, or `undefined` — an unknown, mistyped or hostile value draws nothing. */
export function normalizeIconKey(raw: unknown): IconKey | undefined {
  return isIconKey(raw) ? raw : undefined;
}

export function iconLabel(key: IconKey, locale: "ar" | "en"): string {
  return ICON_REGISTRY[key].label[locale];
}
