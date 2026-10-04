import { getLocale } from "next-intl/server";
import { storefrontFetch } from "./config";
import { formatMoney, toRenderableMediaUrl } from "./mappers";
import type { AwjMoney, AwjOffer } from "./types";

/**
 * CUST-H4-7 — the public Offers read (`GET /store/v1/offers`).
 *
 * Host-resolved exactly like every other `store/v1` read: no storefront or
 * tenant id is ever sent, and nothing here can select one. The response holds
 * only LIVE offers (active, in window, discounted, sellable — decided by the
 * backend's `StorefrontOfferResolver`), so this client never filters on
 * liveness, never re-derives a discount and never calls a pricing endpoint.
 *
 * Returns offers in **whatever order the API answers in** (its own
 * `position, created_at, id`). That order is NOT the display order: the
 * merchant's stored `offerIds` is, and `OffersShelf` restores it. A row that
 * is not a well-formed live offer is dropped rather than patched up — never a
 * placeholder price.
 */

export interface OfferMoney {
  amountMinor: number;
  currency: string;
  /** Existing storefront currency formatting (`formatMoney`), display only. */
  display: string;
}

export interface Offer {
  /** `storefront_offers.id` — the key `OffersContent.offerIds` references. */
  id: string;
  productId: string;
  name: string;
  thumbnailUrl: string | null;
  referencePrice: OfferMoney;
  offerPrice: OfferMoney;
  /** Backend-derived integer percent, shown verbatim. May be `0`. */
  discountPercent: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toMoney(raw: unknown): OfferMoney | null {
  if (!isRecord(raw)) return null;
  const { amount_minor: amount, currency } = raw as Partial<AwjMoney>;
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  if (typeof currency !== "string" || currency === "") return null;
  return {
    amountMinor: amount,
    currency,
    display: formatMoney(amount, currency),
  };
}

export function mapAwjOffer(raw: unknown, locale?: string): Offer | null {
  if (!isRecord(raw)) return null;
  const row = raw as Partial<AwjOffer>;
  if (typeof row.id !== "string" || row.id === "") return null;
  if (typeof row.product_id !== "string" || row.product_id === "") return null;
  if (typeof row.name !== "string" || row.name.trim() === "") return null;
  const referencePrice = toMoney(row.reference_price);
  const offerPrice = toMoney(row.offer_price);
  if (referencePrice === null || offerPrice === null) return null;
  if (
    typeof row.discount_percent !== "number" ||
    !Number.isFinite(row.discount_percent)
  ) {
    return null;
  }
  const isEnglish = locale?.toLowerCase().startsWith("en") ?? false;
  return {
    id: row.id,
    productId: row.product_id,
    name: isEnglish && row.name_en ? row.name_en : row.name,
    thumbnailUrl: toRenderableMediaUrl(
      typeof row.thumbnail_url === "string" ? row.thumbnail_url : null,
    ),
    referencePrice,
    offerPrice,
    discountPercent: row.discount_percent,
  };
}

export async function fetchOffers(): Promise<Offer[]> {
  const response = await storefrontFetch<{ data?: unknown }>("offers");
  if (!Array.isArray(response.data)) return [];
  const locale = await getLocale();
  const offers: Offer[] = [];
  for (const row of response.data) {
    const offer = mapAwjOffer(row, locale);
    if (offer !== null) offers.push(offer);
  }
  return offers;
}
