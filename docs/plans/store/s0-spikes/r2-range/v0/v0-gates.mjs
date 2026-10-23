import { hostPortPermitted } from './v0-upstream-guard.mjs';
// V0 SPIKE — NOT production code. The pass/fail LOGIC of the three gates that review found too weak, kept free of I/O so it can be unit-tested
// (v0-gates.test.mjs) and re-run against the pre-fix behaviour (regression/legacy-gates.mjs). The probe feeds these functions; it never prints what they scan.
//
// Nothing here ever returns a header VALUE, a signed URL, a signature or a credential — findings carry only the header name and a kind label.

/** Secrets and signed-URL parts that must never appear in anything the provider sends back. `urls` are every URL the probe requested (signed, derived or tampered). */
export function sensitiveTokens({ secrets = [], urls = [] }) {
  const out = [];
  const add = (kind, value) => {
    if (typeof value !== 'string' || value.length < 6) return;
    for (const v of new Set([value, encodeURIComponent(value), safeDecode(value)])) if (v.length >= 6) out.push({ kind, value: v.toLowerCase() });
  };
  for (const s of secrets) add('credential', s);
  for (const raw of urls) {
    add('signed-url', raw);
    let u; try { u = new URL(raw); } catch { continue; }
    add('signed-url-query', u.search.replace(/^\?/, ''));
    for (const [k, v] of u.searchParams) {
      const name = k.toLowerCase();
      if (name === 'x-amz-signature') add('signature', v);
      else if (name === 'x-amz-credential') add('credential-scope', v);
      else if (name === 'x-amz-security-token') add('session-token', v);
    }
  }
  return out;
}
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

// Parameters/algorithm markers that identify a presigned URL or SigV4 material even when the exact token was not known in advance.
const GENERIC = [
  [/x-amz-(signature|credential|security-token)=/i, 'signed-url-parameter'],
  [/aws4-hmac-sha256/i, 'sigv4-material'],
];

/**
 * Scans header VALUES (all headers, not just a whitelist). `entries` = [[name, value], …] exactly as received.
 * @returns {{header: string, kind: string}[]} names + kinds only
 */
export function scanHeaderValues(entries, tokens) {
  const found = [];
  for (const [name, value] of entries) {
    const hay = String(value).toLowerCase();
    const kinds = new Set();
    for (const t of tokens) if (hay.includes(t.value)) kinds.add(t.kind);
    for (const [re, kind] of GENERIC) if (re.test(String(value))) kinds.add(kind);
    for (const kind of kinds) found.push({ header: String(name).toLowerCase(), kind });
  }
  return found;
}

/** Same scan for a (truncated) response body, e.g. an S3 error document that echoes request material. Kinds only. */
export function scanText(text, tokens) {
  const hay = String(text ?? '').toLowerCase();
  const kinds = new Set();
  for (const t of tokens) if (hay.includes(t.value)) kinds.add(t.kind);
  for (const [re, kind] of GENERIC) if (re.test(String(text ?? ''))) kinds.add(kind);
  return [...kinds];
}

const SUSPICIOUS_NAME = /key|secret|token|signature|credential|authorization/i;

/** R18: no provider header NAME or VALUE may expose a credential, a signature or the signed URL. */
export function leakGate({ headerNames = [], valueFindings = [] }) {
  const suspiciousNames = [...new Set(headerNames)].filter((n) => SUSPICIOUS_NAME.test(n)).sort();
  return {
    pass: suspiciousNames.length === 0 && valueFindings.length === 0,
    suspiciousNames,
    // one row per (header, kind) with a count and the first response id — never a value
    valueLeaks: [...valueFindings.reduce((m, { id, header, kind }) => { const k = `${header}|${kind}`; const cur = m.get(k); if (cur) cur.count += 1; else m.set(k, { header, kind, firstResponse: id, count: 1 }); return m; }, new Map()).values()],
  };
}

/**
 * R13: no 3xx on a correctly signed HTTPS request. Only observations of kind `signed` count: negative controls (tampered/unsigned/expired/wrong method)
 * and informational probes (I10: plain http, where a redirect to https is an ACCEPTABLE outcome) are recorded but never fail the gate.
 * 304 is a conditional-request result, not a redirect.
 * @param {{id: string, kind: 'signed'|'negative'|'informational', status: number}[]} log
 */
export function redirectGate(log) {
  const is3xx = (s) => s >= 300 && s < 400 && s !== 304;
  const signed = log.filter((o) => o.kind === 'signed');
  const signed3xx = signed.filter((o) => is3xx(o.status)).map((o) => ({ id: o.id, status: o.status }));
  return {
    pass: signed3xx.length === 0,
    signedRequests: signed.length,
    signed3xx,
    negativeRedirects: log.filter((o) => o.kind === 'negative' && is3xx(o.status)).length,
    informationalRedirects: log.filter((o) => o.kind === 'informational' && is3xx(o.status)).map((o) => ({ id: o.id, status: o.status })),
  };
}

/**
 * R11: one strong, quoted ETag on EVERY successful response for the test object — the 200, every 206 (closed, open-ended, suffix, EOF-clamped, If-Range,
 * parallel, …) and the HEAD — and every required observation must actually be present (a silently skipped case cannot pass).
 * @param {{id: string, status: number, etag?: string|null}[]} log successful or not; only 200/206 entries are judged
 * @param {string[]} requiredIds
 */
