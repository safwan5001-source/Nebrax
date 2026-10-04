import type { WorkspaceOffer } from "@/modules/commerce-workspace/workspace-offers";
import type { CustomizerLocale, CustomizerMessageKey } from "./messages";
import {
  formatOfferMoney,
  isDiscountBadgeVisible,
  offerDiscountBadgeText,
  offerDisplayName,
  offerReasonMessageKey,
} from "./offers-display";

/**
 * CUST-H4-7 — shared presentational pieces for an Offer row (used by the
 * selection list and the configured-offers catalog). Display only: every
 * value is what the server evaluated; nothing is derived here.
 */
export function OfferSummary({
  offer,
  t,
  locale,
}: {
  offer: WorkspaceOffer;
  t: (key: CustomizerMessageKey) => string;
  locale: CustomizerLocale;
}) {
  const name = offerDisplayName(offer, locale);
  return (
    <span className="relative flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="line-clamp-2 break-words text-sm">
        <bdi>{name ?? t("offersUnavailable")}</bdi>
      </span>
      {offer.isLive ? (
        <span data-offer-status="live" className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
          <span className="font-medium text-text">
            <span aria-hidden="true">✓ </span>
            {t("offersStatusLive")}
          </span>
          {offer.offerPrice ? (
            <span>
              <span className="sr-only">{t("offersOfferPrice")}: </span>
              <bdi className="font-semibold text-text">{formatOfferMoney(offer.offerPrice, locale)}</bdi>
            </span>
          ) : null}
          {offer.referencePrice ? (
            <span className="text-muted line-through">
              <span className="sr-only">{t("offersReferencePrice")}: </span>
              <bdi>{formatOfferMoney(offer.referencePrice, locale)}</bdi>
            </span>
          ) : null}
          {isDiscountBadgeVisible(offer.discountPercent) ? (
            <span className="rounded-sm bg-primary-soft px-1.5 py-px text-[11px] font-semibold text-primary">
              <bdi>{offerDiscountBadgeText(offer.discountPercent, locale)}</bdi>
            </span>
          ) : null}
        </span>
      ) : (
        <span data-offer-status="hidden" className="text-xs text-muted">
          <span className="font-medium text-text">
            <span aria-hidden="true">○ </span>
            {t("offersStatusHidden")}
          </span>
          {" — "}
          {t("offersNotShownBecause")} {t(offerReasonMessageKey(offer.reason))}
        </span>
      )}
    </span>
  );
}

export function OfferThumb({ offer }: { offer: WorkspaceOffer | undefined }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center self-start overflow-hidden rounded-md bg-surface-muted">
      {offer?.product?.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- thumbnail is an untrusted tenant media URL, not a static asset
        <img src={offer.product.thumbnailUrl} alt="" className="size-full object-cover" />
      ) : null}
    </span>
  );
}

