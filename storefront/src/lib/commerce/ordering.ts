/**
 * COPS-H4 (Buyer Ordering UX) — the buyer-facing reading of `data.ordering` from `GET store/v1/storefront`.
 *
 * ## What this is, and what it is not
 *
 * The block is **informational**. The only authority on whether an order can be placed is the server's Checkout
 * (`CommerceChannelIntakeGuard` inside `POST checkout/complete`, ADR-29 §2.5.3): it refuses with `409 review_required`
 * before writing anything. Nothing here gates a button, hides a route or decides an outcome — it only explains, ahead of
 * time, what the server would say. A stale or wrong reading therefore costs a shopper a clearer message, never a wrong order.
 *
 * ## Fail open for display, never for authority
 *
 * The block is **absent** while the deployment gate is closed (the response is then byte-for-byte the pre-H4 one), and an
 * absent or malformed block yields `null` = "show nothing". That is the safe direction for a notice: the server still
 * enforces, and a missing notice only means the shopper learns at Checkout, as before.
 *
 * Wire shape (additive, see `CommerceChannelIntakeGuard::publicBlock()`):
 *   `{ accepting, reason: 'paused'|'outside_hours'|null, message, resumes_at, min_order_minor, min_order_scope }`
 */

export type AwjOrderingReason = "paused" | "outside_hours";
export type AwjMinOrderScope = "all" | "delivery_only";

export interface AwjOrdering {
  /** `false` ⇒ the store is not taking new orders right now (paused, or outside opening hours with policy `block`). */
  accepting: boolean;
  /** Why it is not accepting; `null` while accepting. */
  reason: AwjOrderingReason | null;
  /** The merchant's short pause note (plain text, ≤ 200). Only ever present for `paused`. */
  message: string | null;
  /** ISO-8601 instant at which a scheduled pause ends; `null` for an open-ended pause / outside hours. */
  resumesAt: string | null;
  /** Minimum order in minor units (halalas), or `null` when the store has none. */
  minOrderMinor: number | null;
  /** Which orders the minimum applies to. */
  minOrderScope: AwjMinOrderScope;
}

/** The server caps the note at 200 characters; the same cap here keeps a rogue payload from flooding a banner. */
const MAX_MESSAGE = 200;

function plainText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strips control characters from merchant-authored text.
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (cleaned === "") return null;
  return cleaned.slice(0, MAX_MESSAGE);
}

function isoInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : value;
}

/**
 * Strictly reads the block. Anything that is not exactly the contract returns `null` (no notice) — a partially trusted
 * block would mean guessing, and the server is the one place that does not have to.
 */
export function readOrdering(raw: unknown): AwjOrdering | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (typeof value.accepting !== "boolean") return null;

  let reason: AwjOrderingReason | null = null;
  if (value.accepting === false) {
    if (value.reason !== "paused" && value.reason !== "outside_hours") {
      return null;
    }
    reason = value.reason;
  } else if (value.reason != null) {
    // "accepting" with a reason is self-contradictory; trust neither.
    return null;
  }

  const scope = value.min_order_scope;
  if (scope !== "all" && scope !== "delivery_only") return null;

  const min = value.min_order_minor;
  let minOrderMinor: number | null = null;
  if (min !== null && min !== undefined) {
    if (typeof min !== "number" || !Number.isSafeInteger(min) || min < 1) {
      return null;
    }
    minOrderMinor = min;
  }

  return {
    accepting: value.accepting,
    reason,
    message: reason === "paused" ? plainText(value.message) : null,
    resumesAt: reason === "paused" ? isoInstant(value.resumes_at) : null,
    minOrderMinor,
    minOrderScope: scope,
  };
}

export interface MinimumOrderView {
  /** The minimum, in minor units. */
  minOrderMinor: number;
  scope: AwjMinOrderScope;
  /** `false` when the minimum does not apply to this order (pickup under `delivery_only`). */
  applies: boolean;
  /** Minor units still missing, or `null` when not applicable or already met. */
  shortfallMinor: number | null;
}

/**
 * The buyer-side mirror of `CommerceChannelIntake::minimumShortfall()` — **display only**.
 *
 * The server measures the order's lines after discount and before shipping; the cart's `subtotal` is the same sum while
 * no discount exists in the cart payload (see `COUPON_CAPABILITY`). Should those ever diverge, Checkout's answer wins and
 * its refusal carries the exact `shortfall_minor`, which the Checkout flow prints instead of this estimate.
 *
 * `deliveryMethod` is only known at Checkout; on the cart it is `null`, so a `delivery_only` minimum is shown with its
 * scope rather than assumed to apply.
 */
export function minimumOrderView(
  ordering: AwjOrdering | null,
  subtotalMinor: number,
  deliveryMethod: string | null,
): MinimumOrderView | null {
  if (!ordering || ordering.minOrderMinor === null) return null;
  const min = ordering.minOrderMinor;
  const exempt =
    ordering.minOrderScope === "delivery_only" && deliveryMethod === "pickup";
  if (exempt) {
    return {
      minOrderMinor: min,
      scope: ordering.minOrderScope,
      applies: false,
      shortfallMinor: null,
    };
  }
  return {
    minOrderMinor: min,
    scope: ordering.minOrderScope,
    applies: true,
    shortfallMinor: subtotalMinor < min ? min - subtotalMinor : null,
  };
}

/**
 * Wraps text in a Unicode first-strong isolate (FSI … PDI).
 *
 * The storefront's one money formatter (`formatMinorAmount`) always produces Arabic-locale output (`‏١٥٠٫٠٠ ر.س.‏`).
 * Dropped into a left-to-right sentence it would otherwise reorder with the surrounding words (the digits and the currency
 * sign swap places); isolating it keeps the amount reading correctly in either direction without changing the formatter
 * the cart and checkout summaries already share.
 */
export function isolateBidi(text: string): string {
  return `\u2068${text}\u2069`;
}
