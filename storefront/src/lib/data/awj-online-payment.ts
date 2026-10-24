"use server";

import { StorefrontApiError } from "@/lib/commerce/config";
import {
  type AwjOnlinePayment,
  fetchAwjOnlinePaymentStatus,
  startAwjOnlinePayment,
} from "@/lib/commerce/online-payment";

/**
 * PAY-H4-04a — server actions for the online-payment journey. Same convention
 * as `awj-checkout.ts`: the server does the HTTP, the client only ever sees a
 * plain result. The order reference is a credential the *client* holds and
 * passes through; it is never logged and never put in a URL.
 */

/** Why a payment call failed, reduced to what the UI can act on. */
export type OnlinePaymentFailure =
  /** Unknown order / wrong reference — the uniform 404. Nothing more is revealed. */
  | "not_found"
  /** The gateway is unavailable right now (platform off, gateway not ready). */
  | "unavailable"
  /** The provider could not be reached; trying again shortly may work. */
  | "provider_unavailable"
  /** The order can no longer be paid (cancelled, already paid elsewhere). */
  | "not_payable"
  | "error";

export type OnlinePaymentResult =
  | { success: true; payment: AwjOnlinePayment }
  | { success: false; reason: OnlinePaymentFailure };

function failureReason(error: unknown): OnlinePaymentFailure {
  if (error instanceof StorefrontApiError) {
    switch (error.code) {
      case "not_found":
        return "not_found";
      case "payment_unavailable":
        return "unavailable";
      case "payment_provider_unavailable":
        return "provider_unavailable";
      case "payment_not_payable":
        return "not_payable";
      default:
        return error.status === 404 ? "not_found" : "error";
    }
  }
  return "error";
}

export async function startOnlinePaymentAction(
  orderId: string,
  orderReference: string,
): Promise<OnlinePaymentResult> {
  try {
    return {
      success: true,
      payment: await startAwjOnlinePayment(orderId, orderReference),
    };
  } catch (error) {
    return { success: false, reason: failureReason(error) };
  }
}

export async function getOnlinePaymentStatusAction(
  orderId: string,
  orderReference: string,
): Promise<OnlinePaymentResult> {
  try {
    return {
      success: true,
      payment: await fetchAwjOnlinePaymentStatus(orderId, orderReference),
    };
  } catch (error) {
    return { success: false, reason: failureReason(error) };
  }
}
