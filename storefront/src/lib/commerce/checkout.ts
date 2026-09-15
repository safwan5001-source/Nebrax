/**
 * AWJ Store Checkout V1 client — the only module that calls
 * `store/v1/checkout*` (COM-CHECKOUT-1A/1B). Talks to
 * `storefrontCartRequest()` — the same trust-boundary transport `cart.ts`
 * uses, extended for `Idempotency-Key` (see `./config`) — and returns the
 * storefront's own `StorefrontCheckout`/`StorefrontOrder` view models,
 * never the raw wire shape.
 */

import {
  type AwjCheckout,
  type AwjOrder,
  mapAwjCheckoutToViewModel,
  mapAwjOrderToViewModel,
  type StorefrontCheckout,
  type StorefrontOrder,
} from "./checkout-types";
import { storefrontCartRequest } from "./config";
import type { AwjResourceResponse } from "./types";

/**
 * GET the current checkout for the visitor's cart. Never creates one — no
 * checkout yet (fresh cart, or none) reads back the backend's own empty
 * shape (`CommerceCheckoutService::emptyResponse()`), same convention as
 * `fetchAwjCart()`.
 */
export async function fetchAwjCheckout(): Promise<StorefrontCheckout> {
  const response = await storefrontCartRequest<
    AwjResourceResponse<AwjCheckout>
  >("GET", "checkout");
  return mapAwjCheckoutToViewModel(response.data);
}

/**
 * POST to create a new checkout for the current cart, or resume the
 * existing open one — the backend itself decides which (COM-CHECKOUT-1A
 * `createOrResume()`). Fails closed (404 `not_found`) if there is no usable
 * cart (missing/expired) — never creates a cart.
 */
export async function createOrResumeAwjCheckout(): Promise<StorefrontCheckout> {
  const response = await storefrontCartRequest<
    AwjResourceResponse<AwjCheckout>
  >("POST", "checkout");
  return mapAwjCheckoutToViewModel(response.data);
}

export interface AwjContactInput {
  name?: string;
  phone?: string;
  email?: string | null;
}

export async function updateAwjCheckoutContact(
  fields: AwjContactInput,
): Promise<StorefrontCheckout> {
  const response = await storefrontCartRequest<
    AwjResourceResponse<AwjCheckout>
  >("PATCH", "checkout/contact", fields);
  return mapAwjCheckoutToViewModel(response.data);
}

export interface AwjAddressInput {
  country?: string;
  region?: string | null;
  city?: string;
  district?: string | null;
  street?: string;
  postal_code?: string | null;
  notes?: string | null;
}

export async function updateAwjCheckoutAddress(
  fields: AwjAddressInput,
): Promise<StorefrontCheckout> {
  const response = await storefrontCartRequest<
    AwjResourceResponse<AwjCheckout>
  >("PATCH", "checkout/address", fields);
  return mapAwjCheckoutToViewModel(response.data);
}

/**
 * `method` must be one of `AWJ_DELIVERY_METHODS` (`checkout-types.ts`) —
 * the backend's own fixed list (`CommerceCheckoutService::DELIVERY_METHODS`).
 * There is no amount parameter: the backend never accepts a client-supplied
 * delivery amount (it is always server-set to `0` until a real shipping
 * pricing authority exists) — this function's signature makes sending one
 * structurally impossible, mirroring the backend contract.
 */
export async function updateAwjCheckoutDelivery(
  method: string,
): Promise<StorefrontCheckout> {
  const response = await storefrontCartRequest<
    AwjResourceResponse<AwjCheckout>
  >("PATCH", "checkout/delivery", { method });
  return mapAwjCheckoutToViewModel(response.data);
}

/** `POST /checkout/complete` success payload. */
export interface AwjCompletionResult {
  order: StorefrontOrder;
  replayed: boolean;
}

/**
 * Completes the checkout — final server-side revalidation, then creates
 * exactly one `CommerceOrder` (COM-CHECKOUT-1B). `idempotencyKey` is
 * mandatory and must be **stable across retries of the same logical
 * attempt** (the caller owns generating it once per attempt, e.g. via
 * `useRef`, never regenerating it on a re-render or a retry of the same
 * click) — the backend rejects the call outright without it, and reusing
 * the same key on retry is what makes a retry safe rather than creating a
 * second order.
 *
 * On a `409 review_required` failure, the thrown `StorefrontApiError`'s
 * `details` carries `{ items, checkout }` — see `AwjReviewRequiredDetails`
 * in `checkout-types.ts`. Callers must read that instead of treating this
 * as a generic error (see `completeAwjCheckoutAction` in
 * `@/lib/data/checkout`).
 */
export async function completeAwjCheckout(
  idempotencyKey: string,
): Promise<AwjCompletionResult> {
  const response = await storefrontCartRequest<
    AwjResourceResponse<{ order: AwjOrder; replayed: boolean }>
  >("POST", "checkout/complete", {}, { "Idempotency-Key": idempotencyKey });
  return {
    order: mapAwjOrderToViewModel(response.data.order),
    replayed: response.data.replayed,
  };
}
