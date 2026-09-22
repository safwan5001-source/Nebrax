"use server";

import { createHash } from "node:crypto";
import { getAwjCartToken } from "@/lib/commerce/cart-cookies";
import {
  type AwjAddressInput,
  type AwjContactInput,
  completeAwjCheckout,
  createOrResumeAwjCheckout,
  fetchAwjCheckout,
  fetchAwjPaymentMethods,
  updateAwjCheckoutAddress,
  updateAwjCheckoutContact,
  updateAwjCheckoutDelivery,
  updateAwjCheckoutPayment,
} from "@/lib/commerce/checkout";
import {
  type AwjPaymentMethod,
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
 * A stable, opaque identity for "the checkout this browser is currently
 * working on" — used purely client-side to scope a persisted
 * Idempotency-Key so it survives a reload for the *same* checkout attempt
 * without leaking across genuinely different ones (see
 * `@/lib/commerce/checkout-idempotency`).
 *
 * The backend never exposes a `CommerceCheckout` id to the storefront
 * (COM-CHECKOUT-1A/1B — same convention as `AwjCart` carrying no cart id),
 * and `awj_cart_token` itself is HttpOnly, so client JS cannot read it
 * directly. This returns a one-way SHA-256 hash of that token instead —
 * safe to hand to the client (it cannot be reversed into the token) while
 * still changing exactly when the cart identity changes (a new guest
 * session, an expired cart replaced by a new one). `null` when there is no
 * cart token at all (nothing to key a persisted key to).
 */
export async function getAwjCheckoutIdentity(): Promise<string | null> {
  const token = await getAwjCartToken();
  if (!token) return null;

  return createHash("sha256").update(token).digest("hex");
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

/** The payment methods this channel has enabled. Empty array on any failure — never throws to the caller. */
export async function getAwjPaymentMethods(): Promise<AwjPaymentMethod[]> {
  try {
    return await fetchAwjPaymentMethods();
  } catch {
    return [];
  }
}

export async function updateAwjPayment(paymentMethodId: string) {
  return actionResult(async () => {
    const checkout = await updateAwjCheckoutPayment(paymentMethodId);
    return { checkout };
  }, "Could not save your payment method. Please try again.");
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
 * `resolveIdempotencyKey` in `@/lib/commerce/checkout-idempotency`, which
 * also persists it across a reload) and reused verbatim on any retry of
 * that same attempt; this function never generates or alters it.
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
