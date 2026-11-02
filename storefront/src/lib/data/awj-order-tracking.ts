"use server";

import { StorefrontApiError } from "@/lib/commerce/config";
import {
  fetchAwjOrderTracking,
  issueAwjTrackingLink,
  type StorefrontOrderTracking,
} from "@/lib/commerce/order-tracking";

/**
 * COPS-H2-5 — server actions for guest order tracking. The server does the HTTP; the client sees only a plain result.
 * Both the order reference and the tracking token are credentials: never logged, never put in a query string.
 */
export type TrackingFailure = "not_found" | "rate_limited" | "error";

export type TrackingResult =
  | { success: true; tracking: StorefrontOrderTracking }
  | { success: false; reason: TrackingFailure };

export type TrackingLinkResult =
  | { success: true; token: string; expiresAt: string | null }
  | { success: false };

export async function getOrderTrackingAction(
  token: string,
): Promise<TrackingResult> {
  try {
    return { success: true, tracking: await fetchAwjOrderTracking(token) };
  } catch (error) {
    if (error instanceof StorefrontApiError) {
      if (error.status === 429)
        return { success: false, reason: "rate_limited" };
      if (error.status === 404) return { success: false, reason: "not_found" };
    }
    return { success: false, reason: "error" };
  }
}

/** Any failure — including the gate being closed (404) — is just "no link": the confirmation stays exactly as it was. */
export async function issueTrackingLinkAction(
  orderId: string,
  orderReference: string,
): Promise<TrackingLinkResult> {
  try {
    const link = await issueAwjTrackingLink(orderId, orderReference);
    return { success: true, token: link.token, expiresAt: link.expiresAt };
  } catch {
    return { success: false };
  }
}
