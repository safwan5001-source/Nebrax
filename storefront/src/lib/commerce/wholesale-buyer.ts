/**
 * Native wholesale buyer — pure vocabulary and state mapping (H6 Batch G).
 *
 * No I/O, no `next/*`, no Spree: it only names the states the storefront can
 * show a wholesale buyer and maps the API's answers onto them, so the pages and
 * the tests share one definition. The authority is always the backend:
 *   - `store/v1/products|offers` on a wholesale-flagged channel answer 401 (no
 *     valid buyer session for this host) or 403 (valid session, membership not
 *     approved); a DTC channel never does.
 *   - `store/v1/wholesale/membership` states the buyer's own status.
 * The storefront holds no group name, no hard-coded minimum and no price rule.
 */

export const MEMBERSHIP_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "suspended",
] as const;

export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** What the visitor can do on a wholesale host right now. */
export type BuyerAccessState =
  | "signed_out"
  | "no_application"
  | MembershipStatus
  | "unavailable";

/** Why a price-bearing catalogue read was refused. */
export type CatalogGate = "sign_in_required" | "approval_required";

export function isMembershipStatus(value: unknown): value is MembershipStatus {
  return (
    typeof value === "string" &&
    (MEMBERSHIP_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Maps a failed catalogue read to a gate. Duck-typed on `status` so this module
 * stays free of the transport (`StorefrontApiError`). Only 401/403 are gates:
 * anything else (404 for a missing product, 5xx) keeps its existing handling.
 */
export function catalogGateFromError(error: unknown): CatalogGate | null {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 401) return "sign_in_required";
  if (status === 403) return "approval_required";
  return null;
}

/** The membership payload → the buyer's state. `null` = signed in, never applied. */
export function accessStateFromMembership(
  membership: { status?: unknown } | null | undefined,
): BuyerAccessState {
  if (membership === null || membership === undefined) return "no_application";
  return isMembershipStatus(membership.status)
    ? membership.status
    : "unavailable";
}

/** Only an approved membership unlocks prices; every other state is a wall. */
export function canSeeWholesalePrices(state: BuyerAccessState): boolean {
  return state === "approved";
}

/** A buyer may (re)submit an application only when none exists. The API is idempotent and never reopens a decision. */
export function canApply(state: BuyerAccessState): boolean {
  return state === "no_application";
}

const SAFE_ERROR_CODES = new Set([
  "invalid_credentials",
  "unauthenticated",
  "forbidden",
  "rate_limited",
  "validation_failed",
]);

/**
 * API error code → a message-catalogue key. Anything unrecognised collapses to
 * `generic`, so internal error text never reaches a buyer, and sign-in failures
 * stay indistinguishable (unknown / wrong password / unverified email).
 */
export type BuyerErrorKey =
  | "invalidCredentials"
  | "rateLimited"
  | "unavailable"
  | "validation"
  | "generic";

export function buyerErrorKey(
  status: number | undefined,
  code: string | undefined,
): Exclude<BuyerErrorKey, "validation"> {
  if (status === 429 || code === "rate_limited") return "rateLimited";
  if (status === 404) return "unavailable";
  if (
    status === 401 ||
    status === 422 ||
    (code && SAFE_ERROR_CODES.has(code))
  ) {
    return "invalidCredentials";
  }
  return "generic";
}

/**
 * Registration / verification failures. Unlike sign-in (where a 422 means "bad credentials" and must stay
 * indistinguishable), a 422 here is a form-validation or invalid-link answer, so it is surfaced as such; rate limiting and
 * an unavailable store keep their own keys and everything else is generic. Never any server text.
 */
export function buyerFormErrorKey(status: number | undefined): BuyerErrorKey {
  if (status === 429) return "rateLimited";
  if (status === 404) return "unavailable";
  if (status === 422) return "validation";
  return "generic";
}

/** A `/xx/yy` locale prefix the backend accepts for the e-mailed link path; anything else is dropped. */
export function localePathFrom(basePath: string): string | undefined {
  return /^\/[a-z]{2}\/[a-z]{2}$/.test(basePath) ? basePath : undefined;
}

/**
 * H6 Batch K — why a cart or checkout call was refused for a wholesale buyer, as a stable key the storefront can localize
 * (never the backend's own text). `sign_in_required`: no valid buyer session for this host (401). `approval_required`: signed in
 * but the membership is not approved / is suspended (403). `unavailable_for_wholesale`: the line has no eligible price for this
 * buyer (422 with `details.reason`). Anything else is `null` and keeps its existing handling, so DTC behaviour is unchanged.
 */
export type PurchaseIssue =
  | "sign_in_required"
  | "approval_required"
  | "unavailable_for_wholesale";

export function purchaseIssueFromError(error: unknown): PurchaseIssue | null {
  const e = error as {
    status?: unknown;
    code?: unknown;
    details?: unknown;
  } | null;
  if (e === null || typeof e !== "object") return null;
  if (e.status === 401) return "sign_in_required";
  if (e.status === 403) return "approval_required";
  if (
    e.status === 422 &&
    typeof e.details === "object" &&
    e.details !== null &&
    (e.details as { reason?: unknown }).reason === "unavailable_for_wholesale"
  ) {
    return "unavailable_for_wholesale";
  }
  return null;
}

/**
 * H6 Batch M — the buyer's OWN membership state as the gate saw it (`details.membership_status` of the 403). Lets the gate word
 * itself truthfully: a suspended buyer is not told they are "not approved yet". Anything unrecognised is `null` (generic gate).
 */
export type MembershipGateStatus =
  | "none"
  | "pending"
  | "rejected"
  | "suspended";

const MEMBERSHIP_GATE_STATUSES: readonly string[] = [
  "none",
  "pending",
  "rejected",
  "suspended",
];

export function membershipGateStatusFromError(
  error: unknown,
): MembershipGateStatus | null {
  const e = error as { status?: unknown; details?: unknown } | null;
  if (e === null || typeof e !== "object" || e.status !== 403) return null;
  const status = (e.details as { membership_status?: unknown } | undefined)
    ?.membership_status;
  return typeof status === "string" && MEMBERSHIP_GATE_STATUSES.includes(status)
    ? (status as MembershipGateStatus)
    : null;
}

// ───────────────────────── buyer order history (H6 Batch M) ─────────────────────────

export type BuyerOrderSummary = {
  id: string;
  number: string;
  status: string;
  createdAt: string | null;
  totalMinor: number;
  currency: string;
  deliveryMethod: string | null;
  cancelledAt: string | null;
};

export type BuyerOrderLine = {
  name: string;
  unitName: string | null;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
};

export type BuyerOrderDetail = BuyerOrderSummary & {
  lines: BuyerOrderLine[];
  deliveryAmountMinor: number | null;
  deliveryAddress: string | null;
  paymentMethodName: string | null;
  paymentStatus: string | null;
};

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : null;
const minor = (v: unknown): number | null => {
  const amount = isObject(v) ? v.amount_minor : null;
  return typeof amount === "number" && Number.isFinite(amount) ? amount : null;
};

/** A summary row from `GET buyer/orders`; a malformed row is dropped (`null`), never rendered half-filled. */
export function buyerOrderSummaryFromApi(
  raw: unknown,
): BuyerOrderSummary | null {
  if (!isObject(raw)) return null;
  const id = str(raw.id);
  const number = str(raw.number);
  const total = minor(raw.total);
  const currency = isObject(raw.total) ? str(raw.total.currency) : null;
  if (!id || !number || total === null || !currency) return null;
  return {
    id,
    number,
    status: str(raw.status) ?? "confirmed",
    createdAt: str(raw.created_at),
    totalMinor: total,
    currency,
    deliveryMethod: str(raw.delivery_method),
    cancelledAt: isObject(raw.cancellation)
      ? str(raw.cancellation.cancelled_at)
      : null,
  };
}

/** The detail from `GET buyer/orders/{id}`. Only public-safe fields are read; everything else in the payload is ignored. */
export function buyerOrderDetailFromApi(raw: unknown): BuyerOrderDetail | null {
  const summary = buyerOrderSummaryFromApi(raw);
  if (!summary || !isObject(raw)) return null;

  const items = Array.isArray(raw.items) ? raw.items : [];
  const lines: BuyerOrderLine[] = [];
  for (const item of items) {
    if (!isObject(item)) continue;
    const name = str(item.product_name);
    const unit = minor(item.unit_price);
    const total = minor(item.line_total);
    const quantity = item.quantity;
    if (
      !name ||
      unit === null ||
      total === null ||
      typeof quantity !== "number"
    ) {
      continue;
    }
    lines.push({
      name,
      unitName: str(item.unit_name),
      quantity,
      unitPriceMinor: unit,
      lineTotalMinor: total,
    });
  }

  const delivery = isObject(raw.delivery) ? raw.delivery : null;
  const address = delivery
    ? [
        delivery.street,
        delivery.district,
        delivery.city,
        delivery.region,
        delivery.postal_code,
      ]
        .map(str)
        .filter((part): part is string => part !== null)
        .join("، ")
    : "";
  const payment = isObject(raw.payment) ? raw.payment : null;

  return {
    ...summary,
    lines,
    deliveryAmountMinor: delivery ? minor(delivery.amount) : null,
    deliveryAddress: address === "" ? null : address,
    paymentMethodName: payment ? str(payment.payment_method_name) : null,
    paymentStatus: payment ? str(payment.status) : null,
  };
}

/** Plain locale-aware money for the buyer pages (minor units → display; the only place amounts are divided). */
export function formatBuyerMoney(
  amountMinor: number,
  currency: string,
  locale: string,
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`;
  }
}
