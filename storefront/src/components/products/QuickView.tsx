"use client";

import type { Product } from "@spree/sdk";
import { Eye, Loader2, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { QuantityPickerField } from "@/components/cart/QuantityPickerField";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProductImage } from "@/components/ui/product-image";
import { useCart } from "@/contexts/CartContext";

interface QuickViewProps {
  product: Product;
  basePath: string;
  categoryId?: string;
  isVariantManaged: boolean;
}

/**
 * AWJ Market's quick-view affordance (see the coverage matrix's product-card
 * evidence). Deliberately uses only the fields the catalogue listing already
 * fetched for the card behind it — no per-card or on-open product-detail
 * request. That is enough for a simple product (name, image, price,
 * quantity, add-to-cart) but not for a variant-managed one, which has no
 * resolvable price or sellable identity from the listing payload alone; that
 * case links to the real PDP instead of pretending to resolve a variant it
 * cannot see, matching how the card's own inline action already behaves.
 */
export function QuickView({
  product,
  basePath,
  categoryId,
  isVariantManaged,
}: QuickViewProps) {
  const t = useTranslations("products");
  const { addItem, surface } = useCart();
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);

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

  const productHref = `${basePath}/products/${product.slug}${categoryId ? `?category_id=${categoryId}` : ""}`;
  const canQuickAdd =
    surface !== "wholesale" && !isVariantManaged && product.purchasable;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        aria-label={t("quickView")}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        className="relative z-10 inline-flex size-8 items-center justify-center rounded-full bg-store-surface/90 text-store-foreground shadow-sm backdrop-blur-xs transition-colors hover:bg-store-surface"
      >
        <Eye className="size-4" aria-hidden="true" />
      </button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-start">
            <bdi>{product.name}</bdi>
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[6rem_1fr] gap-4 sm:grid-cols-[8rem_1fr]">
          <div className="relative size-24 shrink-0 overflow-hidden rounded-store bg-store-surface-muted sm:size-32">
            <ProductImage
              src={product.thumbnail_url || null}
              alt={product.name}
              fill
              className="object-cover"
              sizes="128px"
              iconClassName="w-8 h-8"
            />
          </div>

          <div className="min-w-0">
            {product.categories?.[0]?.name && (
              <p className="text-xs font-medium text-store-muted-foreground">
                {product.categories[0].name}
              </p>
            )}
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              {displayPrice ? (
                <span className="text-lg font-black text-store-primary">
                  <bdi>{displayPrice}</bdi>
                </span>
              ) : (
                <span className="text-sm font-medium text-store-muted-foreground">
                  {t("pricedByOption")}
                </span>
              )}
              {onSale && strikethroughPrice && (
                <span className="text-sm text-store-muted-foreground line-through">
                  <bdi>{strikethroughPrice}</bdi>
                </span>
              )}
            </div>
            {!product.purchasable && (
              <p className="mt-1 text-xs font-medium text-store-destructive">
                {t("outOfStock")}
              </p>
            )}
          </div>
        </div>

        {canQuickAdd ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <QuantityPickerField
              quantity={quantity}
              onQuantityChange={setQuantity}
            />
            <button
              type="button"
              disabled={adding}
              className="inline-flex h-10 min-w-32 flex-1 items-center justify-center gap-1.5 rounded-store bg-store-primary px-4 text-sm font-bold text-store-primary-foreground transition-colors hover:bg-store-primary-hover disabled:opacity-60"
              onClick={async () => {
                if (adding) return;
                setAdding(true);
                try {
                  await addItem(product.id, quantity, "base", null);
                  setOpen(false);
                } catch {
                  // CartContext surfaces its own error toast.
                } finally {
                  setAdding(false);
                }
              }}
            >
              {adding ? (
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
              ) : (
                <ShoppingBag className="size-4" aria-hidden="true" />
              )}
              {adding ? t("adding") : t("addToCart")}
            </button>
          </div>
        ) : (
          <Link
            href={productHref}
            onClick={() => setOpen(false)}
            className="mt-4 block rounded-store bg-store-primary px-4 py-2.5 text-center text-sm font-bold text-store-primary-foreground transition-colors hover:bg-store-primary-hover"
          >
            {isVariantManaged ? t("selectOptions") : t("viewFullDetails")}
          </Link>
        )}
      </DialogContent>
    </Dialog>
  );
}
