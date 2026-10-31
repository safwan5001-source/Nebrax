"use server";

import { updateTag } from "next/cache";
import {
  clearBuyerToken,
  getBuyerToken,
  setBuyerToken,
} from "@/lib/commerce/buyer-session";
import {
  StorefrontApiError,
  storefrontBuyerRequest,
  storefrontCartRequest,
} from "@/lib/commerce/config";
import {
  failuresFromError,
  QUICK_ORDER_MAX_LINES,
  type QuickOrderFailure,
  type QuickOrderLine,
  type QuickOrderSubmitItem,
  quickOrderLineFromApi,
} from "@/lib/commerce/quick-order";
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

// ───────────────────────── native Quick Order (H6) ─────────────────────────

export type QuickOrderAccess =
  | { kind: "signed_out" }
  | { kind: "not_approved"; membership: MembershipGateStatus | null }
  | { kind: "unavailable" };

function quickOrderAccess(error: unknown): QuickOrderAccess {
  if (error instanceof StorefrontApiError) {
    if (error.status === 401) return { kind: "signed_out" };
    if (error.status === 403) {
      return {
        kind: "not_approved",
        membership: membershipGateStatusFromError(error),
      };
    }
  }
  return { kind: "unavailable" };
}

/**
 * Free-text search (SKU or name, including variant SKUs) for the quick-order picker. Resolved and priced by the server for the
 * signed-in buyer on this channel; a line with no approved wholesale price comes back unavailable with no price.
 */
export async function searchQuickOrder(
  term: string,
): Promise<{ kind: "ok"; lines: QuickOrderLine[] } | QuickOrderAccess> {
  const q = term.trim().slice(0, 120);
  if (q === "") return { kind: "ok", lines: [] };
  const token = await getBuyerToken();
  if (!token) return { kind: "signed_out" };
  try {
    const response = await storefrontBuyerRequest<{ data?: unknown[] }>(
      "GET",
      `buyer/quick-order/lookup?q=${encodeURIComponent(q)}&limit=10`,
      { token },
    );
    return {
      kind: "ok",
      lines: (Array.isArray(response.data) ? response.data : [])
        .map(quickOrderLineFromApi)
        .filter((l): l is QuickOrderLine => l !== null),
    };
  } catch (error) {
    return quickOrderAccess(error);
  }
}

/** The catalogue's SKU length limit (product and variant requests). */
const MAX_SKU_LENGTH = 255;

export type QuickOrderResolvedRow = { sku: string; lines: QuickOrderLine[] };

/** Exact-SKU resolution of a pasted list (one request). Order and spelling of the input are preserved. */
export async function resolveQuickOrderSkus(
  skus: string[],
): Promise<{ kind: "ok"; rows: QuickOrderResolvedRow[] } | QuickOrderAccess> {
  const trimmed = skus
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .slice(0, QUICK_ORDER_MAX_LINES);
  if (trimmed.length === 0) return { kind: "ok", rows: [] };
  // A SKU longer than the catalogue allows (255) cannot exist: report it as "not found" in its own position instead of
  // truncating it into a different, valid identifier.
  const resolvable = trimmed.filter((s) => s.length <= MAX_SKU_LENGTH);
  const token = await getBuyerToken();
  if (!token) return { kind: "signed_out" };
  try {
    let fetched: QuickOrderResolvedRow[] = [];
    if (resolvable.length > 0) {
      const query = resolvable
        .map((s) => `skus[]=${encodeURIComponent(s)}`)
        .join("&");
      const response = await storefrontBuyerRequest<{ data?: unknown[] }>(
        "GET",
        `buyer/quick-order/resolve?${query}`,
        { token },
      );
      fetched = (Array.isArray(response.data) ? response.data : []).flatMap(
        (raw) => {
          const r = raw as { sku?: unknown; lines?: unknown };
          if (typeof r?.sku !== "string") return [];
          return [
            {
              sku: r.sku,
              lines: (Array.isArray(r.lines) ? r.lines : [])
                .map(quickOrderLineFromApi)
                .filter((l): l is QuickOrderLine => l !== null),
            },
          ];
        },
      );
    }
    let next = 0;
    const rows: QuickOrderResolvedRow[] = trimmed.map((sku) =>
      sku.length > MAX_SKU_LENGTH
        ? { sku, lines: [] }
        : (fetched[next++] ?? { sku, lines: [] }),
    );
    return { kind: "ok", rows };
  } catch (error) {
    return quickOrderAccess(error);
  }
}

export type QuickOrderAddResult =
  | { kind: "ok" }
  | { kind: "rejected"; failures: QuickOrderFailure[] }
  | QuickOrderAccess;

/**
 * All-or-nothing: the server adds every line to the buyer's cart or none. Only ids, unit and quantity leave the browser —
 * the price is the server's, resolved again for every line, and again at checkout. Re-submitting adds the quantities again
 * (the cart merges identical lines), so the caller disables the button while a request is in flight.
 */
export async function addQuickOrderLines(
  items: QuickOrderSubmitItem[],
): Promise<QuickOrderAddResult> {
  if (items.length === 0 || items.length > QUICK_ORDER_MAX_LINES) {
    return { kind: "unavailable" };
  }
  const token = await getBuyerToken();
  if (!token) return { kind: "signed_out" };
  try {
    await storefrontCartRequest("POST", "buyer/quick-order/add", { items });
    updateTag("cart");
    return { kind: "ok" };
  } catch (error) {
    const failures = failuresFromError(error);
    if (failures !== null) return { kind: "rejected", failures };
    return quickOrderAccess(error);
  }
}
