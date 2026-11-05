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

import type {
  AwjCart,
  AwjLinePersonalization,
  StorefrontCart,
  StorefrontLinePersonalization,
} from "./cart-types";
import {
  groupAddonLines,
  mapAwjCartToViewModel,
  mapLinePersonalization,
} from "./cart-types";
import {
  mapCheckoutSchedule,
  mapGift,
  mapGiftOptions,
  mapOrderSchedule,
  type StorefrontGift,
  type StorefrontGiftOptions,
  type StorefrontOrderSchedule,
  type StorefrontSchedule,
} from "./checkout-gifting";

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
  /**
   * PAY-H4-04a — present **only** when the platform's online-checkout gate is
   * open: `true` means this method is linked to a ready payment gateway, so
   * choosing it makes the order an online-payment order. Absent/`false` is
   * the cash-settlement method it has always been (an older API never sends it).
   */
  online?: boolean;
  /**
   * Beta — set only on an *online-method option* (mada/Visa/Mastercard/Apple Pay) the merchant enabled, built from the API's `online_methods`
   * (never typed in the UI). `id` is then `online:<key>`; the label comes from the message catalogue under `payment.onlineBrand.<key>`.
   */
  onlineKey?: string;
  /** Beta — server-decided: `false` means choosing it is refused with the "unavailable, nothing was charged" notice. */
  ready?: boolean;
  /** Beta — the checkout payment-method id a ready option resolves to (for pre-selecting a saved choice). */
  linkedMethodId?: string | null;
}

/** Raw `online_methods[]` row of `GET checkout/payment-methods` (present only when the merchant enabled at least one). */
export interface AwjOnlineMethodRow {
  key: string;
  ready: boolean;
  payment_method_id: string | null;
}

/** The id an online-method option carries in the shopper-facing list. */
export const AWJ_ONLINE_OPTION_PREFIX = "online:";

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
  /** ADR-15 — `null` when the checkout is not a gift; absent on an older API. */
  gift?: AwjGift | null;
  /** ADR-15 — the channel's gift policy; absent on an older API (treated as disabled). */
  gift_options?: AwjGiftOptions;
  /** ADR-19 — present only once a date/window was stored. */
  schedule?: AwjCheckoutSchedule;
  cart: AwjCart;
}

/** ADR-15 — the gift context exactly as the API sends it. */
export interface AwjGift {
  recipient_name: string | null;
  recipient_phone: string | null;
  sender_display_name: string | null;
  hide_sender: boolean;
  message: string | null;
}

/** ADR-15 — the channel's gift policy (limits the shopper UI needs). */
export interface AwjGiftOptions {
  enabled: boolean;
  message_max_length: number;
  allow_hide_sender: boolean;
  recipient_phone_required: boolean;
}

/** ADR-19 — the stored selection on an open checkout. `slot` is `null` once it is no longer selectable. */
export interface AwjCheckoutSchedule {
  date: string;
  slot: Record<string, unknown> | null;
  valid: boolean;
}

/** ADR-19 — the immutable schedule snapshot on an order. */
export interface AwjOrderSchedule {
  method: "delivery" | "pickup";
  date: string;
  slot: {
    label: string;
    label_en: string | null;
    start_time: string;
    end_time: string;
  };
  timezone: string;
}

/**
 * COPS-H2-4 (D-H2-13) — the buyer-facing fulfilment block. Whitelisted by the API: no courier, staff, warehouse, notes,
 * failure reason or attempt count. A failed attempt / return to the store is only ever `delivery_attempt_failed`.
 */
export interface AwjOrderFulfillment {
  type: string;
  stage: string;
  stages: Array<{ key: string; at: string | null }>;
  tracking: {
    carrier: string | null;
    number: string | null;
    url: string | null;
  } | null;
  pickup: { ready_at: string | null } | null;
}

