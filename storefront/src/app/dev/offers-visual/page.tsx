import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { OffersShelf } from "@/components/home/OffersShelf";
import { PublishedCardStyleProvider } from "@/components/layout/PublishedCardStyle";
import { PublishedThemeMarkerProvider } from "@/components/layout/PublishedThemeMarker";
import { StoreContainer } from "@/components/layout/StoreContainer";
import { publishedHomeStackClass } from "@/lib/presentation/public-rhythm";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";
import { MarketVisualFrame } from "../market-visual/frame";

/**
 * CUST-H4-7 — development-only visual fixture for the published Offers shelf.
 * Mounts the REAL async `OffersShelf` + `OfferCard`, reading the REAL
 * `fetchOffers()` against whatever `AWJ_COMMERCE_API_URL` points at (a local
 * stub of `GET /store/v1/offers` during visual QA — see the H4-7 report). Not
 * linked from the storefront and 404 in production.
 *
 * `?ids=a,b,c` is the stored `offerIds` (merchant order); `?locale=ar|en`;
 * `?card=compact|standard`; Any id the stub does not
 * return is omitted exactly as in production.
 */
export default async function OffersVisualPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string; locale?: string; card?: string }>;
}) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const params = await searchParams;
  const locale = params.locale === "en" ? "en" : "ar";
  const productCard = params.card === "compact" ? "compact" : "standard";
  const offerIds = (params.ids ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  setRequestLocale(locale);

  const copy = (locale === "ar" ? ar : en).home;

  return (
    <div
      dir={locale === "ar" ? "rtl" : "ltr"}
      lang={locale}
      data-visual-root=""
      data-surface="offers-visual"
    >
      <MarketVisualFrame locale={locale} messages={locale === "ar" ? ar : en}>
        <PublishedThemeMarkerProvider themePreset="awj-modern">
          <PublishedCardStyleProvider productCard={productCard}>
            <StoreContainer className={publishedHomeStackClass("comfortable")}>
              <OffersShelf
                offerIds={offerIds}
                basePath={locale === "ar" ? "/sa/ar" : "/sa/en"}
                title={copy.offers}
                headingId="offers-visual"
              />
            </StoreContainer>
          </PublishedCardStyleProvider>
        </PublishedThemeMarkerProvider>
      </MarketVisualFrame>
    </div>
  );
}
