/**
 * COPS-H2-5 — guest order tracking client. The only module that calls `store/v1/order-tracking/{token}` and
 * `store/v1/orders/{order}/tracking-link`.
 *
 * Rules this file keeps:
 * 1. The tracking **token is the only credential** for the page and it is *not* the order reference: it grants a narrow,
 *    read-only projection (order number, public status, placed date, delivery method, schedule, fulfilment progress). Nothing
 *    here can start a payment or read the order's contents.
 * 2. Every failure of the read is a uniform 404 from the API — this client reduces it to `not_found` and reveals nothing more.
 * 3. Defensive mapping: an unreadable payload yields `null`, never invented progress.
 */

import {
  type AwjOrderFulfillment,
  mapOrderFulfillment,
  type StorefrontFulfillment,
} from "./checkout-types";
import {
  storefrontCartRequest,
  storefrontFetch,
} from "./config";
import { ORDER_REFERENCE_HEADER } from "./online-payment";
import type { AwjResourceResponse } from "./types";

/** The projection exactly as the API sends it. */
export interface AwjOrderTracking {
  number: string;
  status: string;
  delivery_method: string | null;
  placed_at: string | null;
  cancellation?: { cancelled_at: string | null };
  schedule?: {
    method?: string;
    date?: string;
    slot?: { label?: string | null; label_en?: string | null; start_time?: string; end_time?: string };
    timezone?: string;
  };
  fulfillment?: AwjOrderFulfillment;
  expires_at: string | null;
}

export interface StorefrontOrderTracking {
  number: string;
  status: string;
  deliveryMethod: string | null;
  placedAt: string | null;
  cancelledAt: string | null;
  schedule: { date: string; label: string | null; labelEn: string | null; start: string | null; end: string | null } | null;
  fulfillment: StorefrontFulfillment | null;
  expiresAt: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

export function mapOrderTracking(raw: unknown): StorefrontOrderTracking | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Partial<AwjOrderTracking>;
  const number = str(t.number);
  const status = str(t.status);
  if (!number || !status) return null;

  const slot = t.schedule?.slot;
  const date = str(t.schedule?.date);

  return {
    number,
    status,
    deliveryMethod: str(t.delivery_method),
    placedAt: str(t.placed_at),
    cancelledAt: status === "cancelled" ? str(t.cancellation?.cancelled_at) : null,
    schedule: date
      ? {
          date,
          label: str(slot?.label),
          labelEn: str(slot?.label_en),
          start: str(slot?.start_time),
          end: str(slot?.end_time),
        }
      : null,
    // A cancelled order never shows progress (the API omits the block; this also guards a stale payload).
    fulfillment: status === "cancelled" ? null : mapOrderFulfillment(t.fulfillment),
    expiresAt: str(t.expires_at),
  };
}

/** `GET store/v1/order-tracking/{token}` — never cached (a tracking page is per-visitor and live). */
export async function fetchAwjOrderTracking(token: string): Promise<StorefrontOrderTracking> {
  const response = await storefrontFetch<AwjResourceResponse<{ tracking: unknown }>>(
    `order-tracking/${encodeURIComponent(token)}`,
    undefined,
    { cache: "no-store" },
  );
  const mapped = mapOrderTracking(response.data.tracking);
  if (!mapped) throw new Error("Malformed tracking response");
  return mapped;
}

/** `POST store/v1/orders/{order}/tracking-link` — needs the signed order reference; returns the guest token. */
export async function issueAwjTrackingLink(
  orderId: string,
  orderReference: string,
): Promise<{ token: string; expiresAt: string | null }> {
  const response = await storefrontCartRequest<
    AwjResourceResponse<{ token: string; expires_at: string | null }>
  >(
    "POST",
    `orders/${encodeURIComponent(orderId)}/tracking-link`,
    undefined,
    { [ORDER_REFERENCE_HEADER]: orderReference },
  );
  const token = response.data.token;
  if (typeof token !== "string" || !token.startsWith("trk1.")) {
    throw new Error("Malformed tracking-link response");
  }
  return { token, expiresAt: str(response.data.expires_at) };
}
