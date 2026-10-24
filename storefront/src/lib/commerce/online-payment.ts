/**
 * AWJ Store online payment client (PAY-H4-04a) — the only module that calls
 * `store/v1/checkout/payment-intent` and `store/v1/orders/{order}/payment-status`.
 *
 * Same trust-boundary transport as the checkout client. Three rules this file
 * exists to keep:
 *
 * 1. **The server is the only source of truth for "paid".** A browser landing
 *    back from the provider proves nothing; `fetchAwjOnlinePaymentStatus()`
 *    asks the API, which asks the provider. Nothing in the storefront ever
 *    infers a payment outcome from a URL, a query string or local state.
 * 2. **No amount, provider, gateway, card field or return URL is ever sent.**
 *    The request body is the order id and nothing else; the amount, currency,
 *    gateway and return address are all decided by the server.
 * 3. **Ownership is the signed order reference** (`X-Order-Reference`), issued
 *    once when the order was placed. A wrong/missing reference is a uniform
 *    404 — the shopper can never learn whether an order id exists.
 */

import type { AwjMoney } from "./checkout-types";
import { storefrontCartRequest } from "./config";
import type { AwjResourceResponse } from "./types";

export const ORDER_REFERENCE_HEADER = "X-Order-Reference";

/** Everything the API can report for an online order's payment — a closed set, mirrored from the server. */
export const AWJ_ONLINE_PAYMENT_STATUSES = [
  "awaiting_payment",
  "pending",
  "paid",
  "failed",
  "expired",
  "cancelled",
  "under_review",
] as const;
export type AwjOnlinePaymentStatus =
  (typeof AWJ_ONLINE_PAYMENT_STATUSES)[number];

/** The `payment` object exactly as the API sends it. */
export interface AwjOnlinePayment {
  status: AwjOnlinePaymentStatus;
  can_retry: boolean;
  amount: AwjMoney;
  paid_at: string | null;
  expires_at: string | null;
  /** The provider's hosted payment page — set only while a live attempt exists. */
  checkout_url: string | null;
}

/** A 200 without a well-formed `payment` is an API fault, never a verdict — it must not reach the UI as one. */
function asPayment(value: unknown): AwjOnlinePayment {
  const payment = value as Partial<AwjOnlinePayment> | null | undefined;
  if (
    !payment ||
    typeof payment !== "object" ||
    !(AWJ_ONLINE_PAYMENT_STATUSES as readonly string[]).includes(
      payment.status as string,
    ) ||
    typeof payment.amount?.amount_minor !== "number"
  ) {
    throw new Error("Malformed payment response");
  }
  return payment as AwjOnlinePayment;
}

function withReference(reference: string): Record<string, string> {
  return { [ORDER_REFERENCE_HEADER]: reference };
}

/**
 * Starts the payment for an online order — or resumes the live one (the API
 * returns the same attempt, never a second charge). The order id is the only
 * field in the body.
 */
export async function startAwjOnlinePayment(
  orderId: string,
  orderReference: string,
): Promise<AwjOnlinePayment> {
  const response = await storefrontCartRequest<
    AwjResourceResponse<{ payment: AwjOnlinePayment }>
  >(
    "POST",
    "checkout/payment-intent",
    { order_id: orderId },
    withReference(orderReference),
  );
  return asPayment(response.data.payment);
}

/** The server's current verdict on the order's payment (it asks the provider when needed). */
export async function fetchAwjOnlinePaymentStatus(
  orderId: string,
  orderReference: string,
): Promise<AwjOnlinePayment> {
  const response = await storefrontCartRequest<
    AwjResourceResponse<{ payment: AwjOnlinePayment }>
  >(
    "GET",
    `orders/${encodeURIComponent(orderId)}/payment-status`,
    undefined,
    withReference(orderReference),
  );
  return asPayment(response.data.payment);
}
