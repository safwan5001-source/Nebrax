/**
 * Wire types for the AWJ Store public catalog API (`store/v1`). These are
 * AWJ-owned — deliberately NOT re-exported `@spree/sdk` types (see
 * AWJ_SPREE_TECHNICAL_FIT_AUDIT.md §5's warning that a "thin pass-through"
 * of SDK types makes later replacement hard). `mappers.ts` translates
 * these into the Spree-shaped view models the existing UI expects.
 */

export interface AwjMoney {
  amount_minor: number;
  currency: string;
}

export interface AwjProductCategoryRef {
  id: string;
  name: string;
}

export interface AwjProductMedia {
  id: string;
  url: string;
  /** Optional for compatibility with storefront responses before MEDIA-4. */
  thumbnail_url?: string | null;
  /** Optional for compatibility with storefront responses before MEDIA-4. */
  card_url?: string | null;
  alt: string | null;
  position: number;
}

/**
 * An option group as `store/v1` reports it. Deliberately shapeless beyond a
 * name and its values: AWJ carries no renderer metadata, no `kind` and no
 * colour value, so nothing here says how a group should be drawn. A merchant's
 * groups may be colour, size, capacity, material, package, unit, model or
 * anything else they defined, and the storefront may not guess which.
 */
export interface AwjProductOption {
  id: string;
  name: string;
  name_en: string | null;
  values: AwjProductOptionValue[];
}

export interface AwjProductOptionValue {
  id: string;
  value: string;
  value_en: string | null;
}

/**
 * A real, purchasable variant. Its identity is the set of `option_value_ids`,
 * which is how a selection resolves to one variant; `id` is what the cart must
 * receive. Price, availability and media are all per-variant and all come from
 * the server — none of them is derived here.
 */
export interface AwjProductVariant {
  id: string;
  sku: string | null;
  descriptor: string | null;
  option_value_ids: string[];
  price: AwjMoney;
  /** null = availability unknown, exactly as on the product. */
  in_stock: boolean | null;
  media: AwjProductMedia[];
}

export interface AwjProduct {
  id: string;
  name: string;
  name_en: string | null;
  description: string | null;
  sku: string | null;
  category: AwjProductCategoryRef | null;
  price: AwjMoney;
  /** null = availability unknown (channel has no fulfillment policy configured). */
  in_stock: boolean | null;
  thumbnail_url: string | null;
  /** Additive bounded source for catalogue-card consumers. */
  card_url?: string | null;
  media?: AwjProductMedia[];
  /**
   * True when the product sells through variants rather than in its own right.
   * The listing endpoint then sends `price.amount_minor: 0` for it on purpose —
   * the parent has no meaningful price and resolving every variant would be an
   * N+1 across the page. A zero from a variant-managed product is therefore
   * "not priced here", never "free".
   */
  is_variant_managed?: boolean;
  /** Detail responses only; absent on the listing. */
  options?: AwjProductOption[];
  /** Detail responses only; absent on the listing. */
  variants?: AwjProductVariant[];
  /** FLOWERS-H11 — gifting blocks (detail only, each present only when non-empty); parsed in `pdp-gifting.ts`. */
  personalization?: unknown;
  content_blocks?: unknown;
  addons?: unknown;
  /** ADR-20 — list and detail; present only while delivery scheduling is on. */
  delivery_promise?: unknown;
  created_at: string | null;
  updated_at: string | null;
}

/**
 * T1 — AWJ-owned presentation type for one image/media item as the storefront
 * UI renders it (gallery, lightbox, JSON-LD). It is the structural subset of
 * fields the presentation layer actually reads, so the Spree-shaped `Media`
 * that `mappers.ts` still produces is assignable to it with no cast, and
 * removing the SDK later does not touch any consumer.
 *
 * AWJ serves a single image size per item (see `mappers.ts`), so every size
 * field points at the same URL; sizes are kept only so existing "best
 * available" fallbacks render byte-for-byte as before.
 */
export interface StoreMedia {
  id: string;
  /** Variants this item belongs to; empty = a product-level image. */
  variant_ids: string[];
  position: number;
  alt: string | null;
  original_url: string | null;
  mini_url: string | null;
  small_url: string | null;
  medium_url: string | null;
  large_url: string | null;
  xlarge_url: string | null;
  /** Bounded card/thumbnail derivative when the server provides one. */
  thumbnail_url?: string | null;
}

