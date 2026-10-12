import { OfferCard } from "@/components/products/OfferCard";
import { fetchOffers } from "@/lib/commerce/offers";
import { type ShelfColumns, shelfGridClass } from "@/lib/home/shelf-layout";

/**
 * CUST-H4-7 — the published "offers" section.
 *
 * One request (`GET /store/v1/offers`, Host-resolved, no id) for the whole
 * shelf regardless of how many Offers sections the page holds or how many ids
 * each selects. The endpoint returns only LIVE offers, in its own database
 * order — which is NOT the display order. The merchant's stored `offerIds`
 * (presentation's own authority over curation and order) is restored here:
 *
 *   public offers → map by offer id → stored `offerIds` order
 *     → omit ids the API did not return (not live / deleted / foreign)
 *     → render what remains
 *
 * No price, discount or liveness is computed or re-checked client-side, and a
 * missing id leaves no placeholder. If nothing remains — including a failed
 * request, treated like every other optional section's "no data" — the section
 * is omitted entirely (`return null`), never an empty heading.
 */
export async function OffersShelf({
  offerIds,
  basePath,
  title,
  headingId,
  columns,
  hideTitle = false,
}: {
  offerIds: readonly string[];
  basePath: string;
  title: string;
  headingId: string;
  /** CUST-HV V9d-2 — the section design's `columns`; absent = today's. Offers have no rail. */
  columns?: ShelfColumns;
  /** CUST-HV V9d-3 — the merchant hid the title: it stays as the section's accessible name, visually hidden. */
  hideTitle?: boolean;
}) {
  const live = await fetchOffers().catch((error) => {
    console.error("OffersShelf: failed to load offers", error);
    return [];
  });
  const byId = new Map(live.map((offer) => [offer.id, offer]));
  const offers = offerIds
    .map((id) => byId.get(id))
    .filter((offer): offer is NonNullable<typeof offer> => offer !== undefined);
  if (offers.length === 0) return null;

  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className={
          hideTitle
            ? "sr-only"
            : "text-base font-extrabold text-store-foreground md:text-lg"
        }
      >
        {title}
      </h2>
      <ul className={`mt-4 grid gap-3 md:gap-5 ${shelfGridClass(columns)}`}>
        {offers.map((offer) => (
          <li key={offer.id} className="min-w-0">
            <OfferCard offer={offer} basePath={basePath} />
          </li>
        ))}
      </ul>
    </section>
  );
}
