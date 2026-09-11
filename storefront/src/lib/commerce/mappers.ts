import type { Category, Media, Price, Product, Variant } from "@spree/sdk";
import type {
  AwjCategory,
  AwjCategoryRef,
  AwjProduct,
  AwjProductMedia,
} from "./types";

/**
 * Maps AWJ Store catalog data into the Spree-shaped view models the
 * existing (adopted) Spree Storefront UI components already render
 * (ProductCard, ProductDetails, MediaGallery, category nav, ...).
 *
 * This is a VIEW MODEL boundary only: no `@spree/sdk` runtime code is
 * invoked here (the `@spree/sdk` types are imported `type`-only and
 * erased at build time). Per AWJ_COM_7_SPREE_INTEGRATION_GATE.md §4,
 * reusing Spree's UI is fine; treating its wire shapes as AWJ's own
 * vocabulary is not — `src/lib/commerce/types.ts` is AWJ's real contract,
 * and this file is the one place that translates it for reuse by UI that
 * has not been rewritten yet.
 *
 * Known, deliberate gaps (documented in the COM-7-P1 implementation
 * report, not hidden here):
 *  - AWJ has no product-variant model (explicitly deferred — see
 *    AWJ_SPREE_TECHNICAL_FIT_AUDIT.md §4). A single synthetic default
 *    variant carries the SKU/price/availability so variant-aware UI
 *    (SKU row, add-to-cart wiring) still renders sensibly; it is not a
 *    real Spree variant and never will back a real cart.
 *  - AWJ has no product/category slug field yet, so `slug`/`permalink`
 *    are the entity's UUID — functional routing, not a pretty URL.
 *  - AWJ serves one image size per media item (no responsive/resized
 *    variants), so every Spree `Media` size field points at the same URL.
 */

function formatMoney(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("ar-SA", {
      style: "currency",
      currency,
      currencyDisplay: "symbol",
    }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`;
  }
}

function toPrice(amountMinor: number, currency: string): Price {
  return {
    id: `price-${amountMinor}-${currency}`,
    amount: (amountMinor / 100).toFixed(2),
    amount_in_cents: amountMinor,
    compare_at_amount: null,
    compare_at_amount_in_cents: null,
    currency,
    display_amount: formatMoney(amountMinor, currency),
    display_compare_at_amount: null,
    price_list_id: null,
  };
}

function toMedia(media: AwjProductMedia, productId: string): Media {
  return {
    id: media.id,
    product_id: productId,
    variant_ids: [],
    position: media.position,
    alt: media.alt,
    media_type: "image",
    focal_point_x: null,
    focal_point_y: null,
    external_video_url: null,
    original_url: media.url,
    mini_url: media.url,
    small_url: media.url,
    medium_url: media.url,
    large_url: media.url,
    xlarge_url: media.url,
    og_image_url: media.url,
  };
}

function toDefaultVariant(
  product: AwjProduct,
  price: Price,
  thumbnailUrl: string | null,
): Variant {
  const purchasable = product.in_stock !== false;

  return {
    id: `${product.id}-default`,
    product_id: product.id,
    sku: product.sku,
    options_text: "",
    track_inventory: product.in_stock !== null,
    media_count: product.media?.length ?? (thumbnailUrl ? 1 : 0),
    preorder_ships_at: null,
    thumbnail_url: thumbnailUrl,
    purchasable,
    in_stock: product.in_stock ?? true,
    backorderable: false,
    preorder: false,
    weight: null,
    height: null,
    width: null,
    depth: null,
    price,
    original_price: null,
    option_values: [],
  };
}

function toCategoryRefViewModel(ref: AwjCategoryRef): Category {
  return {
    id: ref.id,
    name: ref.name,
    permalink: ref.id,
    position: 0,
    depth: 0,
    meta_title: null,
    meta_description: null,
    meta_keywords: null,
    children_count: 0,
    parent_id: null,
    description: "",
    description_html: "",
    image_url: null,
    square_image_url: null,
    is_root: true,
    is_child: false,
    is_leaf: true,
  };
}

export function mapAwjProductToViewModel(product: AwjProduct): Product {
  const price = toPrice(product.price.amount_minor, product.price.currency);
  const media = (product.media ?? []).map((item) => toMedia(item, product.id));
  const purchasable = product.in_stock !== false;

  return {
    id: product.id,
    name: product.name,
    slug: product.id,
    meta_title: null,
    meta_description: null,
    meta_keywords: null,
    variant_count: 0,
    available_on: product.created_at,
    preorder_ships_at: null,
    purchasable,
    preorder: false,
    in_stock: product.in_stock ?? true,
    backorderable: false,
    available: purchasable,
    description: product.description,
    description_html: product.description,
    default_variant_id: `${product.id}-default`,
    thumbnail_url: product.thumbnail_url,
    tags: [],
    price,
    original_price: null,
    primary_media: media[0],
    media,
    variants: [],
    default_variant: toDefaultVariant(product, price, product.thumbnail_url),
    option_types: [],
    option_values: [],
    categories: product.category
      ? [toCategoryRefViewModel(product.category)]
      : [],
    custom_fields: [],
    prior_price: null,
  };
}

export function mapAwjCategoryToViewModel(
  category: AwjCategory,
  depth = 0,
): Category {
  const children = (category.children ?? []).map((child) =>
    mapAwjCategoryToViewModel(child, depth + 1),
  );

  return {
    id: category.id,
    name: category.name,
    permalink: category.id,
    position: 0,
    depth,
    meta_title: null,
    meta_description: null,
    meta_keywords: null,
    children_count: children.length,
    parent_id: category.parent_id,
    description: category.description ?? "",
    description_html: category.description ?? "",
    image_url: null,
    square_image_url: null,
    is_root: category.parent_id === null,
    is_child: category.parent_id !== null,
    is_leaf: children.length === 0,
    children: children.length > 0 ? children : undefined,
    ancestors: category.ancestors?.map(toCategoryRefViewModel),
  };
}