/** Raw `POST /checkout/complete` success payload — the `order` field, per `StorefrontCheckoutController::serializeOrder()`. */
export interface AwjOrder {
  id: string;
  number: string;
  /**
   * `draft | confirmed`, plus `cancelled` (ADR-28 D-9-P1 option B / O3c): a cancelled order's stored status stays
   * `confirmed`, the API derives `cancelled`. Kept `string` so an unknown future value never breaks parsing.
   */
  status: string;
  delivery_method: string | null;
  /** Present only when `status === "cancelled"`; carries no reason/actor/refund data. */
  cancellation?: { cancelled_at: string | null };
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
  /** ADR-15 — `null`/absent when the order is not a gift. */
  gift?: AwjGift | null;
  /** ADR-19 — present only when a date/window was chosen. */
  schedule?: AwjOrderSchedule;
  /** COPS-H2-4 — public fulfilment progress; absent when there is no fulfilment yet and for a cancelled order. */
  fulfillment?: AwjOrderFulfillment;
  payment: {
    method: string | null;
    status: string | null;
    payment_method_name: string | null;
    /** PAY-H4-04a — present only when the online gate is open: `true` while an online order still awaits payment. */
    requires_action?: boolean;
  };
  items: Array<{
    product_id: string | null;
    product_name: string;
    unit_name: string | null;
    quantity: number;
    unit_price: AwjMoney;
    line_total: AwjMoney;
    /** ADR-16 — present only on a personalized line. */
    personalization?: AwjLinePersonalization[];
    /** ADR-18 — present on an add-on line and on its parent. */
    line_id?: string;
    /** ADR-18 — present only on an add-on line: the parent's `line_id`. */
    addon_of?: string;
  }>;
  created_at: string | null;
}

/** One failing line/reason from a `review_required` (409) response's `error.details.items`. */
export interface AwjReviewIssue {
  item_id: string;
  /** COPS-H4-4 — present only on a `below_minimum_order` refusal: the store's minimum and what is still missing (minor units). */
  min_order_minor?: number;
  shortfall_minor?: number;
  reason:
    | "unavailable"
    | "uom_invalid"
    | "price_unresolved"
    | "insufficient_stock"
    | "fulfillment_not_configured"
    | "contact_incomplete"
    | "delivery_method_missing"
    | "empty_cart"
    /** COPS-H4-4 — store-level refusals (`item_id: "store"`): paused, outside opening hours, below the minimum order. */
    | "store_paused"
    | "outside_opening_hours"
    | "below_minimum_order"
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
  /** FLOWERS-H12b — `null` when the checkout is not a gift. */
  gift: StorefrontGift | null;
  /** The channel's gift policy; disabled when the API sends none. */
  giftOptions: StorefrontGiftOptions;
  /** The stored delivery date/window, or `null` when none was chosen. */
  schedule: StorefrontSchedule | null;
  cart: StorefrontCart;
}

export const FULFILLMENT_TYPES = [
  "local_delivery",
  "carrier",
  "pickup",
] as const;
export const FULFILLMENT_STAGES = [
  "preparing",
  "ready",
  "out_for_delivery",
  "delivery_attempt_failed",
  "delivered",
  "picked_up",
] as const;
const STAGE_KEYS = ["placed", "accepted", ...FULFILLMENT_STAGES] as const;

export interface StorefrontFulfillment {
  type: (typeof FULFILLMENT_TYPES)[number];
  stage: (typeof FULFILLMENT_STAGES)[number];
  stages: Array<{ key: (typeof STAGE_KEYS)[number]; at: string | null }>;
  /** Carrier shipments after dispatch only; the link is https and nothing else. */
  tracking: {
    carrier: string | null;
    number: string | null;
    url: string | null;
  } | null;
  pickup: { readyAt: string | null } | null;
}

