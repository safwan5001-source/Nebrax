import { sanitizeExternalUrl } from "./urls";

/**
 * STORE-CAP-CONTRACT-1 — optional per-instance content.
 *
 * Absent content is the empty state. Empty content is omitted so older
 * `{id,type,visible}` documents stay byte-stable. Unknown keys are dropped.
 * Text is plain text (callers must not inject it as HTML). Links are https
 * or a same-site path. Images are https URLs only — no data URLs and no
 * new media store. Featured content stores catalog identifiers, never price,
 * stock, tax, or discount facts.
 */

export const MAX_BENEFIT_ITEMS = 6;
export const MAX_CUSTOM_BLOCKS = 8;
export const MAX_FEATURED_PRODUCTS = 8;
export const MAX_OFFERS = 8;

const SAFE_ID = /^[a-zA-Z0-9_-]{1,64}$/;

export const MAX_BANNER_IMAGE_ALT_LENGTH = 150;

export interface BannerContent {
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaHref: string;
  imageUrl: string | null;
  /**
   * CUST-H4-4 — optional merchant-authored alt text for `imageUrl`.
   * Additive; absent/empty keeps the image decorative (`alt=""`), matching
   * every document stored before this field existed.
   */
  imageAlt?: string;
}

export interface BenefitItem {
  id: string;
  title: string;
  body: string;
}

export interface BenefitsContent {
  items: BenefitItem[];
}

export interface CustomBlock {
  id: string;
  kind: "heading" | "paragraph";
  text: string;
}

export interface CustomContent {
  blocks: CustomBlock[];
}

export interface FeaturedContent {
  productIds: string[];
}

/**
 * CUST-H4-7 — Offers presentation content. References `storefront_offers.id`
 * (Commerce authority) and nothing else: no product id, name, image, price,
 * discount, stock, date or live state is ever persisted here. Those are read
 * fresh from the workspace/public Offers APIs.
 */
export interface OffersContent {
  offerIds: string[];
}

export type SectionContent =
  | BannerContent
  | BenefitsContent
  | CustomContent
  | FeaturedContent
  | OffersContent;

export function emptyBannerContent(): BannerContent {
  return {
    title: "",
    subtitle: "",
    ctaLabel: "",
    ctaHref: "",
    imageUrl: null,
    imageAlt: "",
  };
}

export function bannerContentOf(section: {
  type: string;
  content?: SectionContent;
}): BannerContent {
  return section.type === "banner" &&
    section.content &&
    "title" in section.content
    ? section.content
    : emptyBannerContent();
}

export function benefitsContentOf(section: {
  type: string;
  content?: SectionContent;
}): BenefitsContent {
  return section.type === "benefits" &&
    section.content &&
    "items" in section.content
    ? section.content
    : { items: [] };
}

export function customContentOf(section: {
  type: string;
  content?: SectionContent;
}): CustomContent {
  return section.type === "customContent" &&
    section.content &&
    "blocks" in section.content
    ? section.content
    : { blocks: [] };
}

export function featuredContentOf(section: {
  type: string;
  content?: SectionContent;
}): FeaturedContent {
  return section.type === "featured" &&
    section.content &&
    "productIds" in section.content
    ? section.content
    : { productIds: [] };
}

export function offersContentOf(section: {
  type: string;
  content?: SectionContent;
}): OffersContent {
  return section.type === "offers" &&
    section.content &&
    "offerIds" in section.content
    ? section.content
    : { offerIds: [] };
}

export function normalizeOptionalSectionContent(
  type: string,
  raw: unknown,
): SectionContent | undefined {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  if (type === "banner") {
    const content = normalizeBanner(source);
    return isEmptyBanner(content) ? undefined : content;
  }
  if (type === "benefits") {
    const content = normalizeBenefits(source);
    return content.items.length === 0 ? undefined : content;
  }
  if (type === "customContent") {
    const content = normalizeCustom(source);
    return content.blocks.length === 0 ? undefined : content;
  }
  if (type === "featured") {
    const content = normalizeFeatured(source);
    return content.productIds.length === 0 ? undefined : content;
  }
  if (type === "offers") {
    const content = normalizeOffers(source);
    return content.offerIds.length === 0 ? undefined : content;
  }
  return undefined;
}

