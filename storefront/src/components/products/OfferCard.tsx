"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePublishedProductCard } from "@/components/layout/PublishedCardStyle";
import { ProductImage } from "@/components/ui/product-image";
import type { Offer } from "@/lib/commerce/offers";
import { publishedProductCardBodyClass } from "@/lib/presentation/public-rhythm";

interface OfferCardProps {
  offer: Offer;
  basePath?: string;
}

/**
 * CUST-H4-7 — a published Offers card: name, current offer price, base price
 * and the discount badge, all straight from the backend (`Offer`). Nothing is
 * derived here: no savings amount, no alternative percentage, no invented
 * "was" price, no promotional copy. A `0` percent (a genuine sub-half-percent
 * discount) draws no badge — "0% off" would be a misleading claim — while both
 * prices stay visible.
 *
 * Link-only by design: the card sends the shopper to the product page (a
 * product's slug is its id, see `mappers.ts`) where options, availability and
 * the add-to-cart action live. It deliberately adds nothing to the cart and
 * reads no pricing, so Offers can never become a second pricing path.
 *
 * Copy comes from `useTranslations("home")` inside this client component, like
 * `ProductCard` does: the shelf is a server component, and a function (e.g. a
 * badge formatter) can never be passed to a client component as a prop.
 *
 * Visual language reuses `ProductCard`'s container, image frame and body
 * rhythm so an Offers shelf reads as part of the same catalogue.
 */
export function OfferCard({ offer, basePath = "" }: OfferCardProps) {
  const t = useTranslations("home");
  const cardStyle = usePublishedProductCard();
  const showBadge = offer.discountPercent > 0;

  return (
    <div
      data-offer-card=""
      className="group relative flex h-full min-w-0 flex-col overflow-hidden rounded-store border border-store-border bg-store-surface transition-shadow duration-150 hover:shadow-md focus-within:shadow-md motion-reduce:transition-none"
    >
      <div className="relative h-36 shrink-0 bg-store-surface-muted sm:h-44 md:h-52">
        {/* Decorative: the product name directly below is the accessible name. */}
        <ProductImage
          src={offer.thumbnailUrl}
          alt=""
          fill
          className="object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 260px"
          iconClassName="w-10 h-10"
        />
        {showBadge && (
          <span
            data-offer-badge=""
            className="absolute start-2 top-2 z-10 rounded-md bg-store-foreground px-2 py-0.5 text-[0.625rem] font-bold text-store-surface"
          >
            {t("offerDiscount", { percent: offer.discountPercent })}
          </span>
        )}
      </div>

      <div
        data-card-body=""
        className={publishedProductCardBodyClass(cardStyle)}
      >
        <h3 className="line-clamp-2 break-words text-xs font-bold leading-snug text-store-foreground transition-colors group-hover:text-store-primary sm:text-sm">
          {/* Stretched link keeps the whole card clickable without nesting
              interactive content inside an anchor. */}
          <Link
            href={`${basePath}/products/${offer.productId}`}
            className="after:absolute after:inset-0"
          >
            {offer.name}
          </Link>
        </h3>

        <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-sm font-black text-store-primary md:text-base">
            <span className="sr-only">{t("offerPrice")}: </span>
            <bdi data-offer-price="">{offer.offerPrice.display}</bdi>
          </span>
          <span className="text-xs text-store-muted-foreground line-through">
            <span className="sr-only">{t("offerReferencePrice")}: </span>
            <bdi data-offer-reference="">{offer.referencePrice.display}</bdi>
          </span>
        </p>
      </div>
    </div>
  );
}
