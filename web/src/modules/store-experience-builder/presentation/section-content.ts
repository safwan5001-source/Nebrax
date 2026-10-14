import { normalizeWindowEdges } from "./announcements";
import {
  DISCOVERY_TEMPLATE_IDS,
  type DiscoveryTemplateId,
} from "./discovery-templates";
import {
  FACET_VISUAL_SHAPES,
  FACET_VISUAL_SIZES,
  type FacetVisualShape,
  type FacetVisualSize,
} from "./facet-visual";
import { type ContentBlock, MAX_CONTENT_BLOCKS, normalizeContentBlocks } from "./content-blocks";
import { type IconKey, normalizeIconKey } from "./icon-registry";
import { type GalleryContent, normalizeGalleryContent } from "./gallery-content";
import { type SliderContent, normalizeSliderContent } from "./slider-content";
import { sanitizeExternalUrl } from "./urls";

/**
 * STORE-CAP-CONTRACT-1 — twin of storefront/src/lib/presentation/section-content.ts.
 * Keep the two normalizers aligned. Empty content is omitted.
 */

export const MAX_BENEFIT_ITEMS = 6;
export const MAX_CUSTOM_BLOCKS = MAX_CONTENT_BLOCKS;
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
  /**
   * CUST-HV V6c-2 (V0 §8.2) — up to {@link MAX_BANNER_CTAS} call-to-action buttons. The legacy
   * `ctaLabel` / `ctaHref` stay valid and ARE `ctas[0]` while this is absent; when present it wins, and the
   * builder mirrors `ctas[0]` back into the legacy pair so an older reader still shows the first button.
   */
  ctas?: HeroCta[];
  /**
   * CUST-HV V6c-1 (V0 §8.4, D-15) — optional visibility window: `startsAt` inclusive, `endsAt` exclusive, both
   * optional UTC ISO instants. Kept exactly as typed in a Draft; rejected at publish when malformed or inverted;
   * the published storefront omits a not-yet-started / expired / invalid banner.
   */
  window?: { startsAt?: string; endsAt?: string };
}

export interface BenefitItem {
  id: string;
  title: string;
  body: string;
  /** CUST-HV V9b — optional glyph from the curated registry; absence = no icon (never stored as empty). */
  icon?: IconKey;
}

export interface BenefitsContent {
  items: BenefitItem[];
}

/** CUST-HV V9c-1 (V0 §15) — the shared block vocabulary; `heading` / `paragraph` are its two original members. */
export type CustomBlock = ContentBlock;

export interface CustomContent {
  blocks: CustomBlock[];
}

/** CUST-HV V9d-3 (V0 §14.2) — an optional title and "show title" for a product / offer shelf. `showTitle` is only ever stored as `false`. */
export interface ShelfTitle {
  title?: string;
  showTitle?: false;
}

export interface NewArrivalsContent extends ShelfTitle {}

export interface FeaturedContent extends ShelfTitle {
  productIds: string[];
}

/**
 * CUST-H4-7 — Offers presentation content. References `storefront_offers.id`
 * (Commerce authority) and nothing else: no product id, name, image, price,
 * discount, stock, date or live state is ever persisted here. Those are read
 * fresh from the workspace/public Offers APIs.
 */
export interface OffersContent extends ShelfTitle {
  offerIds: string[];
}

/**
 * FLOWERS-H9a / ADR-21 — data-backed sections. They consume Commerce data and
 * own no business truth: a shelf stores only a *source reference* (a
 * collection slug or one facet value) plus the derived "deliver today"
 * switch; discovery stores only a facet dimension key (or `brand`); the
 * delivery promise stores only optional editorial text. Products, prices,
 * stock, facet values, counts and delivery dates are always read live.
 */
export const MAX_SECTION_TITLE_LENGTH = 80;
export const MAX_DELIVERY_PROMISE_BODY_LENGTH = 200;
export const SHELF_LIMIT_MIN = 2;
export const SHELF_LIMIT_MAX = 12;
export const SHELF_LIMIT_DEFAULT = 8;
export const DISCOVERY_DISPLAYS = ["tiles", "chips"] as const;
export type DiscoveryDisplay = (typeof DISCOVERY_DISPLAYS)[number];
/**
 * Discovery axis: a merchant facet (`facet` + `dimension` = its key) or brands
 * (`brand`). A discriminated kind — not a magic `dimension` value — so a facet
 * whose key happens to be `brand` stays targetable.
 */
