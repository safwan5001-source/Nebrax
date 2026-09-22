/**
 * Wire types for the AWJ Store Checkout API (`store/v1/checkout*`,
 * COM-CHECKOUT-1A/1B), and the storefront-facing view models derived from
 * them.
 *
 * Deliberately separate from `cart-types.ts`'s `AwjCart`/`StorefrontCart` —
 * Checkout wraps a Cart but is not one (`CommerceCheckout != CommerceCart`),
 * and the completed `CommerceOrder` is a third, distinct shape
 * (`CommerceOrder != Invoice`, `CommerceOrder != CommerceCheckout`). No
 * Spree `Order`/checkout state machine shape is reused here for the same
 * reason `cart-types.ts` doesn't reuse Spree's `Cart` — see that file's own
 * module doc.
 */

import type { AwjCart, StorefrontCart } from "./cart-types";
import { mapAwjCartToViewModel } from "./cart-types";

export interface AwjMoney {
  amount_minor: number;
  currency: string;
}

/** The two delivery methods the backend currently accepts — no shipping engine, no invented options. */
export const AWJ_DELIVERY_METHODS = ["pickup", "standard"] as const;
export type AwjDeliveryMethod = (typeof AWJ_DELIVERY_METHODS)[number];

/**
 * The two Payment Intent methods this backend can create (COM-MOBILE-
 * PAYMENTS-1, ADR-09) — derived server-side from the delivery method
 * (`standard` -> `cod`, `pickup` -> `pay_on_pickup`), never chosen directly
 * by the shopper. No online/card method exists yet.
 */
export const AWJ_PAYMENT_INTENT_METHODS = ["cod", "pay_on_pickup"] as const;
export type AwjPaymentIntentMethod =
  (typeof AWJ_PAYMENT_INTENT_METHODS)[number];

/** One row from `GET checkout/payment-methods` — the channel's own enabled settlement destinations. */
export interface AwjPaymentMethod {
  id: string;
  name: string;
  name_en: string | null;
  settlement_type: string;
}

/** Raw `GET/POST /checkout`, `PATCH /checkout/{contact,address,delivery,payment}` response shape. */
export interface AwjCheckout {
  status: "active" | "ready" | "completed" | "expired" | null;
  contact: {
    name: string | null;
    phone: string | null;
    email: string | null;
  };
  delivery: {
    method: string | null;
    amount: AwjMoney;
    address: {
      country: string | null;
      region: string | null;
      city: string | null;
      district: string | null;
      street: string | null;
      postal_code: string | null;
      notes: string | null;
    };
  };
  payment: {
    payment_method_id: string | null;
    payment_method_name: string | null;
    method: string | null;
  };
  cart: AwjCart;
}

/** Raw `POST /checkout/complete` success payload — the `order` field, per `StorefrontCheckoutController::serializeOrder()`. */
export interface AwjOrder {
  id: string;
  number: string;
  status: string;
  delivery_method: string | null;
  total: AwjMoney;
  contact: {
    name: string | null;
    phone: string | null;
    email: string | null;
  };
  delivery: {
    country: string | null;
    city: string | null;
    district: string | null;
    street: string | null;
    postal_code: string | null;
    notes: string | null;
  };
  payment: {
    method: string | null;
    status: string | null;
    payment_method_name: string | null;
  };
  items: Array<{
    product_id: string | null;
    product_name: string;
    unit_name: string | null;
    quantity: number;
    unit_price: AwjMoney;
    line_total: AwjMoney;
  }>;
  created_at: string | null;
}

/** One failing line/reason from a `review_required` (409) response's `error.details.items`. */
export interface AwjReviewIssue {
  item_id: string;
  reason:
    | "unavailable"
    | "uom_invalid"
    | "price_unresolved"
    | "insufficient_stock"
    | "fulfillment_not_configured"
    | "contact_incomplete"
    | "delivery_method_missing"
    | "empty_cart"
    | (string & {});
}

/** `error.details` shape of a `review_required` (409) response to `POST /checkout/complete`. */
export interface AwjReviewRequiredDetails {
  items: AwjReviewIssue[];
  checkout: AwjCheckout;
}

/** The storefront checkout view model — what UI components actually consume. */
export interface StorefrontCheckout {
  status: AwjCheckout["status"];
  contact: AwjCheckout["contact"];
  delivery: {
    method: string | null;
    amount: AwjMoney;
    address: AwjCheckout["delivery"]["address"];
  };
  payment: AwjCheckout["payment"];
  cart: StorefrontCart;
}

export interface StorefrontOrder {
  id: string;
  number: string;
  status: string;
  deliveryMethod: string | null;
  total: AwjMoney;
  contact: AwjOrder["contact"];
  delivery: AwjOrder["delivery"];
  payment: AwjOrder["payment"];
  items: Array<{
    productId: string | null;
    productName: string;
    unitName: string | null;
    quantity: number;
    unitPrice: AwjMoney;
    lineTotal: AwjMoney;
  }>;
  createdAt: string | null;
}

export function mapAwjCheckoutToViewModel(
  checkout: AwjCheckout,
): StorefrontCheckout {
  return {
    status: checkout.status,
    contact: checkout.contact,
    delivery: {
      method: checkout.delivery.method,
      amount: checkout.delivery.amount,
      address: checkout.delivery.address,
    },
    payment: checkout.payment,
    cart: mapAwjCartToViewModel(checkout.cart),
  };
}

export function mapAwjOrderToViewModel(order: AwjOrder): StorefrontOrder {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    deliveryMethod: order.delivery_method,
    total: order.total,
    contact: order.contact,
    delivery: order.delivery,
    payment: order.payment,
    items: order.items.map((item) => ({
      productId: item.product_id,
      productName: item.product_name,
      unitName: item.unit_name,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      lineTotal: item.line_total,
    })),
    createdAt: order.created_at,
  };
}

/**
 * Integer-safe display formatting only — mirrors `formatMinorAmount` in
 * `cart-types.ts` exactly (kept as a re-export point rather than a second
 * implementation so both modules stay trivially in sync).
 */
export { formatMinorAmount } from "./cart-types";
