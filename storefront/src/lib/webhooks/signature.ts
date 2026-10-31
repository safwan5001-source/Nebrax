import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The inbound webhook envelope (the `{id, name, created_at, data, metadata}` shape the endpoint has always accepted).
 * Owned here so the endpoint has no third-party SDK dependency.
 */
export interface WebhookEvent<T = unknown> {
  id: string;
  name: string;
  created_at: string;
  data: T;
  metadata: {
    spree_version: string;
  };
}

/**
 * Verifies the HMAC-SHA256 signature of a webhook request: `HMAC-SHA256(secret, "{timestamp}.{payload}")`, hex-encoded,
 * compared in constant time, with a replay window on the (seconds-since-epoch) timestamp (default 300 s, both
 * directions).
 *
 * Behaviour-for-behaviour port of the vendor SDK's `verifyWebhookSignature` (v1.2.1) that this endpoint used before
 * the SDK was removed. `signature.test.ts` pins its outcomes (valid, edge of tolerance, too old / too new, wrong
 * secret, tampered body, non-numeric / empty timestamp, short / empty / upper-case signature) as recorded from the
 * SDK, so the verification contract did not change.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  timestamp: string,
  secret: string,
  toleranceSeconds = 300,
): boolean {
  const ts = Number.parseInt(timestamp, 10);
  if (Number.isNaN(ts)) return false;
  const age = Math.abs(Math.floor(Date.now() / 1e3) - ts);
  if (age > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    // Different lengths make timingSafeEqual throw — that is a mismatch, not an error.
    return false;
  }
}
