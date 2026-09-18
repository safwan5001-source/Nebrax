"use client";

import type { Product } from "@spree/sdk";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { memo } from "react";
import { HiddenPricePrompt } from "@/components/products/HiddenPricePrompt";
import { ProductImage } from "@/components/ui/product-image";
import { trackSelectItem } from "@/lib/analytics/gtm";

interface ProductCardProps {
  product: Product;
  basePath?: string;
  categoryId?: string;
  index?: number;
  listId?: string;
  listName?: string;
  fetchPriority?: "high" | "low" | "auto";
  /** Optional currency used for analytics; omit to skip the select_item event. */
  currency?: string;
}

export const ProductCard = memo(function ProductCard({
  product,
  basePath = "",
  categoryId,
  index,
  listId,
  listName,
  fetchPriority,
  currency,
}: ProductCardProps) {
  const t = useTranslations("products");
  const imageUrl = product.thumbnail_url || null;

  // Current display price
  const displayPrice = product.price?.display_amount;

  const currentAmountCents = product.price?.amount_in_cents;
  const originalAmountCents = product.original_price?.amount_in_cents;
  const compareAtAmountCents = product.price?.compare_at_amount_in_cents;
  const onSale =
    (currentAmountCents != null &&
      originalAmountCents != null &&
      currentAmountCents < originalAmountCents) ||
    (compareAtAmountCents != null &&
      currentAmountCents != null &&
      currentAmountCents < compareAtAmountCents);

  const strikethroughPrice = onSale
    ? ((product.original_price?.display_amount &&
      product.original_price.display_amount !== displayPrice
        ? product.original_price.display_amount
        : product.price?.display_compare_at_amount) ?? null)
    : null;

  /**
   * The card's eyebrow. This is the product's own category as the catalogue
   * reports it — not a merchandising label. It is already part of
   * `PRODUCT_CARD_FIELDS`, so it costs no extra payload, and it gives the card
   * the second line of real information it needs to read as a catalogue entry
   * rather than a bare image with a price under it.
   */
  const categoryName = product.categories?.[0]?.name ?? null;

  const handleClick = () => {
    if (index != null && listId && listName && currency) {
      trackSelectItem(product, listId, listName, index, currency);
    }
  };

  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-store border border-store-border bg-store-surface transition-shadow duration-150 hover:shadow-md focus-within:shadow-md motion-reduce:transition-none">
      {/* Image. Bounded by height rather than aspect ratio: a square tile grows
          with the column and, at desktop widths, turns an eight-product shelf
          into a wall of photography with the catalogue text pushed out of the
          fold. It sits flush inside the card rather than inset in a rounded
          tile of its own — one frame per product, not a frame inside a frame. */}
      <div className="relative h-36 shrink-0 bg-store-surface-muted sm:h-44 md:h-52">
        <ProductImage
          src={imageUrl}
          alt={product.name}
          fill
          className="object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 260px"
          iconClassName="w-10 h-10"
          fetchPriority={fetchPriority}
        />
        {onSale && (
          <span className="absolute top-2 start-2 z-10 rounded-md bg-store-foreground px-2 py-0.5 text-[0.625rem] font-bold text-store-surface">
            {t("sale")}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex grow flex-col p-3">
        {categoryName && (
          <span className="mb-0.5 line-clamp-1 text-[0.625rem] font-medium text-store-muted-foreground">
            {categoryName}
          </span>
        )}

        <h3 className="line-clamp-2 text-xs font-bold leading-snug text-store-foreground transition-colors group-hover:text-store-primary sm:text-sm">
          {/* Stretched link: the ::after overlay keeps the whole card clickable
              without wrapping the content in an <a> — HiddenPricePrompt renders
              its own link, and anchors can't nest. */}
          <Link
            href={`${basePath}/products/${product.slug}${categoryId ? `?category_id=${categoryId}` : ""}`}
            className="after:absolute after:inset-0"
            onClick={handleClick}
          >
            {product.name}
          </Link>
        </h3>

        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {displayPrice ? (
            <span className="text-sm font-black text-store-primary md:text-base">
              {displayPrice}
            </span>
          ) : (
            // Null price: a deliberate hide inside a HiddenPricingProvider
            // (renders a sign-in prompt), otherwise renders nothing.
            <HiddenPricePrompt />
          )}
          {onSale && strikethroughPrice && (
            <span className="text-xs text-store-muted-foreground line-through">
              {strikethroughPrice}
            </span>
          )}
          {!product.purchasable && (
            <span className="text-[0.625rem] font-medium text-store-muted-foreground">
              {t("outOfStock")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});