export const DISCOVERY_AXES = ["facet", "brand"] as const;
export type DiscoveryAxis = (typeof DISCOVERY_AXES)[number];
/**
 * AWJ-VD-H1 / VD-4a (§3.7) — optional display settings of a discovery
 * section. Each key is emitted only when present and valid, so a document
 * without them normalizes exactly as before. Twins of the PHP normalizer
 * constants; templates live in `discovery-templates.ts`.
 */
export const DISCOVERY_LAYOUTS = [
  "image-grid",
  "image-cards",
  "carousel",
  "icon-grid",
  "text-list",
] as const;
export type DiscoveryLayout = (typeof DISCOVERY_LAYOUTS)[number];
/** device => [min, max] columns. */
export const DISCOVERY_COLUMN_RANGES = {
  mobile: [1, 4],
  tablet: [2, 6],
  desktop: [2, 8],
} as const;
export interface DiscoveryColumns {
  mobile?: number;
  tablet?: number;
  desktop?: number;
}
export const DISCOVERY_ROWS_MIN = 1;
export const DISCOVERY_ROWS_MAX = 2;
export const DISCOVERY_GAPS = ["tight", "normal", "loose"] as const;
export type DiscoveryGap = (typeof DISCOVERY_GAPS)[number];
export const DISCOVERY_TEXT_POSITIONS = ["below", "overlay", "beside"] as const;
export type DiscoveryTextPosition = (typeof DISCOVERY_TEXT_POSITIONS)[number];
export const DISCOVERY_CONTENT_ORDERS = ["media-first", "label-first"] as const;
export type DiscoveryContentOrder = (typeof DISCOVERY_CONTENT_ORDERS)[number];
export const DISCOVERY_VALUE_ORDERS = ["merchant", "count"] as const;
export type DiscoveryValueOrder = (typeof DISCOVERY_VALUE_ORDERS)[number];
export const DISCOVERY_CARD_STYLES = [
  "plain",
  "outlined",
  "elevated",
  "filled",
] as const;
export type DiscoveryCardStyle = (typeof DISCOVERY_CARD_STYLES)[number];
export const DISCOVERY_ALIGNS = ["start", "center"] as const;
export type DiscoveryAlign = (typeof DISCOVERY_ALIGNS)[number];
export const DISCOVERY_MAX_ITEMS_MIN = 4;
export const DISCOVERY_MAX_ITEMS_MAX = 24;

export type ShelfSource =
  | { kind: "collection"; slug: string }
  | { kind: "facet"; key: string; value: string };

export interface ProductShelfContent extends ShelfTitle {
  title: string;
  source?: ShelfSource;
  deliverToday: boolean;
  limit: number;
}

export interface DiscoveryContent {
  title: string;
  axis: DiscoveryAxis;
  /** The facet key; present only for the `facet` axis. */
  dimension?: string;
  display: DiscoveryDisplay;
  /** VD-4a — optional display settings (absent = template, then system default). */
  layout?: DiscoveryLayout;
  template?: DiscoveryTemplateId;
  columns?: DiscoveryColumns;
  rows?: number;
  gap?: DiscoveryGap;
  textPosition?: DiscoveryTextPosition;
  contentOrder?: DiscoveryContentOrder;
  valueOrder?: DiscoveryValueOrder;
  shape?: FacetVisualShape;
  size?: FacetVisualSize;
  showLabel?: boolean;
  cardStyle?: DiscoveryCardStyle;
  align?: DiscoveryAlign;
  showCounts?: boolean;
  maxItems?: number;
}

export interface DeliveryPromiseContent {
  title: string;
  body: string;
}

/** CUST-HV V6a (V0 §8.2) — one call to action of a hero instance. */
export interface HeroCta {
  label: string;
  href: string;
  /**
   * CUST-HV V6c-5/6 (V0 §6.1) — per-CTA look override: `solid` (the section's primary button), `soft`, `outline`, or
   * `link` (text only). Absent ⇒ by position (first solid, second outline), exactly as before. With no `colour`
   * every style paints with colours the section already proves against its own backdrop.
   */
  style?: CtaStyle;
  /**
   * CUST-HV V6c-6 (V0 §6.1) — per-CTA colour role. `solid` / `soft` compute their label over their own fill (they pass
   * by construction); `outline` / `link` label with the role colour itself, which the publish gate proves against the
   * section's backdrop (`ctaColourIssues`). Absent ⇒ the section's own colours.
   */
  colour?: CtaColour;
}

