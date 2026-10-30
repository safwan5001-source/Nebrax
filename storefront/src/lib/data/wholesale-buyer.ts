"use server";

import {
  clearBuyerToken,
  getBuyerToken,
  setBuyerToken,
} from "@/lib/commerce/buyer-session";
import {
  StorefrontApiError,
  storefrontBuyerRequest,
} from "@/lib/commerce/config";
import {
  accessStateFromMembership,
  type BuyerAccessState,
  type BuyerErrorKey,
  buyerErrorKey,
  buyerFormErrorKey,
  localePathFrom,
} from "@/lib/commerce/wholesale-buyer";

/**
 * Wholesale buyer actions (H6 Batch G) over the existing `store/v1` buyer API.
 * Identity is the backend's `CustomerIdentity` (email + password, verified
 * email enforced server-side) — this storefront neither stores credentials nor
 * decides eligibility; it forwards, keeps the session token in an HttpOnly
 * cookie, and renders the status the API returns. Nothing here returns the
 * token to the caller.
 */

export type BuyerActionResult =
  | { success: true }
  | { success: false; error: BuyerErrorKey };

function failure(error: unknown): BuyerActionResult {
  if (error instanceof StorefrontApiError) {
    return { success: false, error: buyerErrorKey(error.status, error.code) };
  }
  return { success: false, error: "generic" };
}

export async function signInBuyer(
  email: string,
  password: string,
): Promise<BuyerActionResult> {
  try {
    const response = await storefrontBuyerRequest<{
      data?: { token?: unknown };
    }>("POST", "auth/login", { body: { email, password } });
    const token = response.data?.token;
    if (typeof token !== "string" || token === "") {
      return { success: false, error: "generic" };
    }
    await setBuyerToken(token);
    return { success: true };
  } catch (error) {
    return failure(error);
  }
}

function formFailure(error: unknown): BuyerActionResult {
  if (error instanceof StorefrontApiError) {
    return { success: false, error: buyerFormErrorKey(error.status) };
  }
  return { success: false, error: "generic" };
}

/**
 * Creates the buyer identity (unverified). The API answers an identical 202 for a new and an existing address and sends
 * the verification e-mail itself; nothing here reveals which one happened.
 */
export async function registerBuyer(input: {
  displayName: string;
  email: string;
  password: string;
  basePath: string;
}): Promise<BuyerActionResult> {
  try {
    await storefrontBuyerRequest("POST", "auth/register", {
      body: {
        display_name: input.displayName,
        email: input.email,
        password: input.password,
        locale_path: localePathFrom(input.basePath),
      },
    });
    return { success: true };
  } catch (error) {
    return formFailure(error);
  }
}

/** Consumes the e-mailed token (the API binds it to this store's tenant + channel). One generic failure. */
export async function verifyBuyerEmail(
  token: string,
): Promise<BuyerActionResult> {
  try {
    await storefrontBuyerRequest("POST", "auth/verify-email", {
      body: { token },
    });
    return { success: true };
  } catch (error) {
    return formFailure(error);
  }
}

/** Neutral by design: success whatever the address is. */
export async function resendBuyerVerification(input: {
  email: string;
  basePath: string;
}): Promise<BuyerActionResult> {
  try {
    await storefrontBuyerRequest("POST", "auth/verification/resend", {
      body: { email: input.email, locale_path: localePathFrom(input.basePath) },
    });
    return { success: true };
  } catch (error) {
    return formFailure(error);
  }
}

export async function signOutBuyer(): Promise<void> {
  const token = await getBuyerToken();
  if (token) {
    // Best effort: revoke the session server-side, then always drop the cookie.
    await storefrontBuyerRequest("POST", "auth/logout", { token }).catch(
      () => undefined,
    );
  }
  await clearBuyerToken();
}

export async function applyForWholesale(): Promise<BuyerActionResult> {
  const token = await getBuyerToken();
  if (!token) return { success: false, error: "invalidCredentials" };
  try {
    await storefrontBuyerRequest("POST", "wholesale/application", { token });
    return { success: true };
  } catch (error) {
    return failure(error);
  }
}

/**
 * The visitor's current standing on this wholesale host. Never throws and never
 * exposes the token: a missing/expired session is `signed_out`; a host that does
 * not offer wholesale (backend gate off or not a wholesale channel → 404) is
 * `unavailable`.
 */
export async function getBuyerAccess(): Promise<{
  state: BuyerAccessState;
  displayName: string | null;
}> {
  const token = await getBuyerToken();
  if (!token) return { state: "signed_out", displayName: null };

  try {
    const me = await storefrontBuyerRequest<{
      data?: { customer?: { display_name?: unknown; name?: unknown } };
    }>("GET", "me", { token });
    const customer = me.data?.customer;
    const name =
      typeof customer?.display_name === "string"
        ? customer.display_name
        : typeof customer?.name === "string"
          ? customer.name
          : null;

    const membership = await storefrontBuyerRequest<{
      data?: { membership?: { status?: unknown } | null };
    }>("GET", "wholesale/membership", { token });

    return {
      state: accessStateFromMembership(membership.data?.membership ?? null),
      displayName: name,
    };
  } catch (error) {
    if (error instanceof StorefrontApiError) {
      if (error.status === 401)
        return { state: "signed_out", displayName: null };
      if (error.status === 404)
        return { state: "unavailable", displayName: null };
    }
    return { state: "unavailable", displayName: null };
  }
}
