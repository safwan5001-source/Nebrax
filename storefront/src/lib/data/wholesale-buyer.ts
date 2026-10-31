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
  type BuyerOrderDetail,
  type BuyerOrderSummary,
  buyerErrorKey,
  buyerFormErrorKey,
  buyerOrderDetailFromApi,
  buyerOrderSummaryFromApi,
  localePathFrom,
  type MembershipGateStatus,
  membershipGateStatusFromError,
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

/**
 * The buyer's own application. `companyName` / `contactPhone` are optional, UNVERIFIED context for the store's reviewer:
 * they decide nothing (no pricing, no linking, no eligibility). No partner, price list or identity is ever sent — the
 * backend refuses those outright and derives the buyer from the session.
 */
export async function applyForWholesale(details?: {
  companyName?: string;
  contactPhone?: string;
}): Promise<BuyerActionResult> {
  const token = await getBuyerToken();
  if (!token) return { success: false, error: "invalidCredentials" };
  const body: Record<string, string> = {};
  const company = details?.companyName?.trim();
  const phone = details?.contactPhone?.trim();
  if (company) body.company_name = company;
  if (phone) body.contact_phone = phone;
  try {
    await storefrontBuyerRequest("POST", "wholesale/application", {
      token,
      ...(Object.keys(body).length > 0 ? { body } : {}),
    });
    return { success: true };
  } catch (error) {
    // a 422 here is a field problem (bad phone / too-long company), not bad credentials
    if (error instanceof StorefrontApiError && error.status === 422) {
      return { success: false, error: "validation" };
    }
    return failure(error);
  }
}

/** Neutral by design: success whatever the address is (the API answers one 202 and mails only an eligible account). */
export async function requestBuyerPasswordReset(input: {
  email: string;
  basePath: string;
}): Promise<BuyerActionResult> {
  try {
    await storefrontBuyerRequest("POST", "auth/password/forgot", {
      body: { email: input.email, locale_path: localePathFrom(input.basePath) },
    });
    return { success: true };
  } catch (error) {
    return formFailure(error);
  }
}

/** Consumes the e-mailed token (bound to this store's tenant + channel, single use) and sets the new password. */
export async function resetBuyerPassword(input: {
  token: string;
  password: string;
}): Promise<BuyerActionResult> {
  try {
    await storefrontBuyerRequest("POST", "auth/password/reset", {
      body: { token: input.token, password: input.password },
    });
    // the backend ended every session of this account; drop this browser's cookie too
    await clearBuyerToken();
    return { success: true };
  } catch (error) {
    return formFailure(error);
  }
}

export type BuyerOrdersResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "signed_out" }
  | { kind: "not_approved"; membership: MembershipGateStatus | null }
  | { kind: "not_found" }
  | { kind: "unavailable" };

function ordersFailure(error: unknown): BuyerOrdersResult<never> {
  if (error instanceof StorefrontApiError) {
    if (error.status === 401) return { kind: "signed_out" };
    if (error.status === 403) {
      return {
        kind: "not_approved",
        membership: membershipGateStatusFromError(error),
      };
    }
    if (error.status === 404) return { kind: "not_found" };
  }
  return { kind: "unavailable" };
}

/** The approved buyer's own orders on this channel. Ownership is the server's (the verified session), never an id from here. */
export async function getBuyerOrders(page = 1): Promise<
  BuyerOrdersResult<{
    orders: BuyerOrderSummary[];
    page: number;
    lastPage: number;
  }>
> {
  const token = await getBuyerToken();
  if (!token) return { kind: "signed_out" };
  try {
    const response = await storefrontBuyerRequest<{
      data?: unknown[];
      meta?: { pagination?: { page?: number; last_page?: number } };
    }>("GET", `buyer/orders?page=${Math.max(1, Math.floor(page))}`, { token });
    const orders = (Array.isArray(response.data) ? response.data : [])
      .map(buyerOrderSummaryFromApi)
      .filter((order): order is BuyerOrderSummary => order !== null);
    return {
      kind: "ok",
      data: {
        orders,
        page: response.meta?.pagination?.page ?? 1,
        lastPage: response.meta?.pagination?.last_page ?? 1,
      },
    };
  } catch (error) {
    return ordersFailure(error);
  }
}

export async function getBuyerOrder(
  id: string,
): Promise<BuyerOrdersResult<BuyerOrderDetail>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { kind: "not_found" };
  const token = await getBuyerToken();
  if (!token) return { kind: "signed_out" };
  try {
    const response = await storefrontBuyerRequest<{
      data?: { order?: unknown };
    }>("GET", `buyer/orders/${id}`, { token });
    const order = buyerOrderDetailFromApi(response.data?.order);
    return order ? { kind: "ok", data: order } : { kind: "not_found" };
  } catch (error) {
    return ordersFailure(error);
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
