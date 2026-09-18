"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { QuantityPickerField } from "@/components/cart/QuantityPickerField";
import { Button } from "@/components/ui/button";
import { ProductImage } from "@/components/ui/product-image";
import {
  formatMinorAmount,
  type StorefrontCartLine,
} from "@/lib/commerce/cart-types";
import type { StorefrontOrder } from "@/lib/commerce/checkout-types";
import { cn } from "@/lib/utils";

/**
 * The one cart line in the storefront.
 *
 * Every surface that lists what is in a cart or an order renders this: the cart
 * page, the cart drawer, the checkout's read-only item review, and the order
 * confirmation. A density is a prop, not a second component — a line that
 * looked different in the drawer than on the page would be two designs of the
 * same object, and the drawer's job is to be a view of the cart, not another
 * cart.
 *
 * ## Why it takes a pre-formatted view
 *
 * Three different authorities produce lines: the AWJ cart (`StorefrontCartLine`),
 * the AWJ order (`StorefrontOrder["items"]`), and Spree's `LineItem` on the
 * wholesale surface. Each already carries its own authoritative money — AWJ as
 * `amount_minor`, Spree as a server-rendered `display_price`. `CartLineView`
 * takes the money as a **string the caller already resolved from its own
 * server response**, so this component never multiplies, sums, converts or
 * re-derives an amount, and one design serves all three without learning three
 * pricing models. The adapters below do the mapping; nothing else may.
 *
 * ## What it may not say
 *
 * An unavailable line shows no money at all. `CommerceCartService::serialize()`
 * zeroes both `unit_price` and `line_total` for a line it could not resolve
 * (product deleted, unpublished, deactivated, UOM invalid, price unresolved),
 * so printing them would put "٠٫٠٠ ر.س." beside a product as though it were
 * free. The line keeps its name, its quantity and its remove button — the one
 * mutation the backend still allows it — and says plainly that it is
 * unavailable.
 */

export type CartLineDensity = "page" | "drawer" | "summary";

/** The display-ready shape every cart surface renders. See the module doc. */
export interface CartLineView {
  id: string;
  name: string;
  /** Product page link, or `null` when there is nothing resolvable to link to. */
  href: string | null;
  imageUrl: string | null;
  /** Secondary descriptors: variant, unit, Spree option text. Empty entries are dropped. */
  meta: Array<string | null | undefined>;
  quantity: number;
  available: boolean;
  /** Already formatted by the caller from its own server response. */
  unitPriceLabel: string | null;
  lineTotalLabel: string | null;
  /** Strikethrough original, where the caller's authority provides one. */
  compareAtLabel?: string | null;
}

interface CartLineProps {
  view: CartLineView;
  density?: CartLineDensity;
  /** Omitted on the read-only `summary` density. */
  onQuantityChange?: (quantity: number) => void;
  onRemove?: () => void;
  onNavigate?: () => void;
  disabled?: boolean;
}

const MEDIA_SIZE: Record<CartLineDensity, string> = {
  page: "size-20 sm:size-24",
  drawer: "size-16",
  summary: "size-12",
};

const MEDIA_SIZES_ATTR: Record<CartLineDensity, string> = {
  page: "96px",
  drawer: "64px",
  summary: "48px",
};

