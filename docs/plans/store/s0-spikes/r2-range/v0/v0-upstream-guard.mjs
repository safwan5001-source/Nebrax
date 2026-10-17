// V0 SPIKE — NOT production code. The proxy-side SSRF guard (reference implementation for V2) and the ONLY place in the harness that issues an outgoing HTTP request.
//
// A presigned URL is a bearer token and the signer's output is data from another process: a URL that points anywhere but the configured endpoint (a compromised or
// misconfigured signer, a bad S3_ENDPOINT/S3_BUCKET pairing, a Location echoed by a hostile server) must never be connected to — the TCP connect, the TLS handshake
// and the request line (which carries the signature in its query) all happen inside fetch(). So the allow-list is enforced HERE, before fetch() is called, for every
// request the probe and the isolated I9 experiment make, and redirects are never followed (a 3xx is only ever recorded; its Location is never requested).
//
// Refusals carry a reason code only — never the URL, its host or any part of the query.

/** A signed URL may be fetched only if it is https (or http for the loopback self-test), carries no userinfo/port tricks, and its host is exactly the configured endpoint
 *  host or `<bucket>.<endpoint host>`. Anything else is refused BEFORE a request is made. */
export function allowedUpstream(rawUrl, { endpoint, bucket, allowInsecureLoopback = false }) {
  let u; let e;
  try { u = new URL(rawUrl); e = new URL(endpoint); } catch { return false; }
  if (u.username || u.password) return false;
  const loopback = allowInsecureLoopback && (e.hostname === '127.0.0.1' || e.hostname === 'localhost');
  if (!(u.protocol === 'https:' || (loopback && u.protocol === 'http:'))) return false;
  if (u.protocol !== e.protocol) return false;
  if ((u.port || '') !== (e.port || '')) return false;
  const host = u.hostname.toLowerCase();
  const base = e.hostname.toLowerCase();
  return host === base || host === `${bucket.toLowerCase()}.${base}`;
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
