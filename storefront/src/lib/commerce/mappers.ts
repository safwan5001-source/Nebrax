import type {
  Media,
  OptionType,
  OptionValue,
  Price,
  Variant,
} from "@spree/sdk";
import type {
  AwjCategory,
  AwjCategoryRef,
  AwjProduct,
  AwjProductMedia,
  AwjProductOption,
  AwjProductVariant,
  StoreCategory,
  StoreProduct,
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
 *  - AWJ DOES have a product-variant model (VAR-COM-1): `store/v1`'s
 *    product detail carries generic `options` and real `variants` with
 *    per-variant price, availability and media. They are mapped below.
 *    The listing endpoint carries neither, so a simple product there still
 *    gets the synthetic default variant that holds its SKU and price —
 *    that one is not a real variant and must never reach the cart.
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

/**
 * A price the storefront must not print. Every field is null, so
 * `product.price?.display_amount` is falsy and the UI takes its
 * "no price to show" branch instead of rendering a formatted zero.
 */
function unpricedPrice(currency: string): Price {
  return {
    id: `price-unpriced-${currency}`,
    amount: null,
    amount_in_cents: null,
    compare_at_amount: null,
    compare_at_amount_in_cents: null,
    currency,
    display_amount: null,
    display_compare_at_amount: null,
    price_list_id: null,
  };
}

function optionLabel(
  option: AwjProductOption,
  locale: string | undefined,
): string {
  const isEnglish = locale?.toLowerCase().startsWith("en") ?? false;
  return isEnglish && option.name_en ? option.name_en : option.name;
}

/**
 * AWJ option groups become Spree option types with `kind: "awj_generic"`.
 *
 * That literal is load-bearing. `VariantPicker` draws colour swatches only
 * for `kind === "color_swatch"`, and AWJ supplies no renderer metadata and
 * no colour value at all — so every group takes the generic accessible
 * control. Deriving a swatch from a group merely named "colour" would be
 * inferring presentation from a label, which the baseline forbids.
 */
function toOptionTypes(
  options: AwjProductOption[],
  locale: string | undefined,
): OptionType[] {
  return options.map((option, index) => ({
    id: option.id,
    name: option.name,
    label: optionLabel(option, locale),
    position: index,
    kind: "awj_generic",
  }));
}

function toOptionValues(
  options: AwjProductOption[],
  locale: string | undefined,
): OptionValue[] {
  const isEnglish = locale?.toLowerCase().startsWith("en") ?? false;

  return options.flatMap((option) =>
    option.values.map((value, index) => ({
      id: value.id,
      option_type_id: option.id,
      name: value.value,
      label: isEnglish && value.value_en ? value.value_en : value.value,
      position: index,
      // Never inferred from a name. AWJ carries no colour value, so there is
      // none to give, and a guessed one would be invented merchant data.
      color_code: null,
      option_type_name: option.name,
      option_type_label: optionLabel(option, locale),
      image_url: null,
    })),
  );
}

/**
 * AWJ media URLs are guarded by Laravel's hostname-resolved storefront
 * middleware. A browser request cannot carry the server-only forwarded-host
 * gateway headers, so route AWJ media through the same-origin Next proxy.
 * Other URLs remain untouched for backward compatibility with existing API
 * consumers and test fixtures.
 */
function toRenderableMediaUrl(url: string | null): string | null {
  if (!url) return null;

  try {
    const parsed = new URL(url, "http://awj.invalid");
    const match = parsed.pathname.match(/^\/store\/v1\/media\/([^/]+)$/);
    if (match) {
      return `/api/storefront/media/${encodeURIComponent(match[1])}`;
    }
  } catch {
    // Keep the original URL if an upstream producer sends a non-URL value.
  }

  return url;
}

/**
 * Real variants, keyed by their own `option_value_ids` — which is what makes a
 * selection resolve to one variant rather than to a guess. Price, availability
 * and media are taken verbatim from the server for each variant; nothing here
 * computes any of them.
 */
function toVariants(
  product: AwjProduct,
  variants: AwjProductVariant[],
  optionValues: OptionValue[],
): Variant[] {
  const byId = new Map(optionValues.map((value) => [value.id, value]));

  return variants.map((variant) => {
    const media = variant.media.map((item) => toMedia(item, product.id));
    const purchasable = variant.in_stock !== false;

    return {
      id: variant.id,
      product_id: product.id,
      sku: variant.sku,
      options_text: variant.descriptor ?? "",
      track_inventory: variant.in_stock !== null,
      media_count: media.length,
      preorder_ships_at: null,
      thumbnail_url: media[0]?.small_url ?? product.thumbnail_url,
      purchasable,
      in_stock: variant.in_stock ?? true,
      backorderable: false,
      preorder: false,
      weight: null,
      height: null,
      width: null,
      depth: null,
      price: toPrice(variant.price.amount_minor, variant.price.currency),
      original_price: null,
      primary_media: media[0],
      media,
      option_values: variant.option_value_ids
        .map((id) => byId.get(id))
        .filter((value): value is OptionValue => value !== undefined),
    };
  });
}

function toMedia(media: AwjProductMedia, productId: string): Media {
  const url = toRenderableMediaUrl(media.url);

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
    original_url: url,
    mini_url: url,
    small_url: url,
    medium_url: url,
    large_url: url,
    xlarge_url: url,
    og_image_url: url,
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

function toCategoryRefViewModel(ref: AwjCategoryRef): StoreCategory {
  return {
    id: ref.id,
    name: ref.name,
    color: null,
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

/**
 * `products.name_en` already exists in AWJ's schema and is already returned
 * by `store/v1/products` — this is display selection, not new persistence
 * (COM-7-P2B). `product_categories` has no equivalent English column yet;
 * category names always render in Arabic regardless of locale until that
 * schema gap is addressed (documented in the P2B implementation report,
 * not silently patched here with a new column).
 */
function displayProductName(product: AwjProduct, locale?: string): string {
  const isEnglish = locale?.toLowerCase().startsWith("en") ?? false;
  return isEnglish && product.name_en ? product.name_en : product.name;
}

export function mapAwjProductToViewModel(
  product: AwjProduct,
  locale?: string,
): StoreProduct {
  const isVariantManaged = product.is_variant_managed === true;
  const awjOptions = product.options ?? [];
  const awjVariants = product.variants ?? [];

  const optionTypes = toOptionTypes(awjOptions, locale);
  const optionValues = toOptionValues(awjOptions, locale);
  const variants = toVariants(product, awjVariants, optionValues);

  /*
   * A variant-managed product has no price of its own, and the listing
   * endpoint says so by sending zero. Printing that zero as a formatted
   * price told shoppers the product was free. Detail responses do carry a
   * real figure — the cheapest active variant — so the zero is only
   * meaningless when no variant came with it.
   */
  const price =
    isVariantManaged && awjVariants.length === 0
      ? unpricedPrice(product.price.currency)
      : toPrice(product.price.amount_minor, product.price.currency);

  const media = (product.media ?? []).map((item) => toMedia(item, product.id));
  const purchasable = product.in_stock !== false;

  return {
    isVariantManaged,
    id: product.id,
    name: displayProductName(product, locale),
    slug: product.id,
    meta_title: null,
    meta_description: null,
    meta_keywords: null,
    variant_count: variants.length,
    available_on: product.created_at,
    preorder_ships_at: null,
    purchasable,
    preorder: false,
    in_stock: product.in_stock ?? true,
    backorderable: false,
    available: purchasable,
    description: product.description,
    /*
     * AWJ's `description` is a plain text column, not authored HTML. Claiming
     * it as `description_html` sent merchant-typed text through
     * `dangerouslySetInnerHTML`, which both dropped its line breaks and treated
     * input as markup. The PDP renders `description` as text instead.
     */
    description_html: null,
    default_variant_id: `${product.id}-default`,
    thumbnail_url: toRenderableMediaUrl(product.thumbnail_url),
    tags: [],
    price,
    original_price: null,
    primary_media: media[0],
    media,
    variants,
    /*
     * A variant-managed product gets no synthetic default: the synthetic one
     * carries the parent id, and sending that to the cart would add the parent
     * rather than the chosen variant. Selection must resolve to a real variant
     * or to nothing.
     */
    default_variant: isVariantManaged
      ? undefined
      : toDefaultVariant(
          product,
          price,
          toRenderableMediaUrl(product.thumbnail_url),
        ),
    option_types: optionTypes,
    option_values: optionValues,
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
): StoreCategory {
  const children = (category.children ?? []).map((child) =>
    mapAwjCategoryToViewModel(child, depth + 1),
  );

  return {
    id: category.id,
    name: category.name,
    color: category.color,
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
