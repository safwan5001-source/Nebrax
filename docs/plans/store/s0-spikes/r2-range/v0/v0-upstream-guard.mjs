// V0 SPIKE — NOT production code. The proxy-side SSRF guard (reference implementation for V2) and the ONLY place in the harness that issues an outgoing HTTP request.
//
// A presigned URL is a bearer token and the signer's output is data from another process: a URL that points anywhere but the configured endpoint (a compromised or
// misconfigured signer, a bad S3_ENDPOINT/S3_BUCKET pairing, a Location echoed by a hostile server) must never be connected to — the TCP connect, the TLS handshake
// and the request line (which carries the signature in its query) all happen inside fetch(). So the allow-list is enforced HERE, before fetch() is called, for every
// request the probe and the isolated I9 experiment make, and redirects are never followed (a 3xx is only ever recorded; its Location is never requested).
//
// Refusals carry a reason code only — never the URL, its host or any part of the query.

// ───────────── the permitted hostname formats (review round 5, P2-B) ─────────────
// Exact, validated comparisons only — never a suffix test. A host is permitted if and only if it is
//   (1) the configured endpoint host, which must itself be an R2 S3 API endpoint — `<account>.r2.cloudflarestorage.com`, or the jurisdiction forms
//       `<account>.eu.r2.cloudflarestorage.com` / `<account>.fedramp.…` / `<account>.us.…` (Cloudflare's documented jurisdictions; ONE label for the account, so `evil.<account>.r2…` is not an endpoint) —
//       or, for the local self-test only (`allowInsecureLoopback`), the loopback IP / `localhost` the owner configured; or
//   (2) the virtual-hosted form `<bucket>.<endpoint host>`, for a bucket that is a valid DNS label (R2 bucket names: lowercase letters, digits, hyphens, ≤ 63, no leading/
//       trailing hyphen), never for an IP literal or `localhost`.
// The endpoint is owner configuration, but it is validated anyway: a mistyped or hostile S3_ENDPOINT must not turn the allow-list into "any host".
const R2_ENDPOINT_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.(?:eu|fedramp|us))?\.r2\.cloudflarestorage\.com$/;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const isLoopbackHost = (h) => h === '127.0.0.1' || h === 'localhost';

/** The exact hostnames a signed URL (or a redirect target) may have for this configuration; empty = the configuration itself is not acceptable (fail closed). */
export function permittedHostnames({ endpoint, bucket, allowInsecureLoopback = false }) {
  let e; try { e = new URL(endpoint); } catch { return []; }
  const base = e.hostname.toLowerCase();
  if (e.username || e.password) return [];
  if (!(R2_ENDPOINT_HOST.test(base) || (allowInsecureLoopback && isLoopbackHost(base)))) return [];
  const hosts = [base];
  if (typeof bucket === 'string' && DNS_LABEL.test(bucket.toLowerCase()) && !isLoopbackHost(base)) hosts.push(`${bucket.toLowerCase()}.${base}`);
  return hosts;
}

/** Host, port and userinfo of an already parsed URL against the configuration (scheme is the caller's concern). Exact string comparison on the parsed hostname. */
export function hostPortPermitted(u, policy) {
  let e; try { e = new URL(policy.endpoint); } catch { return false; }
  if (u.username || u.password) return false;
  if ((u.port || '') !== (e.port || '')) return false;
  return permittedHostnames(policy).includes(u.hostname.toLowerCase());
}

/** A signed URL may be fetched only if it is https (or http for the loopback self-test), carries no userinfo/port tricks, and its host is exactly one of
 *  {@link permittedHostnames}. Anything else is refused BEFORE a request is made. */
export function allowedUpstream(rawUrl, policy) {
  const { endpoint, allowInsecureLoopback = false } = policy;
  let u; let e;
  try { u = new URL(rawUrl); e = new URL(endpoint); } catch { return false; }
  const loopback = allowInsecureLoopback && isLoopbackHost(e.hostname);
  if (!(u.protocol === 'https:' || (loopback && u.protocol === 'http:'))) return false;
  if (u.protocol !== e.protocol) return false;
  return hostPortPermitted(u, policy);
}

export class UpstreamRefused extends Error {
  constructor(reason) { super(`upstream refused: ${reason}`); this.name = 'UpstreamRefused'; this.reason = reason; }
}

/**
 * fetch() behind the allow-list. `policy` = { endpoint, bucket, allowInsecureLoopback }.
 * `plainHttpProbe: true` is the single, labelled exception used by the informational I10 case (a deliberate plain-http request to the REAL endpoint host to see whether
 * it refuses or redirects): the URL must still satisfy every host/port/userinfo rule — only the scheme may be http.
 * `redirect` is always 'manual', whatever the caller passes.
 * @param {string} url  @param {RequestInit & {plainHttpProbe?: boolean}} init  @param {object} policy  @param {typeof fetch} [fetchImpl] injectable for tests
 */
export async function guardedFetch(url, init, policy, fetchImpl = globalThis.fetch) {
  const { plainHttpProbe = false, ...rest } = init ?? {};
  const asChecked = plainHttpProbe && typeof url === 'string' && /^http:/i.test(url) ? url.replace(/^http:/i, 'https:') : url;
  if (typeof url !== 'string' || !allowedUpstream(asChecked, { ...policy, allowInsecureLoopback: plainHttpProbe ? false : policy.allowInsecureLoopback })) throw new UpstreamRefused('host-not-allowed');
  return fetchImpl(url, { ...rest, redirect: 'manual' });
}