export const CTA_STYLES = ["solid", "soft", "outline", "link"] as const;
export type CtaStyle = (typeof CTA_STYLES)[number];
export const CTA_COLOURS = ["brand", "accent", "text"] as const;
export type CtaColour = (typeof CTA_COLOURS)[number];

/**
 * CUST-HV V6a — a hero instance's own content. Absent ⇒ the legacy global
 * `homepage.heroHeadline/heroSubheadline` (V0 §8.1.4); `{ headline: "" }` is explicit empty
 * content (store name + the default CTA).
 */
export interface HeroContent {
  headline: string;
  subheadline?: string;
  /** At most {@link MAX_HERO_CTAS}; the model never needs a later migration for a second CTA. */
  ctas?: HeroCta[];
}

export const MAX_HERO_HEADLINE_LENGTH = 120;
export const MAX_HERO_SUBHEADLINE_LENGTH = 200;
export const MAX_HERO_CTAS = 2;
export const MAX_HERO_CTA_LABEL_LENGTH = 80;
export const MAX_BANNER_CTAS = 2;

export type SectionContent =
  | HeroContent
  | BannerContent
  | BenefitsContent
  | CustomContent
  | FeaturedContent
  | OffersContent
  | ProductShelfContent
  | NewArrivalsContent
  | DiscoveryContent
  | DeliveryPromiseContent
  | SliderContent
  | GalleryContent;

/** The hero instance's own content, or `undefined` while it still reads the legacy globals. */
export function heroContentOf(section: {
  type: string;
  content?: SectionContent;
}): HeroContent | undefined {
  return section.type === "hero" && section.content && "headline" in section.content
    ? section.content
    : undefined;
}


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
  return section.type === "banner" && section.content &&
    "ctaLabel" in section.content
    ? section.content
    : emptyBannerContent();
}

/**
 * CUST-HV V6c-2 — the buttons a banner actually carries: its `ctas` when authored, else the legacy single
 * `ctaLabel` / `ctaHref` pair (V0 §8.2: the legacy pair maps to `ctas[0]`). Incomplete entries are included —
 * callers decide what renders (only label AND link).
 */