export function etagGate(log, requiredIds) {
  const ok = log.filter((o) => o.status === 200 || o.status === 206);
  const reference = ok.find((o) => o.etag)?.etag ?? null;
  const strong = (e) => typeof e === 'string' && /^"[^"]+"$/.test(e);
  const missing = requiredIds.filter((id) => !ok.some((o) => o.id === id));
  const noEtag = ok.filter((o) => !o.etag).map((o) => o.id);
  const different = ok.filter((o) => o.etag && o.etag !== reference).map((o) => o.id);
  const weak = ok.filter((o) => o.etag && !strong(o.etag)).map((o) => o.id);
  return {
    pass: ok.length > 0 && missing.length === 0 && noEtag.length === 0 && different.length === 0 && weak.length === 0 && strong(reference),
    judged: ok.length,
    distinctEtags: [...new Set(ok.map((o) => o.etag).filter(Boolean))],
    missing, noEtag, different, weak,
  };
}

/**
 * Describes where a redirect points without exposing the URL (used for I10). `same-host-https` means the parsed hostname is EXACTLY a permitted one — the configured R2
 * endpoint host or `<bucket>.<endpoint host>` — on the endpoint's port with no userinfo (`permittedHostnames`); a suffix, prefix, trailing-dot, userinfo, other-port or
 * other-account look-alike is `other-host-https`. The classification is evidence only: a redirect is never followed (`guardedFetch` forces `redirect: 'manual'`).
 * @param {string|null|undefined} location  @param {{endpoint: string, bucket: string, allowInsecureLoopback?: boolean}} policy  the same policy the guard enforces
 */
export function classifyLocation(location, policy) {
  if (!location) return 'none';
  try {
    const u = new URL(location, 'http://placeholder.invalid');
    if (u.protocol !== 'https:') return `non-https(${u.protocol.replace(':', '')})`;
    return hostPortPermitted(u, policy) ? 'same-host-https' : 'other-host-https';
  } catch { return 'unparseable'; }
}

/**
 * Cleanup verification: every disposable test object must be DELETED and then CONFIRMED gone (HEAD → 404). A delete that errored, an object that is still
 * there, or a verification that could not be completed (HEAD answered anything but 404 — e.g. 403/500/network) all leave the owner's bucket in an unknown
 * state, so the run must exit nonzero even when every protocol gate passed. Labels only; never a key.
 * @param {{label: string, deleteOk: boolean, headStatus: number|null}[]} entries  an empty list (nothing was created) is a clean state
 */
export function cleanupGate(entries) {
  const remaining = entries.filter((e) => e.headStatus === 200).map((e) => e.label);
  const unverified = entries.filter((e) => e.headStatus !== 200 && e.headStatus !== 404).map((e) => e.label);
  const deleteFailed = entries.filter((e) => !e.deleteOk).map((e) => e.label);
  return { pass: remaining.length === 0 && unverified.length === 0, verified: remaining.length === 0 && unverified.length === 0, objects: entries.length, remaining, unverified, deleteFailed };
}

// ───────────────────────────── redaction (review round 3: nothing sensitive may reach a serialized result) ─────────────────────────────
// Provider response headers that the probe RETAINS in its JSON (etag, location, content-disposition, …) are provider-controlled strings. A misbehaving or
// compromised endpoint can echo a signature, a credential or the whole signed URL into any of them, so a retention allow-list of header NAMES is not a
// redaction. Every retained string — and, as a last line of defence, every string in the finished report — is redacted against the same token set the R18 gate
// scans for. Findings and labels carry kinds only: a redacted value is replaced by `<redacted:kind>`, never partially masked.

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replaces every occurrence of a known token (case-insensitive, every encoding variant `sensitiveTokens` knows) and of the generic SigV4/presign markers.
 * @returns {{text: string, kinds: string[]}} kinds of what was removed (no values)
 */
export function redactText(text, tokens = []) {
  let out = String(text ?? ''); const kinds = new Set();
  // longest first: a whole URL is replaced before the query / signature pieces it contains
  for (const t of [...tokens].sort((a, b) => b.value.length - a.value.length)) {
    const re = new RegExp(escapeRe(t.value), 'gi');
    if (re.test(out)) { kinds.add(t.kind); out = out.replace(new RegExp(escapeRe(t.value), 'gi'), `<redacted:${t.kind}>`); }
  }
  if (/aws4-hmac-sha256/i.test(out)) { kinds.add('sigv4-material'); out = out.replace(/aws4-hmac-sha256[^\n]*/gi, '<redacted:sigv4-material>'); }
  if (/x-amz-(signature|credential|security-token)=/i.test(out)) { kinds.add('signed-url-parameter'); }
  out = out.replace(/X-Amz-[A-Za-z-]+=[^&\s"']+/gi, 'X-Amz-…=<redacted>');
  return { text: out, kinds: [...kinds].sort() };
}

/** Redacts every string value AND every object key of a JSON-able structure. @returns {{value: any, kinds: string[]}} */
export function redactDeep(value, tokens = []) {
  const kinds = new Set();
  const walk = (v) => {
    if (typeof v === 'string') { const r = redactText(v, tokens); r.kinds.forEach((k) => kinds.add(k)); return r.text; }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [walk(k), walk(x)]));
    return v;
  };
  return { value: walk(value), kinds: [...kinds].sort() };
}

/**
 * The only way a result is turned into text for a file or stdout: redact, serialise, then SCAN THE SERIALISED TEXT against the same tokens. If anything is
 * still there, `text` is null and `clean` false — the caller must not write it. `sweepKinds` = what the sweep had to remove (a non-empty list means an
 * un-redacted path existed upstream, which is itself a defect to report, by kind only).
 * @returns {{text: string|null, sweepKinds: string[], clean: boolean}}
 */
export function safeSerialize(value, tokens = [], space = 2) {
  const { value: safe, kinds } = redactDeep(value, tokens);
  const text = JSON.stringify(safe, null, space);
  const remaining = scanText(text, tokens);
  return remaining.length ? { text: null, sweepKinds: [...new Set([...kinds, ...remaining])].sort(), clean: false } : { text, sweepKinds: kinds, clean: true };
}
