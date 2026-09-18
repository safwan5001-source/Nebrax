"use client";

import type { Media, Product, Variant } from "@spree/sdk";
import { CircleCheckBig, CircleX, Loader2, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { QuantityPickerField } from "@/components/cart/QuantityPickerField";
import { StoreContainer } from "@/components/layout/StoreContainer";
import { HiddenPricePrompt } from "@/components/products/HiddenPricePrompt";
import { MediaGallery } from "@/components/products/MediaGallery";
import { ProductCustomFields } from "@/components/products/ProductCustomFields";
import { VariantPicker } from "@/components/products/VariantPicker";
import { Button } from "@/components/ui/button";
import { useCart } from "@/contexts/CartContext";
import { useHiddenPricing } from "@/contexts/HiddenPricingContext";
import { useStore } from "@/contexts/StoreContext";
import { trackAddToCart, trackViewItem } from "@/lib/analytics/gtm";

interface ProductDetailsProps {
  product: Product;
  basePath: string;
}

export function ProductDetails({ product, basePath }: ProductDetailsProps) {
  const { addItem, surface } = useCart();
  const { currency } = useStore();
  const t = useTranslations("products");
  const tw = useTranslations("wholesale");
  // Non-null inside a HiddenPricingProvider (wholesale `prices_hidden`, guest
  // view): prices are null on purpose, and ordering is gated behind sign-in.
  const hiddenPricing = useHiddenPricing();
  const pricesHidden = hiddenPricing !== null;

  // Filter variants list
  const variants = useMemo(() => {
    return (product.variants || []).filter(Boolean);
  }, [product.variants]);

  const hasVariants = variants.length > 0;
  const optionTypes = product.option_types || [];
  /*
   * AWJ's own flag, not a count. A variant-managed product with every variant
   * deactivated still must not be purchasable through its parent, and
   * `variants.length > 0` alone would not say so.
   */
  const isVariantManaged =
    (product as { isVariantManaged?: boolean }).isVariantManaged === true;

  // Initialize with default variant or first available variant
  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(() => {
    /*
     * AWJ flags no default variant, so preselecting one would assert a merchant
     * choice that was never made. A variant-managed product therefore starts
     * with nothing selected and nothing purchasable — the shopper picks.
     */
    if (isVariantManaged) return null;
    if (product.default_variant) {
      return product.default_variant;
    }
    if (hasVariants) {
      return variants.find((v) => v.purchasable) || variants[0];
    }
    return product.default_variant || null;
  });

  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);

  // Track product view (analytics - client-only side effect)
  useEffect(() => {
    trackViewItem(product, currency);
  }, [product, currency]);

  /*
   * AWJ gives each variant its own media list, so a selected variant shows its
   * own images rather than the parent's. Spree's `media.variant_ids` route does
   * not apply here — the adapter has no variant ids to put there — so the swap
   * is by list, not by index into a merged gallery. A variant with no media of
   * its own falls back to the product's.
   */
  const galleryImages = useMemo((): Media[] => {
    const variantMedia = selectedVariant?.media ?? [];
    if (variantMedia.length > 0) return variantMedia;
    return product.media || [];
  }, [selectedVariant, product.media]);

  const variantImageIndex = useMemo((): number | null => {
    if (!selectedVariant) return null;
    const index = galleryImages.findIndex((m) =>
      m.variant_ids.includes(selectedVariant.id),
    );
    return index >= 0 ? index : null;
  }, [selectedVariant, galleryImages]);

  /*
   * `description_html` is null on the AWJ adapter now: the API's `description`
   * is a plain text column and was being piped into `dangerouslySetInnerHTML`.
   * The wholesale/Spree surface still supplies real authored HTML, so that
   * branch is kept for it.
   */
  const descriptionText = product.description;

  const price = selectedVariant?.price ?? product.price;
  const originalPrice =
    selectedVariant?.original_price ?? product.original_price;
  const displayPrice = price?.display_amount;

  const currentAmountCents = price?.amount_in_cents;
  const originalAmountCents = originalPrice?.amount_in_cents;
  const compareAtAmountCents = price?.compare_at_amount_in_cents;
  const onSale =
    (currentAmountCents != null &&
      originalAmountCents != null &&
      currentAmountCents < originalAmountCents) ||
    (compareAtAmountCents != null &&
      currentAmountCents != null &&
      currentAmountCents < compareAtAmountCents);

  const strikethroughPrice = onSale
    ? ((originalPrice?.display_amount &&
      originalPrice.display_amount !== displayPrice
        ? originalPrice.display_amount
        : price?.display_compare_at_amount) ?? null)
    : null;

  const sku = selectedVariant?.sku ?? product.default_variant?.sku;

  // Purchasability
  const isPurchasable = isVariantManaged
    ? // Nothing is purchasable until a real variant is resolved, and then only
      // on that variant's own server-supplied availability.
      (selectedVariant?.purchasable ?? false)
    : hasVariants
      ? (selectedVariant?.purchasable ?? false)
      : (product.purchasable ?? false);

  const inStock = hasVariants
    ? (selectedVariant?.in_stock ?? false)
    : (product.in_stock ?? false);

  const handleAddToCart = async () => {
    /*
     * The wholesale surface runs on real Spree variants — pass its own variant
     * id unchanged.
     *
     * The DTC surface is AWJ Cart V1, which takes a product id AND an optional
     * `product_variant_id`. A simple product sends only the product: its
     * `${product.id}-default` variant is synthetic and would never resolve.
     * A variant-managed product must send the variant the shopper actually
     * chose — the parent has no sellable identity, and sending it added the
     * wrong thing.
     */
    if (surface !== "wholesale") {
      const awjVariantId = isVariantManaged ? selectedVariant?.id : null;
      // Guarded by the disabled button below; this is the last line of defence
      // so a mis-wired caller cannot post a parent id for a variant product.
      if (isVariantManaged && !awjVariantId) return;

      setLoading(true);
      await addItem(product.id, quantity, "base", awjVariantId);
      setLoading(false);
      trackAddToCart(product, selectedVariant, quantity, currency);
      return;
    }

    const variantId =
      selectedVariant?.id ||
      product.default_variant?.id ||
      product.default_variant_id;
    if (!variantId) {
      throw new Error("No variant selected");
    }

    setLoading(true);
    await addItem(variantId, quantity);
    setLoading(false);
    trackAddToCart(product, selectedVariant, quantity, currency);
  };

  const needsOptionChoice = isVariantManaged && selectedVariant === null;

  return (
    <StoreContainer className="py-5 md:py-6">
      {/* The product leads. No marketing band above it. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)] lg:gap-10">
        {/*
          The gallery is capped rather than left to fill its track. It is a
          square, so an uncapped column made it ~880px tall at 1440 and pushed
          the price and the purchase action below the fold — the opposite of
          product-first.
        */}
        <div className="w-full lg:sticky lg:top-(--store-header-offset) lg:self-start">
          <MediaGallery
            images={galleryImages}
            productName={product.name}
            activeIndex={variantImageIndex}
          />
        </div>

        <div className="min-w-0 lg:max-w-2xl">
          {product.categories?.[0]?.name && (
            <p className="mb-1 text-xs font-medium text-store-muted-foreground">
              {product.categories[0].name}
            </p>
          )}

          <h1 className="text-lg font-extrabold leading-snug text-store-foreground md:text-xl">
            {product.name}
          </h1>

          <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {displayPrice ? (
              <span className="text-xl font-black text-store-primary md:text-2xl">
                {/*
                  For a variant-managed product with nothing selected yet, the
                  figure the API sends is its cheapest active variant — stating
                  it bare would claim it is the price. Once a variant is chosen
                  the figure is that variant's own, and the qualifier goes.
                */}
                {needsOptionChoice ? (
                  <>
                    <span className="me-1 text-sm font-semibold text-store-muted-foreground">
                      {t("priceFromLabel")}
                    </span>
                    {/*
                      Prices are always formatted in Arabic numerals by the
                      adapter, so on the English storefront the qualifier and
                      the figure are opposite directions. Isolating the figure
                      keeps the two from reordering into each other.
                    */}
                    <bdi>{displayPrice}</bdi>
                  </>
                ) : (
                  <bdi>{displayPrice}</bdi>
                )}
              </span>
            ) : needsOptionChoice ? (
              <span className="text-sm font-medium text-store-muted-foreground">
                {t("pricedByOption")}
              </span>
            ) : (
              <HiddenPricePrompt className="inline-flex items-center gap-1.5 text-sm font-medium text-store-foreground underline underline-offset-4 hover:text-store-primary" />
            )}
            {/* Only ever rendered from a real compare-at price the server sent. */}
            {onSale && strikethroughPrice && (
              <span className="text-sm text-store-muted-foreground line-through">
                {strikethroughPrice}
              </span>
            )}
          </div>

          {/*
            Availability is stated only once it means something. For a
            variant-managed product that is after a variant is chosen — before
            then the parent's rolled-up flag would answer a question the shopper
            has not asked yet.
          */}
          {!needsOptionChoice && (
            <p className="mt-2 text-xs font-medium">
              {inStock ? (
                <span className="inline-flex items-center gap-1.5 text-store-success">
                  <CircleCheckBig className="size-4" aria-hidden="true" />
                  {t("inStock")}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-store-destructive">
                  <CircleX className="size-4" aria-hidden="true" />
                  {t("outOfStock")}
                </span>
              )}
            </p>
          )}

          {/* Options: rendered only when the merchant actually defined some. */}
          {hasVariants && optionTypes.length > 0 && (
            <div className="mt-5 border-t border-store-border pt-5">
              <VariantPicker
                variants={variants}
                optionTypes={optionTypes}
                selectedVariant={selectedVariant}
                onVariantChange={setSelectedVariant}
              />
            </div>
          )}

          <div className="mt-5 border-t border-store-border pt-5">
            {pricesHidden ? (
              // Guest on a prices-hidden channel: no pricing, no ordering —
              // route them through the wholesale sign-in first.
              <Button asChild size="lg">
                <Link href={hiddenPricing.signInHref}>
                  {tw("hiddenPrice.signInToOrder")}
                </Link>
              </Button>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <QuantityPickerField
                  quantity={quantity}
                  onQuantityChange={setQuantity}
                  size="lg"
                />

                <Button
                  size="lg"
                  className="min-w-40 flex-1"
                  onClick={handleAddToCart}
                  disabled={loading || !isPurchasable}
                >
                  {loading ? (
                    <>
                      <Loader2 className="size-5 animate-spin motion-reduce:animate-none" />
                      {t("adding")}
                    </>
                  ) : needsOptionChoice ? (
                    t("selectOptions")
                  ) : isPurchasable ? (
                    <>
                      <ShoppingBag className="size-5" />
                      {t("addToCart")}
                    </>
                  ) : (
                    t("outOfStock")
                  )}
                </Button>
              </div>
            )}
          </div>

          {descriptionText && (
            <section className="mt-5 border-t border-store-border pt-5">
              <h2 className="mb-2 text-sm font-bold text-store-foreground">
                {t("description")}
              </h2>
              {/*
                AWJ's description is a plain text column, not authored HTML —
                rendering it through `dangerouslySetInnerHTML` both lost its
                line breaks and treated merchant input as markup.
              */}
              <p className="whitespace-pre-line text-sm leading-relaxed text-store-muted-foreground">
                {descriptionText}
              </p>
            </section>
          )}

          <ProductCustomFields customFields={product.custom_fields} />

          {(sku || selectedVariant?.options_text) && (
            <section className="mt-5 border-t border-store-border pt-5">
              <h2 className="mb-2 text-sm font-bold text-store-foreground">
                {t("details")}
              </h2>
              <dl className="space-y-1.5 text-sm">
                {sku && (
                  <div className="flex gap-3">
                    <dt className="w-28 shrink-0 text-store-muted-foreground">
                      {t("sku")}
                    </dt>
                    <dd className="min-w-0 text-store-foreground">{sku}</dd>
                  </div>
                )}
                {selectedVariant?.options_text && (
                  <div className="flex gap-3">
                    <dt className="w-28 shrink-0 text-store-muted-foreground">
                      {t("options")}
                    </dt>
                    <dd className="min-w-0 text-store-foreground">
                      {selectedVariant.options_text}
                    </dd>
                  </div>
                )}
              </dl>
            </section>
          )}
        </div>
      </div>
    </StoreContainer>
  );
}