export function bannerCtasOf(content: BannerContent): HeroCta[] {
  if (content.ctas && content.ctas.length > 0) return content.ctas;
  return content.ctaLabel !== "" || content.ctaHref !== ""
    ? [{ label: content.ctaLabel, href: content.ctaHref }]
    : [];
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

/** CUST-HV V9d-3 — the new-arrivals shelf's optional title / show-title (an empty object while none is authored). */
export function newArrivalsContentOf(section: {
  type: string;
  content?: SectionContent;
}): NewArrivalsContent {
  return section.type === "newArrivals" && section.content
    ? (section.content as NewArrivalsContent)
    : {};
}

export function productShelfContentOf(section: {
  type: string;
  content?: SectionContent;
}): ProductShelfContent {
  return section.type === "productShelf" &&
    section.content &&
    "deliverToday" in section.content
    ? section.content
    : { title: "", deliverToday: false, limit: SHELF_LIMIT_DEFAULT };
}

export function discoveryContentOf(section: {
  type: string;
  content?: SectionContent;
}): DiscoveryContent {
  return section.type === "discovery" &&
    section.content &&
    "axis" in section.content
    ? section.content
    : { title: "", axis: "facet", dimension: "", display: "tiles" };
}

/** CUST-HV V8d — the gallery instance's images and options (an empty image list while none is authored). */
export function galleryContentOf(section: {
  type: string;
  content?: SectionContent;
}): GalleryContent {
  return section.type === "gallery" &&
    section.content &&
    "images" in section.content
    ? section.content
    : { images: [] };
}

/** CUST-HV V8a — the slider instance's slides and behaviour (an empty slide list while none is authored). */
export function sliderContentOf(section: {
  type: string;
  content?: SectionContent;
}): SliderContent {
  return section.type === "slider" &&
    section.content &&
    "slides" in section.content
    ? section.content
    : { slides: [] };
}

export function deliveryPromiseContentOf(section: {
  type: string;
  content?: SectionContent;
}): DeliveryPromiseContent {
  return section.type === "deliveryPromise" &&
    section.content &&
    "body" in section.content
    ? section.content
    : { title: "", body: "" };
}

export function normalizeOptionalSectionContent(
  type: string,
  raw: unknown,
): SectionContent | undefined {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  if (type === "hero") {
    return normalizeHero(raw);
  }
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
    return content.productIds.length === 0 && !hasShelfTitle(content)
      ? undefined
      : content;
  }
  if (type === "offers") {
    const content = normalizeOffers(source);
    return content.offerIds.length === 0 && !hasShelfTitle(content)
      ? undefined
      : content;
  }
  if (type === "newArrivals") {
    return normalizeNewArrivals(source);
  }
  if (type === "productShelf") {
    return normalizeProductShelf(source);
  }
  if (type === "discovery") {
    return normalizeDiscovery(source);
  }
  if (type === "deliveryPromise") {
    return normalizeDeliveryPromise(source);
  }
  if (type === "slider") {
    return normalizeSliderContent(raw, sanitizeContentHref);
  }
  if (type === "gallery") {
    return normalizeGalleryContent(raw, sanitizeContentHref);
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

/**
 * Hero text is kept as written, only code-point truncated (the editor re-normalizes the whole
 * config on every keystroke, so trimming would swallow the space typed between two words; the
 * renderers trim). Whitespace alone collapses to "".
 */
function heroText(value: unknown, max: number): string {
  const text = asString(value);
  return text.trim() === "" ? "" : truncateToCodePoints(text, max);
}

/**
 * CUST-HV V6a/V6c-2 — the call-to-action list shared by Hero and Banner: at most `max` entries, label kept as
 * written (code-point truncated; renderers trim), link through {@link sanitizeContentHref}. A draft keeps what the
 * merchant typed (a label without a link or the reverse) and only a complete CTA renders; a wholly empty one is dropped.
 */
function normalizeCtaList(raw: unknown, max: number): HeroCta[] {
  const ctas: HeroCta[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    const label = heroText(entry.label, MAX_HERO_CTA_LABEL_LENGTH);
    const href = sanitizeContentHref(asString(entry.href));
    if (label === "" && href === "") continue;
    const cta: HeroCta = { label, href };
    const style = entry.style;
    if (typeof style === "string" && (CTA_STYLES as readonly string[]).includes(style)) {
      cta.style = style as CtaStyle;
    }
    const colour = entry.colour;
    if (typeof colour === "string" && (CTA_COLOURS as readonly string[]).includes(colour)) {
      cta.colour = colour as CtaColour;
    }

    ctas.push(cta);
    if (ctas.length >= max) break;
  }
  return ctas;
}

function normalizeHero(raw: unknown): HeroContent | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const headline = heroText(source.headline, MAX_HERO_HEADLINE_LENGTH);
  const subheadline = heroText(source.subheadline, MAX_HERO_SUBHEADLINE_LENGTH);
  const ctas = normalizeCtaList(source.ctas, MAX_HERO_CTAS);
  // explicit content only when something was written: a string `headline` key (even empty),
  // a subheadline, or a CTA
  if (typeof source.headline !== "string" && subheadline === "" && ctas.length === 0) {
    return undefined;
  }
  const content: HeroContent = { headline };
  if (subheadline !== "") content.subheadline = subheadline;
  if (ctas.length > 0) content.ctas = ctas;
  return content;
}


function normalizeBanner(source: Record<string, unknown>): BannerContent {
  const image = sanitizeExternalUrl(asString(source.imageUrl));
  const content: BannerContent = {
    title: asString(source.title).trim().slice(0, 120),
    subtitle: asString(source.subtitle).trim().slice(0, 200),
    ctaLabel: asString(source.ctaLabel).trim().slice(0, 80),
    ctaHref: sanitizeContentHref(asString(source.ctaHref)),
    imageUrl: image,
    imageAlt: truncateToCodePoints(asString(source.imageAlt).trim(), MAX_BANNER_IMAGE_ALT_LENGTH),
  };
  // CUST-HV V6c-2 — optional CTA list, before `window` (canonical order, like PHP).
  const ctas = normalizeCtaList(source.ctas, MAX_BANNER_CTAS);
  if (ctas.length > 0) content.ctas = ctas;
  // Last key, like PHP. A window alone does not revive an empty banner (see isEmptyBanner).
  const window = normalizeWindowEdges(source.window);
  if (window) content.window = window;
  return content;
}

function isEmptyBanner(content: BannerContent): boolean {
  return (
    content.title === "" &&
    content.subtitle === "" &&
    content.ctaLabel === "" &&
    content.ctaHref === "" &&
    content.imageUrl === null &&
    content.ctas === undefined
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
    const icon = normalizeIconKey(row.icon);
    items.push(icon ? { id, title, body, icon } : { id, title, body });
  });
  return { items: items.slice(0, MAX_BENEFIT_ITEMS) };
}

