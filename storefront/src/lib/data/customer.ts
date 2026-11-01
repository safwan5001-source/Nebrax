"use server";

import { updateTag } from "next/cache";
import {
  clearAccountToken,
  getAccountToken,
  setAccountToken,
} from "@/lib/account/account-session";
import {
  type AccountAddress,
  type AccountCustomer,
  type AccountSession,
  type AddressInput,
  accountFailureCode,
  addressBody,
  addressFromApi,
  customerFromApi,
  joinDisplayName,
  sessionDaysFrom,
  sessionFromApi,
} from "@/lib/commerce/account";
import type { AccountAuthFailureCode } from "@/lib/commerce/account-errors";
import {
  StorefrontApiError,
  storefrontBuyerRequest,
} from "@/lib/commerce/config";
import { fetchStorefrontConfig } from "@/lib/commerce/storefront";
import {
  type BuyerOrderDetail,
  type BuyerOrderSummary,
  buyerOrderDetailFromApi,
  buyerOrderSummaryFromApi,
  localePathFrom,
} from "@/lib/commerce/wholesale-buyer";

/**
 * Native retail customer-account actions (B2C-ACCOUNTS) over the Host-resolved `store/v1` identity API.
 *
 * Identity is the backend's tenant-scoped `CustomerIdentity` (email + password, verified e-mail enforced server-side) —
 * the same authority the wholesale buyer flow uses, on a separate retail gate. This storefront stores no credentials and
 * decides no ownership or eligibility: it forwards, keeps the session token in an HttpOnly cookie
 * (`@/lib/account/account-session`), and renders what the API returns. Nothing here ever returns the token or any
 * upstream error text to the caller — failures are a closed set of codes the UI localizes. Whether accounts exist on this
 * host at all is the API's answer (`capabilities.customer_accounts`); when it is not `true` every action refuses with
 * `capability_unavailable` and the session provider never reads a session.
 */
export type { AccountAuthFailureCode } from "@/lib/commerce/account-errors";

export type AccountUser = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
};

const UNAVAILABLE = {
  success: false as const,
  code: "capability_unavailable" as const satisfies AccountAuthFailureCode,
};

function toUser(customer: AccountCustomer): AccountUser {
  return {
    id: customer.id,
    email: customer.email,
    first_name: customer.firstName,
    last_name: customer.lastName,
    phone: customer.phone,
  };
}

function fail(
  error: unknown,
  action: "login" | "form" = "form",
): { success: false; code: AccountAuthFailureCode } {
  const status = error instanceof StorefrontApiError ? error.status : undefined;
  return { success: false, code: accountFailureCode(status, action) };
}

/** Whether retail accounts are open on this host, per the API (fail closed on any doubt). */
export async function getAccountsAvailable(): Promise<boolean> {
  try {
    const config = await fetchStorefrontConfig();
    return config.capabilities?.customerAccounts === true;
  } catch {
    return false;
  }
}

async function readCustomer(token: string): Promise<AccountCustomer | null> {
  const response = await storefrontBuyerRequest<{
    data?: { customer?: unknown };
  }>("GET", "account/profile", { token });
  return customerFromApi(response.data?.customer);
}

/**
 * The current customer, or `null`. A rejected token (401: expired / revoked / signed out elsewhere) clears the cookie, so
 * the server layout and the client agree that the visitor is anonymous. A transient failure keeps the session (`stale`).
 */
export async function syncSession(): Promise<{
  available: boolean;
  customer: AccountUser | null;
  refreshed: boolean;
  stale?: boolean;
}> {
  const available = await getAccountsAvailable();
  if (!available) return { available, customer: null, refreshed: false };

  const token = await getAccountToken();
  if (!token) return { available, customer: null, refreshed: false };

  try {
    const customer = await readCustomer(token);
    return {
      available,
      customer: customer ? toUser(customer) : null,
      refreshed: false,
    };
  } catch (error) {
    if (
      error instanceof StorefrontApiError &&
      (error.status === 401 || error.status === 403 || error.status === 404)
    ) {
      // Cookie writes are not allowed during a Server Component render; a Server Action (this one) may.
      await clearAccountToken().catch(() => undefined);
      return { available, customer: null, refreshed: false };
    }
    return { available, customer: null, refreshed: false, stale: true };
  }
}