export interface AwjCategoryRef {
  id: string;
  name: string;
}

/**
 * T1-2 — AWJ-owned presentation type for one category node as navigation,
 * breadcrumbs, footer and banners render it. It is field-for-field the subset
 * of the Spree `Category` that the UI reads, so a Spree-shaped value (the
 * wholesale/Spree surface, tests, dev pages) is still assignable to it with no
 * cast, and nothing here imports the SDK.
 */
export interface StoreCategoryNode {
  id: string;
  name: string;
  permalink: string;
  position: number;
  depth: number;
  meta_title: string | null;
  meta_description: string | null;
  meta_keywords: string | null;
  children_count: number;
  parent_id: string | null;
  description: string;
  description_html: string;
  image_url: string | null;
  square_image_url: string | null;
  is_root: boolean;
  is_child: boolean;
  is_leaf: boolean;
  parent?: StoreCategoryNode;
  children?: StoreCategoryNode[];
  ancestors?: StoreCategoryNode[];
}

/**
 * The category view model `mappers.ts` produces: the presentation node plus
 * AWJ's authoritative presentation fields. Category media is optional because
 * existing categories may have no image; the storefront must never invent one.
 */
export interface StoreCategory extends StoreCategoryNode {
  color: string | null;
  image: { url: string; alt: string } | null;
  parent?: StoreCategory;
  children?: StoreCategory[];
  ancestors?: StoreCategory[];
}

/**
 * The Spree-shaped product view model plus the one AWJ fact that has no Spree
 * equivalent and changes how a price must be read.
 *
 * `isVariantManaged` is carried because the listing endpoint sends
 * `price.amount_minor: 0` for such a product by design — the parent has no
 * price of its own. Without this flag the storefront cannot tell that zero
 * apart from a genuinely free product, and it printed "0.00" as a real price.
 */
export type StoreProduct = StoreProductFull & {
  isVariantManaged: boolean;
  /** Explicit 800 px card derivative; thumbnail_url remains the original fallback. */
  card_url: string | null;
  /** FLOWERS-H11 — normalized gifting blocks (empty for a product without any). */
  gifting: import("./pdp-gifting").ProductGifting;
};

/**
 * T1-3 — AWJ-owned listing presentation types. Each is the structural subset of
 * the matching Spree SDK shape that the listing UI actually reads, so the
 * Spree-shaped values `mappers.ts` / the data layer still produce are assignable
 * with no cast, and nothing here imports the SDK.
 */
/** T1-4 — a price as the cards, quick view and analytics read it. */
export interface StorePrice {
  id: string;
  amount: string | null;
  amount_in_cents: number | null;
  compare_at_amount: string | null;
  compare_at_amount_in_cents: number | null;
  currency: string | null;
  display_amount: string | null;
  display_compare_at_amount: string | null;
  price_list_id: string | null;
}

/** The variant fields analytics reads (id, sku, label, prices). */
export interface StoreVariantSummary {
  id: string;
  sku: string | null;
  options_text: string;
  price: StorePrice;
  original_price: StorePrice | null;
}

/**
 * T1-4 — AWJ-owned summary of a product as catalogue cards, carousels, search
 * suggestions, quick view and analytics read it. A structural subset of the
 * Spree-shaped `Product` the mappers produce, so those values are assignable
 * with no cast.
 */
export interface StoreProductSummary {
  id: string;
  name: string;
  slug: string;
  purchasable: boolean;
  thumbnail_url: string | null;
  default_variant_id: string;
  price: StorePrice;
  original_price: StorePrice | null;
  categories?: StoreCategoryNode[];
}

/** T1-5 — an option group (e.g. colour, size) as the variant picker reads it. */
export interface StoreOptionType {
  id: string;
  name: string;
  label: string;
  position: number;
  kind: string;
}

/** T1-5 — one value of an option group on a variant. */
export interface StoreOptionValue {
  id: string;
  option_type_id: string;
  name: string;
  label: string;
  position: number;
  color_code: string | null;
  option_type_name: string;
  option_type_label: string;
  image_url: string | null;
}

/**
 * T1-5 — a merchant-defined product attribute. Discriminated on `field_type`
 * so the one field whose value is rendered as HTML (`rich_text`) is typed as a
 * string, and every other kind stays `unknown` (no `any`).
 */
