/**
 * B2C ACTIVATION READINESS — signed visitor-address attestation for the storefront → AWJ API auth calls.
 *
 * Every shopper reaches the AWJ API from this server's address, so the API's per-IP auth brakes collapse into one
 * store-wide bucket. The API can prove the caller is this server (gateway secret) but cannot know whether the address this
 * server saw is the visitor's: that depends on the edge chain in front of it (Vercel / Railway / CDN). So:
 *
 *  - Nothing is attested unless the OPERATOR names the trusted source in `STOREFRONT_CLIENT_IP_SOURCE`
 *    (default: unset ⇒ nothing is sent and the API keeps its legacy behaviour byte for byte).
 *  - A generic `X-Forwarded-For` is never taken at face value: the only XFF mode counts hops from the RIGHT
 *    (`xff-right:N`) because proxies append, so anything a visitor writes sits on the left and is never read.
 *  - Private / loopback / link-local / unparseable values are discarded (a misconfigured source would otherwise put every
 *    visitor into one bucket and look like it works).
 *  - The address is signed (HMAC-SHA256, key derived from the gateway secret) together with the forwarded host and a
 *    timestamp, so it cannot be moved to another store or replayed later. Verification lives in
 *    `App\Support\StorefrontClientIdentity` on the API; the two encodings are pinned by a shared test vector.
 *
 * Server-only: never imported by client components.
 */
import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export const CLIENT_IP_HEADER = "X-Storefront-Client-Ip";
export const CLIENT_IP_TIMESTAMP_HEADER = "X-Storefront-Client-Ip-Ts";
export const CLIENT_IP_SIGNATURE_HEADER = "X-Storefront-Client-Ip-Sig";

type HeaderReader = { get(name: string): string | null };

/** Same derivation as the API: a domain-separated subkey, then HMAC over host, address and timestamp. */
export function signClientIp(
  gatewaySecret: string,
  forwardedHost: string,
  ip: string,
  timestamp: number,
): string {
  const key = createHmac("sha256", gatewaySecret)
    .update("awj-storefront-client-ip.v1")
    .digest("hex");
  return createHmac("sha256", key)
    .update(
      ["awj-client-ip.v1", forwardedHost, ip, String(timestamp)].join("\n"),
    )
    .digest("hex");
}

function isPublicIp(value: string): boolean {
  const kind = isIP(value);
  if (kind === 4) {
    const [a, b] = value.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    return true;
  }
  if (kind === 6) {
    const v = value.toLowerCase();
    if (v === "::" || v === "::1") return false;
    if (v.startsWith("fe80:") || v.startsWith("fc") || v.startsWith("fd")) {
      return false;
    }
    if (v.startsWith("::ffff:")) return isPublicIp(v.slice(7)); // v4-mapped
    return true;
  }
  return false;
}

/**
 * The visitor address from the operator-declared trusted source, or null.
 * Sources: `vercel` (x-vercel-forwarded-for, set by Vercel's edge), `real-ip` (x-real-ip set by a single trusted proxy),
 * `xff-right:N` (N-th entry from the right of x-forwarded-for; N = number of trusted proxies that each append one hop).
 */
export function trustedClientIp(
  source: string | undefined,
  headers: HeaderReader,
): string | null {
  const mode = (source ?? "").trim().toLowerCase();
  let candidate: string | null = null;

  if (mode === "vercel") {
    candidate = headers.get("x-vercel-forwarded-for");
  } else if (mode === "real-ip") {
    candidate = headers.get("x-real-ip");
  } else {
    const match = /^xff-right:([1-9])$/.exec(mode);
    if (match) {
      const parts = (headers.get("x-forwarded-for") ?? "")
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      candidate = parts[parts.length - Number(match[1])] ?? null;
    }
  }

  if (!candidate) return null;
  const value = candidate.split(",")[0].trim();
  return isPublicIp(value) ? value : null;
}

/** Headers to add to an auth call, or `{}` when no trusted source is configured / resolvable. Never throws. */
export function clientIpAttestation(
  secret: string | undefined,
  forwardedHost: string,
  headers: HeaderReader,
  nowMs: number = Date.now(),
): Record<string, string> {
  if (!secret) return {};
  const ip = trustedClientIp(process.env.STOREFRONT_CLIENT_IP_SOURCE, headers);
  if (!ip) return {};
  const timestamp = Math.floor(nowMs / 1000);
  return {
    [CLIENT_IP_HEADER]: ip,
    [CLIENT_IP_TIMESTAMP_HEADER]: String(timestamp),
    [CLIENT_IP_SIGNATURE_HEADER]: signClientIp(
      secret,
      forwardedHost,
      ip,
      timestamp,
    ),
  };
}