export async function getCustomer(): Promise<AccountUser | null> {
  const { customer } = await syncSession();
  return customer;
}

export async function login(
  email: string,
  password: string,
  remember = true,
): Promise<{
  success: boolean;
  user?: AccountUser;
  code?: AccountAuthFailureCode;
}> {
  if (!(await getAccountsAvailable())) return UNAVAILABLE;
  try {
    const response = await storefrontBuyerRequest<{
      data?: { token?: unknown; customer?: unknown; session_days?: unknown };
    }>("POST", "auth/login", { body: { email, password, remember } });
    const token = response.data?.token;
    const customer = customerFromApi(response.data?.customer);
    if (typeof token !== "string" || token === "" || !customer) {
      return { success: false, code: "request_failed" };
    }
    await setAccountToken(token, {
      remember,
      sessionDays: sessionDaysFrom(response.data?.session_days),
    });
    // The signed-in cart/orders now belong to the account: drop cached cart data.
    updateTag("customer");
    updateTag("cart");
    return { success: true, user: toUser(customer) };
  } catch (error) {
    return fail(error, "login");
  }
}

/**
 * Creates the (unverified) account. The API answers an identical 202 for a new and an existing address and e-mails the
 * verification link itself, so nothing here — and nothing the shopper sees — reveals which one happened. There is no
 * auto sign-in: the e-mail address must be verified first.
 */
export async function register(params: {
  email: string;
  password: string;
  password_confirmation?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  basePath?: string;
}): Promise<{
  success: boolean;
  verificationRequired?: boolean;
  code?: AccountAuthFailureCode;
}> {
  if (!(await getAccountsAvailable())) return UNAVAILABLE;
  if (
    params.password_confirmation !== undefined &&
    params.password_confirmation !== params.password
  ) {
    return { success: false, code: "password_mismatch" };
  }
  const displayName = joinDisplayName(params.first_name, params.last_name);
  if (displayName === "") return { success: false, code: "validation_failed" };
  try {
    await storefrontBuyerRequest("POST", "auth/register", {
      body: {
        display_name: displayName,
        email: params.email,
        password: params.password,
        ...(params.phone ? { phone: params.phone } : {}),
        ...(params.basePath && localePathFrom(params.basePath)
          ? { locale_path: localePathFrom(params.basePath) }
          : {}),
      },
    });
    return { success: true, verificationRequired: true };
  } catch (error) {
    return fail(error);
  }
}

/** Consumes the e-mailed token (bound by the API to this store's tenant + channel). One generic failure. */
export async function verifyEmail(
  token: string,
): Promise<{ success: boolean; code?: AccountAuthFailureCode }> {
  if (!(await getAccountsAvailable())) return UNAVAILABLE;
  try {
    await storefrontBuyerRequest("POST", "auth/verify-email", {
      body: { token },
    });
    return { success: true };
  } catch (error) {
    const result = fail(error);
    return result.code === "validation_failed"
      ? { success: false, code: "invalid_token" }
      : result;
  }
}

/** Neutral by design: success whatever the address is. */
export async function resendVerification(
  email: string,
  basePath?: string,
): Promise<{ success: boolean; code?: AccountAuthFailureCode }> {
  if (!(await getAccountsAvailable())) return UNAVAILABLE;
  try {
    await storefrontBuyerRequest("POST", "auth/verification/resend", {
      body: {
        email,
        ...(basePath && localePathFrom(basePath)
          ? { locale_path: localePathFrom(basePath) }
          : {}),
      },
    });
    return { success: true };
  } catch (error) {
    return fail(error);
  }
}

/** Sign out: revoke the session server-side (best effort), then always drop the cookie. */
export async function logout(): Promise<void> {
  const token = await getAccountToken();
  if (token) {
    await storefrontBuyerRequest("POST", "auth/logout", { token }).catch(
      () => undefined,
    );
  }
  await clearAccountToken();
  updateTag("customer");
  updateTag("cart");
}

/** Neutral by design: success whatever the address is. */
export async function requestPasswordReset(
  email: string,
  _redirectUrl?: string,
  basePath?: string,
): Promise<
  | { success: true; message?: string }
  | { success: false; code: AccountAuthFailureCode }
