/**
 * Buyer-account failure classification (SPREE-X1 security review).
 *
 * A server action must never forward an upstream error MESSAGE to the buyer:
 * a 4xx status says the request was refused, not that the text is safe — it can
 * still carry a stack fragment, an endpoint, a token, a configuration detail or
 * another shopper's data. So the message is never read at all. Only an
 * explicit, closed allowlist of machine codes is mapped to a safe code, and the
 * UI renders localized copy for that code (`accountErrors` namespace). Anything
 * unknown collapses to the generic `request_failed`.
 *
 * Pure and dependency-free so it can be unit-tested and shared by server
 * actions and UI without pulling the Spree client in.
 */
export type AccountAuthFailureCode =
  | "capability_unavailable"
  | "invalid_credentials"
  | "weak_password"
  | "password_mismatch"
  | "current_password_invalid"
  | "invalid_token"
  | "validation_failed"
  | "rate_limited"
  | "request_failed";

export type AccountAction =
  | "login"
  | "register"
  | "password_reset_request"
  | "password_reset"
  | "profile_update";

/** Backend machine code (exact, lower-case) -> safe buyer-facing code. */
const CODE_ALLOWLIST: Readonly<Record<string, AccountAuthFailureCode>> = {
  invalid_credentials: "invalid_credentials",
  authentication_failed: "invalid_credentials",
  password_too_short: "weak_password",
  weak_password: "weak_password",
  password_confirmation_mismatch: "password_mismatch",
  password_mismatch: "password_mismatch",
  current_password_invalid: "current_password_invalid",
  invalid_token: "invalid_token",
  token_expired: "invalid_token",
  expired_token: "invalid_token",
  validation_error: "validation_failed",
  record_invalid: "validation_failed",
  unprocessable_entity: "validation_failed",
  rate_limited: "rate_limited",
  too_many_requests: "rate_limited",
};

/** Codes a UI is allowed to render a specific message for. */
export const ACCOUNT_FAILURE_CODES: readonly AccountAuthFailureCode[] = [
  ...new Set(Object.values(CODE_ALLOWLIST)),
  "capability_unavailable",
  "request_failed",
];

const SAFE_CODE_SHAPE = /^[a-z0-9_]{1,64}$/;

/**
 * Maps any thrown value to a safe code. Reads only the numeric `status` and a
 * code-shaped `code` property; `message`, `stack`, `cause` and every other
 * property are never inspected, so they cannot leak by construction.
 */
export function classifyAccountError(
  error: unknown,
  action: AccountAction,
): AccountAuthFailureCode {
  if (typeof error !== "object" || error === null) return "request_failed";
  const { status, code } = error as { status?: unknown; code?: unknown };

  if (typeof code === "string" && SAFE_CODE_SHAPE.test(code)) {
    const mapped = CODE_ALLOWLIST[code];
    if (mapped) return mapped;
  }
  if (status === 429) return "rate_limited";
  // A refused sign-in is the one place the status alone carries the meaning.
  if (action === "login" && (status === 401 || status === 403)) {
    return "invalid_credentials";
  }
  return "request_failed";
}
