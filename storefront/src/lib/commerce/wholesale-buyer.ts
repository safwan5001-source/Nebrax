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
export function buyerErrorKey(
  status: number | undefined,
  code: string | undefined,
): "invalidCredentials" | "rateLimited" | "unavailable" | "generic" {
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