function normalizeCustom(source: Record<string, unknown>): CustomContent {
  return normalizeContentBlocks(source, sanitizeContentHref) ?? { blocks: [] };
}

/** PHP's default `trim` set: ASCII whitespace and NUL only (JS `trim()` would also strip NBSP and other Unicode spaces, diverging from the authority). */
function phpTrim(value: string): string {
  return value.replace(/^[ \t\n\r\0\v]+|[ \t\n\r\0\v]+$/g, "");
}

/** Twin of PHP `shelfTitleFields`: a title (≤ 80 code points, blank = absent) and `showTitle`, stored only as `false`. */
function shelfTitleFields(source: Record<string, unknown>): ShelfTitle {
  const out: ShelfTitle = {};
  const title = truncateToCodePoints(
    phpTrim(asString(source.title)),
    MAX_SECTION_TITLE_LENGTH,
  );
  if (title !== "") out.title = title;
  if (source.showTitle === false) out.showTitle = false;
  return out;
}

function hasShelfTitle(content: ShelfTitle): boolean {
  return content.title !== undefined || content.showTitle === false;
}

function normalizeNewArrivals(
  source: Record<string, unknown>,
): NewArrivalsContent | undefined {
  const fields = shelfTitleFields(source);
  return Object.keys(fields).length === 0 ? undefined : fields;
}

function normalizeFeatured(source: Record<string, unknown>): FeaturedContent {
  if (!Array.isArray(source.productIds))
    return { productIds: [], ...shelfTitleFields(source) };
  const productIds: string[] = [];
  for (const value of source.productIds) {
    if (typeof value !== "string") continue;
    const id = value.trim();
    if (id !== "" && !SAFE_ID.test(id)) continue;
    if (productIds.includes(id)) continue;
    productIds.push(id);
    if (productIds.length >= MAX_FEATURED_PRODUCTS) break;
  }
  return { productIds, ...shelfTitleFields(source) };
}

function normalizeOffers(source: Record<string, unknown>): OffersContent {
  if (!Array.isArray(source.offerIds))
    return { offerIds: [], ...shelfTitleFields(source) };
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
  return { offerIds, ...shelfTitleFields(source) };
}

function normalizeProductShelf(
  source: Record<string, unknown>,
): ProductShelfContent | undefined {
  const raw =
    source.source && typeof source.source === "object" && !Array.isArray(source.source)
      ? (source.source as Record<string, unknown>)
      : {};
  let shelfSource: ShelfSource | undefined;
  if (raw.kind === "collection") {
    const slug = safeToken(raw.slug, "");
    if (slug) shelfSource = { kind: "collection", slug };
  } else if (raw.kind === "facet") {
    const key = safeToken(raw.key, "");
    const value = safeToken(raw.value, "");
    if (key && value) shelfSource = { kind: "facet", key, value };
  }
  const deliverToday = source.deliverToday === true;
  if (!shelfSource && !deliverToday) return undefined;
  const limit =
    typeof source.limit === "number" && Number.isInteger(source.limit)
      ? Math.max(SHELF_LIMIT_MIN, Math.min(SHELF_LIMIT_MAX, source.limit))
      : SHELF_LIMIT_DEFAULT;
  const content: ProductShelfContent = {
    title: truncateToCodePoints(phpTrim(asString(source.title)), MAX_SECTION_TITLE_LENGTH),
    deliverToday,
    limit,
  };
  if (shelfSource) content.source = shelfSource;
  if (source.showTitle === false) content.showTitle = false;
  return content;
}