export function CartLine({
  view,
  density = "page",
  onQuantityChange,
  onRemove,
  onNavigate,
  disabled = false,
}: CartLineProps) {
  const t = useTranslations("cart");
  const tc = useTranslations("common");

  const readOnly = density === "summary";
  const unavailable = !view.available;
  const meta = view.meta.filter((entry): entry is string => Boolean(entry));

  const name = (
    <span
      className={cn(
        "font-semibold leading-snug",
        density === "page" ? "text-sm sm:text-base" : "text-sm",
        unavailable ? "text-store-muted-foreground" : "text-store-foreground",
        density === "summary" ? "line-clamp-1" : "line-clamp-2",
      )}
    >
      {view.name}
    </span>
  );

  return (
    <div
      className={cn(
        "flex gap-3 sm:gap-4",
        density === "page" && "py-4",
        density === "drawer" && "py-4",
        density === "summary" && "py-3",
      )}
      data-testid="cart-line"
      data-available={view.available ? "true" : "false"}
    >
      <div
        className={cn(
          "relative shrink-0 overflow-hidden rounded-store border border-store-border bg-store-surface-muted",
          MEDIA_SIZE[density],
          unavailable && "opacity-50 grayscale",
        )}
      >
        <ProductImage
          src={view.imageUrl}
          alt={view.name}
          fill
          className="object-cover"
          sizes={MEDIA_SIZES_ATTR[density]}
          iconClassName={density === "summary" ? "w-4 h-4" : "w-6 h-6"}
        />
        {readOnly && (
          <span className="absolute bottom-0 end-0 rounded-ss-md bg-store-foreground/85 px-1.5 text-[0.625rem] font-bold text-store-surface tabular-nums">
            ×{view.quantity}
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {view.href ? (
              <Link
                href={view.href}
                onClick={onNavigate}
                className="rounded-sm outline-none transition-colors hover:text-store-primary focus-visible:ring-2 focus-visible:ring-store-primary"
              >
                {name}
              </Link>
            ) : (
              name
            )}
            {meta.length > 0 && (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-store-muted-foreground">
                {meta.map((entry, index) => (
                  <span key={entry}>
                    {index > 0 && (
                      <span aria-hidden="true" className="me-2 opacity-50">
                        ·
                      </span>
                    )}
                    {entry}
                  </span>
                ))}
              </p>
            )}
          </div>

          {!readOnly && onRemove && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="-me-1 shrink-0 text-store-muted-foreground hover:text-store-destructive"
              onClick={onRemove}
              disabled={disabled}
              aria-label={t("removeItemLabel", { name: view.name })}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>

        {unavailable && (
          <p className="mt-1.5 inline-flex w-fit items-center rounded-md bg-store-destructive/10 px-2 py-0.5 text-xs font-medium text-store-destructive">
            {t("itemUnavailable")}
          </p>
        )}

        {/* The per-unit figure, shown only where it adds information: at a
            quantity of one it would just repeat the line total. */}
        {!readOnly &&
          !unavailable &&
          view.unitPriceLabel &&
          view.quantity > 1 && (
            <p className="mt-1 text-xs text-store-muted-foreground tabular-nums">
              <bdi>{view.unitPriceLabel}</bdi>
              <span aria-hidden="true"> × {view.quantity}</span>
            </p>
          )}

        <div className="mt-3 flex items-center justify-between gap-3">
          {readOnly ? (
            <span className="text-xs text-store-muted-foreground tabular-nums">
              {!unavailable && view.unitPriceLabel && (
                <bdi>{view.unitPriceLabel}</bdi>
              )}
            </span>
          ) : (
            <QuantityPickerField
              quantity={view.quantity}
              onQuantityChange={(quantity) => onQuantityChange?.(quantity)}
              disabled={disabled || unavailable}
              size="sm"
            />
          )}

          {unavailable || !view.lineTotalLabel ? (
            <span className="text-sm text-store-muted-foreground">
              {tc("notAvailable")}
            </span>
          ) : (
            <span
              className={cn(
                "flex items-baseline gap-2 whitespace-nowrap font-bold tabular-nums text-store-foreground",
                density === "page" ? "text-base" : "text-sm",
              )}
            >
              {view.compareAtLabel && (
                <bdi className="text-xs font-normal text-store-muted-foreground line-through">
                  {view.compareAtLabel}
                </bdi>
              )}
              <bdi>{view.lineTotalLabel}</bdi>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * AWJ cart line → view. `lineTotal` is the backend's own figure, never
 * `unitPrice × quantity` recomputed here.
 */
export function awjCartLineView(
  line: StorefrontCartLine,
  basePath: string,
  imageUrl: string | null | undefined,
): CartLineView {
  return {
    id: line.id,
    name: line.name,
    // `mapAwjProductToViewModel` sets `slug` to the product id, so the id is
    // the product route's own key — not a synthesised link.
    href:
      line.productId && line.available
        ? `${basePath}/products/${line.productId}`
        : null,
    imageUrl: imageUrl ?? null,
    meta: [line.variantDescriptor, line.unitName],
    quantity: line.quantity,
    available: line.available,
    unitPriceLabel: line.available ? formatMinorAmount(line.unitPrice) : null,
    lineTotalLabel: line.available ? formatMinorAmount(line.lineTotal) : null,
  };
}

/** AWJ order line → view. Orders are immutable, so these are always `summary`. */
export function awjOrderLineView(
  item: StorefrontOrder["items"][number],
  index: number,
  basePath: string,
  imageUrl: string | null | undefined,
): CartLineView {
  return {
    id: `${item.productId ?? "item"}-${index}`,
    name: item.productName,
    href: item.productId ? `${basePath}/products/${item.productId}` : null,
    imageUrl: imageUrl ?? null,
    meta: [item.unitName],
    quantity: item.quantity,
    available: true,
    unitPriceLabel: formatMinorAmount(item.unitPrice),
    lineTotalLabel: formatMinorAmount(item.lineTotal),
  };
}