export type StoreCustomField = {
  id: string;
  label: string;
  key: string;
} & (
  | { field_type: "rich_text"; value: string | null }
  | {
      field_type:
        | "short_text"
        | "long_text"
        | "number"
        | "boolean"
        | "json"
        // Forward-compatible: an unrecognised kind still renders via String().
        | (string & {});
      value: unknown;
    }
);

/** T1-5 — a purchasable variant as the product detail page reads it. */
export interface StoreVariant extends StoreVariantSummary {
  purchasable: boolean;
  in_stock: boolean;
  option_values: StoreOptionValue[];
  media?: StoreMedia[];
}

/** T1-5 — a product as the product detail page, SEO and JSON-LD read it. */
export interface StoreProductDetail extends StoreProductSummary {
  description: string | null;
  in_stock: boolean;
  media?: StoreMedia[];
  variants?: StoreVariant[];
  default_variant?: StoreVariant;
  option_types?: StoreOptionType[];
  custom_fields?: StoreCustomField[];
}

/**
 * T1-6 — the complete Spree-shaped records `mappers.ts` emits. They extend the
 * presentation subsets above with the remaining fields of each record, so the
 * mapper output, the data layer and the wholesale surface (which still returns
 * SDK values) stay mutually assignable, while nothing here imports the SDK.
 */
export interface StorePriceHistory {
  id: string;
  amount: string;
  amount_in_cents: number;
  currency: string;
  display_amount: string;
  recorded_at: string;
}

export interface StoreMediaFull extends StoreMedia {
  product_id: string | null;
  media_type: string;
  focal_point_x: number | null;
  focal_point_y: number | null;
  external_video_url: string | null;
  og_image_url: string | null;
}

export interface StoreVariantFull extends StoreVariant {
  product_id: string;
  track_inventory: boolean;
  media_count: number;
  preorder_ships_at: string | null;
  thumbnail_url: string | null;
  backorderable: boolean;
  preorder: boolean;
  weight: number | null;
  height: number | null;
  width: number | null;
  depth: number | null;
  primary_media?: StoreMediaFull;
  media?: StoreMediaFull[];
  custom_fields?: StoreCustomField[];
  prior_price?: StorePriceHistory | null;
}

export interface StoreProductFull extends StoreProductDetail {
  meta_title: string | null;
  meta_description: string | null;
  meta_keywords: string | null;
  variant_count: number;
  available_on: string | null;
  preorder_ships_at: string | null;
  preorder: boolean;
  backorderable: boolean;
  available: boolean;
  description_html: string | null;
  tags: string[];
  primary_media?: StoreMediaFull;
  media?: StoreMediaFull[];
  variants?: StoreVariantFull[];
  default_variant?: StoreVariantFull;
  option_values?: StoreOptionValue[];
  categories?: StoreCategoryNode[];
  prior_price?: StorePriceHistory | null;
}

/**
 * T1-7 — AWJ-owned catalogue request parameters. Field-for-field the shape the
 * listing/query helpers already build (page, limit, sort, expand, fields plus
 * the catalogue filters and Ransack-style predicates), so existing
 * request-building code and its serialised query strings are unchanged.
 */
export interface StoreListParams {
  page?: number;
  limit?: number;
  /** Sort order. Prefix with `-` for descending; comma-separated for several. */
  sort?: string;
  /** Associations to expand (dot notation allowed). */
  expand?: string[];
  /** Fields to include in the response. */
  fields?: string[];
}

export interface StoreProductListParams extends StoreListParams {
  /** Full-text search across name and SKU. */
  search?: string;
  /** Filter: name contains. */
  name_cont?: string;
  /** Filter: price >= value. */
  price_gte?: number;
  /** Filter: price <= value. */
  price_lte?: number;
  /** Filter by option value ids. */
  with_option_value_ids?: string[];
  /** Filter: only in-stock products. */
  in_stock?: boolean;
  /** Filter: only out-of-stock products. */
  out_of_stock?: boolean;
  /** Filter: products in category (includes descendants). */
  in_category?: string;
  /** Filter: products in any of the given categories (OR). */
  in_categories?: string[];
  /** Any additional predicate. */
  [key: string]: string | number | boolean | (string | number)[] | undefined;
}

export interface StoreCategoryListParams extends StoreListParams {
  name_cont?: string;
  parent_id_eq?: string | number;
  depth_eq?: number;
  /** Any additional predicate. */
  [key: string]: string | number | boolean | (string | number)[] | undefined;
}