> {
  if (!(await getAccountsAvailable())) return UNAVAILABLE;
  try {
    await storefrontBuyerRequest("POST", "auth/password/forgot", {
      body: {
        email,
        ...(basePath && localePathFrom(basePath)
          ? { locale_path: localePathFrom(basePath) }
          : {}),
      },
    });
    return { success: true };
  } catch (error) {
    const result = fail(error);
    return { success: false, code: result.code };
  }
}

/** Consumes the e-mailed token (single use) and sets the new password; the API ends every session of the account. */
export async function resetPassword(
  token: string,
  password: string,
  passwordConfirmation?: string,
): Promise<{ success: boolean; code?: AccountAuthFailureCode }> {
  if (!(await getAccountsAvailable())) return UNAVAILABLE;
  if (passwordConfirmation !== undefined && passwordConfirmation !== password) {
    return { success: false, code: "password_mismatch" };
  }
  try {
    await storefrontBuyerRequest("POST", "auth/password/reset", {
      body: { token, password },
    });
    await clearAccountToken(); // the API ended every session; drop this browser's cookie too
    updateTag("customer");
    return { success: true };
  } catch (error) {
    const result = fail(error);
    return result.code === "validation_failed"
      ? { success: false, code: "invalid_token" }
      : result;
  }
}

// ───────────────────────────── authenticated actions ─────────────────────────────

export type AccountResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "signed_out" }
  | { kind: "not_found" }
  | { kind: "invalid"; code: AccountAuthFailureCode }
  | { kind: "unavailable" };

async function authed<T>(
  work: (token: string) => Promise<T>,
): Promise<AccountResult<T>> {
  const token = await getAccountToken();
  if (!token) return { kind: "signed_out" };
  try {
    return { kind: "ok", data: await work(token) };
  } catch (error) {
    if (error instanceof StorefrontApiError) {
      if (error.status === 401) {
        await clearAccountToken().catch(() => undefined);
        return { kind: "signed_out" };
      }
      if (error.status === 404) return { kind: "not_found" };
      if (error.status === 422 || error.status === 429) {
        return { kind: "invalid", code: fail(error).code };
      }
    }
    return { kind: "unavailable" };
  }
}

/** Name and phone only. The e-mail is the sign-in identifier and is not editable here. */
export async function updateProfile(input: {
  displayName?: string;
  phone?: string | null;
}): Promise<AccountResult<AccountUser>> {
  return authed(async (token) => {
    const body: Record<string, unknown> = {};
    if (input.displayName !== undefined)
      body.display_name = input.displayName.trim();
    if (input.phone !== undefined) {
      body.phone =
        input.phone === null || input.phone.trim() === ""
          ? null
          : input.phone.trim();
    }
    const response = await storefrontBuyerRequest<{
      data?: { customer?: unknown };
    }>("PATCH", "account/profile", { token, body });
    const customer = customerFromApi(response.data?.customer);
    if (!customer)
      throw new StorefrontApiError(502, "bad_response", "bad response");
    updateTag("customer");
    return toUser(customer);
  });
}

/** Legacy shape kept for the profile form's callers. */
export async function updateCustomer(data: {
  first_name?: string;
  last_name?: string;
  phone?: string;
}): Promise<{ success: boolean; code?: AccountAuthFailureCode }> {
  const name = joinDisplayName(data.first_name, data.last_name);
  const result = await updateProfile({
    ...(name ? { displayName: name } : {}),
    ...(data.phone !== undefined ? { phone: data.phone } : {}),
  });
  if (result.kind === "ok") return { success: true };
  return {
    success: false,
    code: result.kind === "invalid" ? result.code : "request_failed",
  };
}

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<AccountResult<true>> {
  const result = await authed(async (token) => {
    await storefrontBuyerRequest("PUT", "account/password", {
      token,
      body: {
        current_password: input.currentPassword,
        password: input.newPassword,
      },
    });
    return true as const;
  });
  return result;
}

export async function listAddresses(): Promise<
  AccountResult<AccountAddress[]>
> {
  return authed(async (token) => {
    const response = await storefrontBuyerRequest<{
      data?: { data?: unknown[] };
    }>("GET", "account/addresses", { token });
    const rows = Array.isArray(response.data?.data) ? response.data.data : [];
    return rows
      .map(addressFromApi)
      .filter((a): a is AccountAddress => a !== null);
  });
}

