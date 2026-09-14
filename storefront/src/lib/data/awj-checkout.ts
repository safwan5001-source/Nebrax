"use server";

import {
  type AwjAddressInput,
  type AwjContactInput,
  completeAwjCheckout,
  createOrResumeAwjCheckout,
  fetchAwjCheckout,
  updateAwjCheckoutAddress,
  updateAwjCheckoutContact,
  updateAwjCheckoutDelivery,
} from "@/lib/commerce/checkout";
import {
  type AwjReviewIssue,
  type AwjReviewRequiredDetails,
  mapAwjCheckoutToViewModel,
  type StorefrontCheckout,
  type StorefrontOrder,
} from "@/lib/commerce/checkout-types";
import { StorefrontApiError } from "@/lib/commerce/config";
import { actionResult } from "./utils";

/**
 * COM-CHECKOUT-1C — server actions wrapping the AWJ Checkout V1 client
 * (`@/lib/commerce/checkout`), the "use server" boundary the AWJ checkout UI
 * calls into, mirroring `@/lib/data/cart`'s AWJ actions exactly (same
 * `actionResult()` convention, same "server does the HTTP, client only ever
 * sees the mapped view model or a structured failure" shape).
 *
 * Named `awj-checkout.ts`, not `checkout.ts`: that filename is already the
 * Spree/wholesale checkout data layer (`resolveSurfaceForCart`,
 * `getCheckoutOrder`, `applyCode`, ...), consumed by the existing
 * `(checkout)` route group and `payment.ts`/`express-checkout-flow.ts`. This
 * file is fully independent of it — no shared exports, no shared surface
 * resolution — matching the Storefront architecture boundary: AWJ DTC
 * Checkout stays AWJ-native, the Spree checkout data layer is untouched.
 */

/** GET the current checkout. Never creates one (see `fetchAwjCheckout`). Null on any failure. */
export async function getAwjCheckout(): Promise<StorefrontCheckout | null> {
  try {
    return await fetchAwjCheckout();
  } catch {
    return null;
  }
}

/**
 * Creates a checkout for the current cart, or resumes the existing open
 * one. Fails closed (surfaced as `success: false`) when there is no usable
 * cart — missing, empty, or expired — so the caller can send the visitor
 * back to `/cart` instead of rendering a broken checkout form.
 */
export async function startOrResumeAwjCheckout() {
  return actionResult(async () => {
    const checkout = await createOrResumeAwjCheckout();
    return { checkout };
  }, "Could not start checkout. Please return to your cart and try again.");
}

export async function updateAwjContact(fields: AwjContactInput) {
  return actionResult(async () => {
    const checkout = await updateAwjCheckoutContact(fields);
    return { checkout };
  }, "Could not save your contact information. Please try again.");
}

export async function updateAwjAddress(fields: AwjAddressInput) {
  return actionResult(async () => {
    const checkout = await updateAwjCheckoutAddress(fields);
    return { checkout };
  }, "Could not save your delivery address. Please try again.");
}

export async function updateAwjDelivery(method: string) {
  return actionResult(async () => {
    const checkout = await updateAwjCheckoutDelivery(method);
    return { checkout };
  }, "Could not save your delivery method. Please try again.");
}

export type CompleteAwjCheckoutResult =
  | { success: true; order: StorefrontOrder; replayed: boolean }
  | {
      success: false;
      kind: "review_required";
      items: AwjReviewIssue[];
      checkout: StorefrontCheckout;
      message: string;
    }
  | { success: false; kind: "idempotency_conflict"; message: string }
  | { success: false; kind: "not_found"; message: string }
  | { success: false; kind: "error"; message: string };

function isReviewRequiredDetails(
  value: unknown,
): value is AwjReviewRequiredDetails {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { items?: unknown; checkout?: unknown };
  return (
    Array.isArray(candidate.items) &&
    typeof candidate.checkout === "object" &&
    candidate.checkout !== null
  );
}

/**
 * Completes the checkout. `idempotencyKey` MUST be generated once per
 * logical attempt by the caller (a client component — see
 * `generateIdempotencyKey` in `AwjCheckoutFlow`) and reused verbatim on any
 * retry of that same attempt; this function never generates or alters it.
 *
 * A `409 review_required` failure is **not** collapsed into a generic
 * error: it is returned as its own `kind` carrying the backend's
 * authoritative `items` (per-line reasons) and refreshed `checkout` state,
 * so the caller can update the checkout/cart UI and explain what changed
 * instead of showing "something went wrong."
 */
export async function completeAwjCheckoutAction(
  idempotencyKey: string,
): Promise<CompleteAwjCheckoutResult> {
  try {
    const { order, replayed } = await completeAwjCheckout(idempotencyKey);
    return { success: true, order, replayed };
  } catch (error) {
    if (error instanceof StorefrontApiError) {
      if (
        error.code === "review_required" &&
        isReviewRequiredDetails(error.details)
      ) {
        return {
          success: false,
          kind: "review_required",
          items: error.details.items,
          checkout: mapAwjCheckoutToViewModel(error.details.checkout),
          message: error.message,
        };
      }
      if (error.code === "idempotency_conflict") {
        return {
          success: false,
          kind: "idempotency_conflict",
          message: error.message,
        };
      }
      if (error.code === "not_found") {
        return { success: false, kind: "not_found", message: error.message };
      }
      return { success: false, kind: "error", message: error.message };
    }
    return {
      success: false,
      kind: "error",
      message: "Could not complete your order. Please try again.",
    };
  }
}