export interface StorePaginationMeta {
  page: number;
  limit: number;
  count: number;
  pages: number;
  from: number;
  to: number;
  in: number;
  previous: number | null;
  next: number | null;
}

/** One page of a paginated listing (`data` + pagination `meta`). */
export interface StoreProductPage<T> {
  data: T[];
  meta: StorePaginationMeta;
}

export interface StoreFilterOption {
  id: string;
  count: number;
}

export interface StoreOptionFilterOption extends StoreFilterOption {
  name: string;
  label: string;
  position: number;
  color_code: string | null;
  image_url: string | null;
}

export interface StoreCategoryFilterOption {
  id: string;
  name: string;
  permalink: string;
  count: number;
}

export interface StorePriceRangeFilter {
  id: "price";
  type: "price_range";
  min: number;
  max: number;
  currency: string;
}

export interface StoreAvailabilityFilter {
  id: "availability";
  type: "availability";
  options: StoreFilterOption[];
}

export interface StoreOptionFilter {
  id: string;
  type: "option";
  name: string;
  label: string;
  kind: string;
  options: StoreOptionFilterOption[];
}

export interface StoreCategoryFilter {
  id: "categories";
  type: "category";
  options: StoreCategoryFilterOption[];
}

export type StoreProductFilter =
  | StorePriceRangeFilter
  | StoreAvailabilityFilter
  | StoreOptionFilter
  | StoreCategoryFilter;

export interface StoreProductFilters {
  filters: StoreProductFilter[];
  sort_options: { id: string }[];
  default_sort: string;
  total_count: number;
}

/**
 * Read-only order presentation types (H6/T1-8).
 *
 * Structural subsets of what `components/order/*` and the legacy account order
 * components read. They are not connected to any AWJ buyer-account API; the
 * legacy Spree-shaped `Order`/`Cart` values stay assignable (no casts).
 */
export interface StoreOrderAddress {
  full_name: string;
  company: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state_text: string | null;
  postal_code: string | null;
  country_name: string;
  phone: string | null;
}

export interface StoreOrderTotals {
  display_item_total: string | null;
  display_delivery_total: string | null;
  discount_total: string | null;
  display_discount_total: string | null;
  tax_total: string | null;
  display_tax_total: string | null;
  total: string | null;
  display_total: string | null;
  gift_card: unknown;
  gift_card_total: string | null;
  display_gift_card_total: string | null;
  store_credit_total: string | null;
  display_store_credit_total: string | null;
  amount_due: string | null;
  display_amount_due: string | null;
}

export interface StoreOrderLine {
  id: string;
  name: string;
  slug: string;
  options_text: string;
  quantity: number;
  display_price: string | null;
  display_total: string | null;
  thumbnail_url: string | null;
}

export interface StoreOrderFulfillment {
  id: string;
  status: string;
  tracking: string | null;
  tracking_url: string | null;
  fulfilled_at: string | null;
  items: Array<{ item_id: string }>;
  delivery_method: { name: string } | null;
  stock_location: { name: string } | null;
}

export interface StoreOrderCard {
  brand: string;
  last4: string;
  month: number;
  year: number;
}

export interface StoreOrderStoreCredit {
  display_amount_remaining: string;
}

export interface StoreOrderPayment {
  id: string;
  status: string;
  display_amount: string | null;
  source_type: "credit_card" | "store_credit" | "payment_source" | null;
  source: StoreOrderCard | StoreOrderStoreCredit | { id: string } | null;
  payment_method: { name: string } | null;
}

export interface StoreOrderSummary {
  id: string;
  number: string;
  completed_at: string | null;
  payment_status: string | null;
  fulfillment_status: string | null;
  display_total: string | null;
}

export interface StoreOrderDetail extends StoreOrderSummary, StoreOrderTotals {
  customer_note: string | null;
  items: StoreOrderLine[];
  fulfillments: StoreOrderFulfillment[];
  payments: StoreOrderPayment[];
  billing_address: StoreOrderAddress | null;
  shipping_address: StoreOrderAddress | null;
}

/**
 * Account, address, market and analytics presentation types (H6 Batch A).
 *
 * Structural twins of the SDK shapes the storefront reads, so Spree-shaped
 * values stay assignable without casts. Type-only; nothing here is connected
 * to a new AWJ API.
 */
export interface StoreCreditCard {
  id: string;
  brand: string;
  last4: string;
  month: number;
  year: number;
  name: string | null;
  default: boolean;
  gateway_payment_profile_id: string | null;
}

