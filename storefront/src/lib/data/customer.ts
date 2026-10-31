"use server";

import { updateTag } from "next/cache";
import { cookies } from "next/headers";
import {
  ACCOUNT_REFRESH_COOKIE,
  ACCOUNT_SESSION_COOKIE,
  LEGACY_BROWSER_COOKIES,
} from "@/lib/account/session-cookies";
import type { AccountAuthFailureCode } from "@/lib/commerce/account-errors";
import type { StoreCustomer } from "@/lib/commerce/types";

/**
 * Buyer account actions — gated (SPREE-X1, closed out by the final Spree exit).
 *
 * `store/v1` is anonymous by design (ADR-24) and carries no shopper identity, so there is NO buyer-identity service
 * behind these actions yet (the contract is tracked as B1–B4: a `store/v1` customer session — register / login /
 * logout / me — plus verification and recovery delivery and profile update). The Spree client that used to sit here
 * had no backend in any AWJ environment and has been removed with the rest of `lib/spree`.
 *
 * So every action REFUSES with the typed `capability_unavailable` code, regardless of `ACCOUNT_AUTH_CAPABILITY`:
 * flipping that constant to `live` without a real implementation cannot make an action pretend to authenticate or send
 * a shopper's credentials anywhere. The screens keep rendering the honest "not available" notice instead of a form.
 * When the buyer-identity contract lands, implement these functions against it; their signatures are the UI contract.
 */
export type { AccountAuthFailureCode } from "@/lib/commerce/account-errors";

const UNAVAILABLE = {
  success: false as const,
  code: "capability_unavailable" as const satisfies AccountAuthFailureCode,
};

/** The current customer. Always `null`: there is no buyer session to read. */
export async function getCustomer(): Promise<StoreCustomer | null> {
  return null;
}

/** Reconcile the customer session on the client. Always anonymous: there is no session. */
export async function syncSession(): Promise<{
  customer: StoreCustomer | null;
  refreshed: boolean;
  stale?: boolean;
}> {
  return { customer: null, refreshed: false };
}

export async function login(
  _email: string,
  _password: string,
): Promise<{
  success: boolean;
  user?: {
    id: string;
    email: string;
    first_name?: string | null;
    last_name?: string | null;
  };
  code?: AccountAuthFailureCode;
}> {
  return UNAVAILABLE;
}

export async function register(_params: {
  email: string;
  password: string;
  password_confirmation: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  /** Arbitrary key-value data stored on the customer (e.g. wholesale company). */
  metadata?: Record<string, unknown>;
}): Promise<{
  success: boolean;
  user?: {
    id: string;
    email: string;
    first_name?: string | null;
    last_name?: string | null;
  };
  code?: AccountAuthFailureCode;
}> {
  return UNAVAILABLE;
}

/**
 * Sign out: expire the account-session cookies (and any cookie an earlier, removed integration left in the browser).
 * There is no server session to revoke.
 */
export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  for (const name of [
    ACCOUNT_SESSION_COOKIE,
    ACCOUNT_REFRESH_COOKIE,
    ...LEGACY_BROWSER_COOKIES,
  ]) {
    cookieStore.set(name, "", { path: "/", maxAge: 0 });
  }
  updateTag("customer");
  updateTag("cart");
}

export async function requestPasswordReset(
  _email: string,
  _redirectUrl?: string,
): Promise<
  | { success: true; message?: string }
  | { success: false; code: AccountAuthFailureCode }
> {
  return UNAVAILABLE;
}

export async function resetPassword(
  _token: string,
  _password: string,
  _passwordConfirmation: string,
): Promise<{
  success: boolean;
  code?: AccountAuthFailureCode;
}> {
  return UNAVAILABLE;
}

export async function updateCustomer(_data: {
  first_name?: string;
  last_name?: string;
  email?: string;
  current_password?: string;
}): Promise<{
  success: boolean;
  customer?: StoreCustomer;
  code?: AccountAuthFailureCode;
}> {
  return UNAVAILABLE;
}
