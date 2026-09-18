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
  created_at: string | null;
  updated_at: string | null;
}

export interface AwjCategoryRef {
  id: string;
  name: string;
}

/**
 * The Spree-shaped category view model plus the one AWJ field that has no Spree
 * equivalent: the merchant's own category colour. It is carried through rather
 * than dropped because it is the only authoritative visual identity a category
 * has — `store/v1/categories` exposes no image — and inventing category
 * photography instead is exactly what the storefront must not do.
 */
export type StoreCategory = import("@spree/sdk").Category & {
  color: string | null;
};

/**
 * The Spree-shaped product view model plus the one AWJ fact that has no Spree
 * equivalent and changes how a price must be read.
 *
 * `isVariantManaged` is carried because the listing endpoint sends
 * `price.amount_minor: 0` for such a product by design — the parent has no
 * price of its own. Without this flag the storefront cannot tell that zero
 * apart from a genuinely free product, and it printed "0.00" as a real price.
 */
export type StoreProduct = import("@spree/sdk").Product & {
  isVariantManaged: boolean;
};

export interface AwjCategory {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
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

export interface AwjListResponse<T> {
  data: T[];
  meta: { request_id: string; pagination: AwjPagination };
}

export interface AwjResourceResponse<T> {
  data: T;
  meta: { request_id: string };
}
