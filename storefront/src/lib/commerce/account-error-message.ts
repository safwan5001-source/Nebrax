import {
  ACCOUNT_FAILURE_CODES,
  type AccountAuthFailureCode,
} from "@/lib/commerce/account-errors";

/**
 * Picks the localized copy for a failed account action. Only a code from the
 * closed allowlist selects a specific `accountErrors.<code>` message; anything
 * else (undefined, unknown, `request_failed`) uses the caller's own localized
 * fallback. Upstream text is never part of the decision.
 */
export function accountErrorMessage(
  code: string | undefined,
  specific: (code: AccountAuthFailureCode) => string,
  fallback: string,
): string {
  if (
    code &&
    code !== "request_failed" &&
    (ACCOUNT_FAILURE_CODES as readonly string[]).includes(code)
  ) {
    return specific(code as AccountAuthFailureCode);
  }
  return fallback;
}