function normalizeDiscovery(
  source: Record<string, unknown>,
): DiscoveryContent | undefined {
  const axis: DiscoveryAxis = source.axis === "brand" ? "brand" : "facet";
  const dimension = axis === "facet" ? safeToken(source.dimension, "") : "";
  if (axis === "facet" && !dimension) return undefined;
  const display = DISCOVERY_DISPLAYS.find(
    (candidate) => candidate === source.display,
  );
  return {
    title: truncateToCodePoints(
      phpTrim(asString(source.title)),
      MAX_SECTION_TITLE_LENGTH,
    ),
    axis,
    ...(axis === "facet" ? { dimension } : {}),
    display: display ?? "tiles",
    ...discoveryDisplayOptions(source),
  };
}

/**
 * AWJ-VD-H1 / VD-4a — the optional display settings, in canonical key order.
 * Read-tolerant like the PHP authority: an unknown or mistyped value drops its
 * key. Integers follow the shelf `limit` rule — an integral number is clamped
 * into range, anything else drops the key.
 */
function discoveryDisplayOptions(
  source: Record<string, unknown>,
): Partial<DiscoveryContent> {
  const out: Partial<DiscoveryContent> = {};
  const pick = <T extends string>(
    list: readonly T[],
    value: unknown,
  ): T | undefined => list.find((candidate) => candidate === value);

  const layout = pick(DISCOVERY_LAYOUTS, source.layout);
  if (layout) out.layout = layout;
  const template = pick(DISCOVERY_TEMPLATE_IDS, source.template);
  if (template) out.template = template;
  const rawColumns =
    source.columns &&
    typeof source.columns === "object" &&
    !Array.isArray(source.columns)
      ? (source.columns as Record<string, unknown>)
      : {};
  const columns: DiscoveryColumns = {};
  for (const device of ["mobile", "tablet", "desktop"] as const) {
    const [min, max] = DISCOVERY_COLUMN_RANGES[device];
    const count = clampedInteger(rawColumns[device], min, max);
    if (count !== undefined) columns[device] = count;
  }
  if (Object.keys(columns).length > 0) out.columns = columns;
  const rows = clampedInteger(
    source.rows,
    DISCOVERY_ROWS_MIN,
    DISCOVERY_ROWS_MAX,
  );
  if (rows !== undefined) out.rows = rows;
  const gap = pick(DISCOVERY_GAPS, source.gap);
  if (gap) out.gap = gap;
  const textPosition = pick(DISCOVERY_TEXT_POSITIONS, source.textPosition);
  if (textPosition) out.textPosition = textPosition;
  const contentOrder = pick(DISCOVERY_CONTENT_ORDERS, source.contentOrder);
  if (contentOrder) out.contentOrder = contentOrder;
  const valueOrder = pick(DISCOVERY_VALUE_ORDERS, source.valueOrder);
  if (valueOrder) out.valueOrder = valueOrder;
  const shape = pick(FACET_VISUAL_SHAPES, source.shape);
  if (shape) out.shape = shape;
  const size = pick(FACET_VISUAL_SIZES, source.size);
  if (size) out.size = size;
  if (typeof source.showLabel === "boolean") out.showLabel = source.showLabel;
  const cardStyle = pick(DISCOVERY_CARD_STYLES, source.cardStyle);
  if (cardStyle) out.cardStyle = cardStyle;
  const align = pick(DISCOVERY_ALIGNS, source.align);
  if (align) out.align = align;
  if (typeof source.showCounts === "boolean")
    out.showCounts = source.showCounts;
  const maxItems = clampedInteger(
    source.maxItems,
    DISCOVERY_MAX_ITEMS_MIN,
    DISCOVERY_MAX_ITEMS_MAX,
  );
  if (maxItems !== undefined) out.maxItems = maxItems;
  return out;
}

/** A JSON integer (JS cannot tell `6` from `6.0`) clamped into [min, max]. */
function clampedInteger(
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.max(min, Math.min(max, value))
    : undefined;
}

function normalizeDeliveryPromise(
  source: Record<string, unknown>,
): DeliveryPromiseContent | undefined {
  const title = truncateToCodePoints(phpTrim(asString(source.title)), MAX_SECTION_TITLE_LENGTH);
  const body = truncateToCodePoints(
    asString(source.body).trim(),
    MAX_DELIVERY_PROMISE_BODY_LENGTH,
  );
  return title === "" && body === "" ? undefined : { title, body };
}

function safeToken(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (SAFE_ID.test(text)) return text;
  return SAFE_ID.test(fallback) ? fallback : "";
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