export interface StorefrontOrder {
  id: string;
  number: string;
  status: string;
  deliveryMethod: string | null;
  /** O3c — set only for a cancelled order; `null` when the API gave no timestamp. Absent otherwise. */
  cancelledAt?: string | null;
  total: AwjMoney;
  contact: AwjOrder["contact"];
  delivery: AwjOrder["delivery"];
  payment: AwjOrder["payment"];
  /** FLOWERS-H12b — `null` when the order is not a gift. */
  gift: StorefrontGift | null;
  /** The requested date/window snapshot, or `null` when none was chosen. */
  schedule: StorefrontOrderSchedule | null;
  /** COPS-H2-4 — `null` when the API sent no (or an unreadable) fulfilment block: the order is then only "placed". */
  fulfillment?: StorefrontFulfillment | null;
  items: Array<{
    productId: string | null;
    productName: string;
    unitName: string | null;
    quantity: number;
    unitPrice: AwjMoney;
    lineTotal: AwjMoney;
    personalization: StorefrontLinePersonalization[];
    /** Set on a parent line that has add-ons and on the add-on lines themselves. */
    lineId: string | null;
    /** Parent `lineId` when this is an add-on line, else `null`. */
    addonOf: string | null;
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
    gift: mapGift(checkout.gift),
    giftOptions: mapGiftOptions(checkout.gift_options),
    schedule: mapCheckoutSchedule(checkout.schedule),
    cart: mapAwjCartToViewModel(checkout.cart),
  };
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : null;
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null =>
  typeof v === "string" && (list as readonly string[]).includes(v)
    ? (v as T)
    : null;

/**
 * Defensive: an unknown type/stage (a newer API) or a malformed block yields `null`, so the UI falls back to the
 * authoritative "placed" only — it never invents progress from something it cannot read.
 */
export function mapOrderFulfillment(
  raw: AwjOrderFulfillment | null | undefined,
): StorefrontFulfillment | null {
  if (!raw || typeof raw !== "object") return null;
  const type = oneOf(FULFILLMENT_TYPES, raw.type);
  const stage = oneOf(FULFILLMENT_STAGES, raw.stage);
  if (!type || !stage || !Array.isArray(raw.stages)) return null;

  const stages = raw.stages.flatMap((entry) => {
    const key = oneOf(STAGE_KEYS, entry?.key);
    return key ? [{ key, at: str(entry?.at) }] : [];
  });

  const tracking =
    raw.tracking && typeof raw.tracking === "object"
      ? {
          carrier: str(raw.tracking.carrier),
          number: str(raw.tracking.number),
          // https only — a tracking link is a navigation target, never trust other schemes.
          url: str(raw.tracking.url)?.toLowerCase().startsWith("https://")
            ? str(raw.tracking.url)
            : null,
        }
      : null;

  return {
    type,
    stage,
    stages,
    tracking,
    pickup:
      raw.pickup && typeof raw.pickup === "object"
        ? { readyAt: str(raw.pickup.ready_at) }
        : null,
  };
}

export function mapAwjOrderToViewModel(order: AwjOrder): StorefrontOrder {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    deliveryMethod: order.delivery_method,
    ...(order.status === "cancelled"
      ? { cancelledAt: order.cancellation?.cancelled_at ?? null }
      : {}),
    total: order.total,
    contact: order.contact,
    delivery: order.delivery,
    payment: order.payment,
    gift: mapGift(order.gift),
    schedule: mapOrderSchedule(order.schedule),
    fulfillment: mapOrderFulfillment(order.fulfillment),
    items: groupOrderItems(
      order.items.map((item) => ({
        productId: item.product_id,
        productName: item.product_name,
        unitName: item.unit_name,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        lineTotal: item.line_total,
        personalization: mapLinePersonalization(item.personalization),
        lineId: typeof item.line_id === "string" ? item.line_id : null,
        addonOf: typeof item.addon_of === "string" ? item.addon_of : null,
      })),
    ),
    createdAt: order.created_at,
  };
}

/** Add-on lines directly under their parent line (see `groupAddonLines`). */
function groupOrderItems(
  items: StorefrontOrder["items"],
): StorefrontOrder["items"] {
  return groupAddonLines(items, {
    id: (item) => item.lineId,
    parent: (item) => item.addonOf,
  });
}

/**
 * Integer-safe display formatting only — mirrors `formatMinorAmount` in
 * `cart-types.ts` exactly (kept as a re-export point rather than a second
 * implementation so both modules stay trivially in sync).
 */
export { formatMinorAmount } from "./cart-types";