export interface StoreGiftCard {
  id: string;
  code: string;
  status: string;
  currency: string;
  amount: string | null;
  amount_used: string | null;
  amount_authorized: string | null;
  amount_remaining: string | null;
  display_amount: string | null;
  display_amount_used: string | null;
  display_amount_remaining: string | null;
  expires_at: string | null;
  redeemed_at: string | null;
  expired: boolean;
  active: boolean;
}

export interface StoreAddress {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  address1: string | null;
  address2: string | null;
  postal_code: string | null;
  city: string | null;
  phone: string | null;
  company: string | null;
  country_name: string;
  country_iso: string;
  state_text: string | null;
  state_abbr: string | null;
  quick_checkout: boolean;
  is_default_billing: boolean;
  is_default_shipping: boolean;
  state_name: string | null;
}

export interface StoreAddressParams {
  first_name: string;
  last_name: string;
  address1: string;
  address2?: string;
  city: string;
  postal_code: string;
  phone?: string;
  company?: string;
  /** ISO 3166-1 alpha-2 country code. */
  country_iso: string;
  /** ISO 3166-2 subdivision code without the country prefix. */
  state_abbr?: string;
  /** State name, for countries without predefined states. */
  state_name?: string;
  quick_checkout?: boolean;
  is_default_billing?: boolean;
  is_default_shipping?: boolean;
}

export interface StoreState {
  abbr: string;
  name: string;
}

export interface StoreCountry {
  iso: string;
  iso3: string;
  name: string;
  states_required: boolean;
  zipcode_required: boolean;
  states?: StoreState[];
  market?: StoreMarket | null;
}

export interface StoreMarket {
  id: string;
  name: string;
  currency: string;
  default_locale: string;
  tax_inclusive: boolean;
  default: boolean;
  country_isos: string[];
  supported_locales: string[];
  countries?: StoreCountry[];
}

export interface StoreCustomerGroup {
  id: string;
  name: string;
}

export interface StoreCustomer {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  accepts_email_marketing: boolean;
  full_name: string;
  available_store_credit_total: string;
  display_available_store_credit_total: string;
  addresses: StoreAddress[];
  default_billing_address: StoreAddress | null;
  default_shipping_address: StoreAddress | null;
  customer_groups: StoreCustomerGroup[];
}

export interface StoreOrderListParams extends StoreListParams {
  sort?: string;
  search?: string;
  state_eq?: string;
  completed_at_gte?: string;
  completed_at_lte?: string;
  [key: string]: string | number | boolean | (string | number)[] | undefined;
}

/** What GTM purchase/checkout events read from a cart or order line. */
export interface StoreAnalyticsLineItem {
  id: string;
  name: string;
  quantity: number;
  options_text: string;
  price: string | null;
  total: string | null;
  discount_total: string | null;
}

/** What GTM purchase/checkout events read from a cart or order. */
export interface StoreAnalyticsOrder {
  number: string;
  currency: string;
  item_total: string | null;
  total: string | null;
  tax_total: string | null;
  delivery_total: string | null;
  discounts: Array<{ code?: string | null }>;
  items: StoreAnalyticsLineItem[];
}

export interface AwjCategory {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  image?: { url: string; alt: string } | null;
  parent_id: string | null;
  children?: AwjCategory[];
  ancestors?: AwjCategoryRef[];
}

export interface AwjPagination {
  page: number;
  per_page: number;
  total: number;
  last_page: number;
  has_more: boolean;
}

/**
 * CUST-H4-7 — one row of `GET /store/v1/offers`. Only LIVE offers are ever
 * returned (the backend filters; nothing about hidden offers is exposed). Both
 * prices and `discount_percent` are server-derived from Commerce pricing — the
 * storefront displays them and never computes, rounds or re-derives any of
 * them. `id` is `storefront_offers.id`, the reference `OffersContent.offerIds`
 * stores; `product_id` is the catalog product it points at.
 */
export interface AwjOffer {
  id: string;
  product_id: string;
  name: string;
  name_en: string | null;
  thumbnail_url: string | null;
  reference_price: AwjMoney;
  offer_price: AwjMoney;
  discount_percent: number;
  starts_at: string | null;
  ends_at: string | null;
}

export interface AwjListResponse<T> {
  data: T[];
  meta: { request_id: string; pagination: AwjPagination };
}

export interface AwjResourceResponse<T> {
  data: T;
  meta: { request_id: string };
}