export async function saveAddress(
  input: AddressInput,
  id?: string,
): Promise<AccountResult<AccountAddress>> {
  if (id !== undefined && !/^[0-9a-f-]{36}$/i.test(id))
    return { kind: "not_found" };
  return authed(async (token) => {
    const body = addressBody(input);
    const response = await storefrontBuyerRequest<{ data?: unknown }>(
      id ? "PATCH" : "POST",
      id ? `account/addresses/${id}` : "account/addresses",
      { token, body },
    );
    const address = addressFromApi(response.data);
    if (!address)
      throw new StorefrontApiError(502, "bad_response", "bad response");
    return address;
  });
}

export async function deleteAddress(id: string): Promise<AccountResult<true>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { kind: "not_found" };
  return authed(async (token) => {
    await storefrontBuyerRequest("DELETE", `account/addresses/${id}`, {
      token,
    });
    return true as const;
  });
}

/** The signed-in customer's own orders on this store. Ownership is the server's (the verified session), never an id from here. */
export async function listOrders(page = 1): Promise<
  AccountResult<{
    orders: BuyerOrderSummary[];
    page: number;
    lastPage: number;
  }>
> {
  return authed(async (token) => {
    const response = await storefrontBuyerRequest<{
      data?: unknown[];
      meta?: { pagination?: { page?: number; last_page?: number } };
    }>("GET", `account/orders?page=${Math.max(1, Math.floor(page))}`, {
      token,
    });
    return {
      orders: (Array.isArray(response.data) ? response.data : [])
        .map(buyerOrderSummaryFromApi)
        .filter((o): o is BuyerOrderSummary => o !== null),
      page: response.meta?.pagination?.page ?? 1,
      lastPage: response.meta?.pagination?.last_page ?? 1,
    };
  });
}

export async function getOrder(
  id: string,
): Promise<AccountResult<BuyerOrderDetail>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { kind: "not_found" };
  return authed(async (token) => {
    const response = await storefrontBuyerRequest<{
      data?: { order?: unknown };
    }>("GET", `account/orders/${id}`, { token });
    const order = buyerOrderDetailFromApi(response.data?.order);
    if (!order) throw new StorefrontApiError(404, "not_found", "not found");
    return order;
  });
}

/**
 * Links a guest order to this account. Proof is server-side: the signed order reference (when the shopper still has it)
 * or a VERIFIED account e-mail equal to the order's e-mail. Any failure is one uniform "could not be linked".
 */
export async function claimOrder(input: {
  orderNumber: string;
  orderReference?: string | null;
}): Promise<AccountResult<BuyerOrderSummary>> {
  const number = input.orderNumber.trim();
  if (number === "" || number.length > 64) return { kind: "not_found" };
  const result = await authed(async (token) => {
    const response = await storefrontBuyerRequest<{
      data?: { order?: unknown };
    }>("POST", "account/orders/claim", {
      token,
      body: {
        order_number: number,
        ...(input.orderReference
          ? { order_reference: input.orderReference }
          : {}),
      },
    });
    const order = buyerOrderSummaryFromApi(response.data?.order);
    if (!order) throw new StorefrontApiError(404, "not_found", "not found");
    return order;
  });
  if (result.kind === "ok") updateTag("customer");
  return result;
}

export async function listSessions(): Promise<AccountResult<AccountSession[]>> {
  return authed(async (token) => {
    const response = await storefrontBuyerRequest<{
      data?: { sessions?: unknown[] };
    }>("GET", "account/sessions", { token });
    const rows = Array.isArray(response.data?.sessions)
      ? response.data.sessions
      : [];
    return rows
      .map(sessionFromApi)
      .filter((s): s is AccountSession => s !== null);
  });
}

export async function revokeSession(id: string): Promise<AccountResult<true>> {
  if (!/^\d{1,20}$/.test(id)) return { kind: "not_found" };
  return authed(async (token) => {
    await storefrontBuyerRequest("DELETE", `account/sessions/${id}`, { token });
    return true as const;
  });
}

export async function revokeOtherSessions(): Promise<AccountResult<true>> {
  return authed(async (token) => {
    await storefrontBuyerRequest("DELETE", "account/sessions", { token });
    return true as const;
  });
}