/**
 * CUST-H4-4 review fix — `String.prototype.slice` counts UTF-16 code
 * units, not characters: an astral codepoint (most emoji, among other
 * scripts) is two UTF-16 units, so `slice(0, 150)` on 150 emoji keeps only
 * ~75 of them and can cut a surrogate pair in half, leaving an unpaired
 * surrogate. The PHP server-authoritative normalizer uses `mb_substr`,
 * which counts actual characters (Unicode code points) — this keeps the
 * two aligned. `Array.from` iterates a string by code point, so slicing
 * the resulting array operates on whole characters, never a half-surrogate.
 */
function truncateToCodePoints(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join("");
}

export function sanitizeContentHref(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/")) {
    if (trimmed.startsWith("//") || /[\s<>"']/.test(trimmed)) return "";
    return trimmed.slice(0, 240);
  }
  return sanitizeExternalUrl(trimmed) ?? "";
}

function normalizeBanner(source: Record<string, unknown>): BannerContent {
  const image = sanitizeExternalUrl(asString(source.imageUrl));
  return {
    title: asString(source.title).trim().slice(0, 120),
    subtitle: asString(source.subtitle).trim().slice(0, 200),
    ctaLabel: asString(source.ctaLabel).trim().slice(0, 80),
    ctaHref: sanitizeContentHref(asString(source.ctaHref)),
    imageUrl: image,
    imageAlt: truncateToCodePoints(
      asString(source.imageAlt).trim(),
      MAX_BANNER_IMAGE_ALT_LENGTH,
    ),
  };
}

function isEmptyBanner(content: BannerContent): boolean {
  return (
    content.title === "" &&
    content.subtitle === "" &&
    content.ctaLabel === "" &&
    content.ctaHref === "" &&
    content.imageUrl === null
  );
}

function normalizeBenefits(source: Record<string, unknown>): BenefitsContent {
  if (!Array.isArray(source.items)) return { items: [] };
  const items: BenefitItem[] = [];
  source.items.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const row = item as Record<string, unknown>;
    const title = asString(row.title).trim().slice(0, 80);
    const body = asString(row.body).trim().slice(0, 200);
    const id = safeToken(row.id, `benefit-${index}`);
    if (!id || items.some((existing) => existing.id === id)) return;
    items.push({ id, title, body });
  });
  return { items: items.slice(0, MAX_BENEFIT_ITEMS) };
}

function normalizeCustom(source: Record<string, unknown>): CustomContent {
  if (!Array.isArray(source.blocks)) return { blocks: [] };
  const blocks: CustomBlock[] = [];
  source.blocks.forEach((block, index) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) return;
    const row = block as Record<string, unknown>;
    const kind =
      row.kind === "heading" || row.kind === "paragraph" ? row.kind : null;
    if (!kind) return;
    const text = asString(row.text)
      .trim()
      .slice(0, kind === "heading" ? 120 : 600);
    const id = safeToken(row.id, `block-${index}`);
    if (!id || blocks.some((existing) => existing.id === id)) return;
    blocks.push({ id, kind, text });
  });
  return { blocks: blocks.slice(0, MAX_CUSTOM_BLOCKS) };
}

function normalizeFeatured(source: Record<string, unknown>): FeaturedContent {
  if (!Array.isArray(source.productIds)) return { productIds: [] };
  const productIds: string[] = [];
  for (const value of source.productIds) {
    if (typeof value !== "string") continue;
    const id = value.trim();
    if (id !== "" && !SAFE_ID.test(id)) continue;
    if (productIds.includes(id)) continue;
    productIds.push(id);
    if (productIds.length >= MAX_FEATURED_PRODUCTS) break;
  }
  return { productIds };
}

function normalizeOffers(source: Record<string, unknown>): OffersContent {
  if (!Array.isArray(source.offerIds)) return { offerIds: [] };
  const offerIds: string[] = [];
  for (const value of source.offerIds) {
    if (typeof value !== "string") continue;
    const id = value.trim();
    // Unlike Featured's draft-friendly empty-token allowance, an offer id is
    // always a real storefront_offers uuid: an empty/unsafe token is dropped.
    if (!SAFE_ID.test(id)) continue;
    if (offerIds.includes(id)) continue;
    offerIds.push(id);
    if (offerIds.length >= MAX_OFFERS) break;
  }
  return { offerIds };
}

function safeToken(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (SAFE_ID.test(text)) return text;
  return SAFE_ID.test(fallback) ? fallback : "";
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
