// REGRESSION REFERENCE — the gate logic exactly as it behaved BEFORE the three review fixes on PR #1558 (probe at db1ac4c5b), behind the same interface as ../v0-gates.mjs.
// It exists only so `V0_GATES=./regression/legacy-gates.mjs node --test v0-gates.test.mjs` can show that every regression test FAILS on the old behaviour and passes on the fix.
// Do not import it from the probe.
// I10 classification before PR #1558 round 5 (P2-B): an unbounded hostname SUFFIX test, so `evilacct.<endpoint>` counted as the same host.
export function classifyLocation(location, endpointHost) {
  if (!location) return 'none';
  try {
    const u = new URL(location, 'http://placeholder.invalid');
    if (u.protocol === 'https:' && u.hostname.toLowerCase().endsWith(String(endpointHost?.endpoint ? new URL(endpointHost.endpoint).hostname : endpointHost).toLowerCase())) return 'same-host-https';
    return u.protocol === 'https:' ? 'other-host-https' : `non-https(${u.protocol.replace(':', '')})`;
  } catch { return 'unparseable'; }
}

export const sensitiveTokens = () => [];            // header VALUES were never inspected
export const scanHeaderValues = () => [];
export const scanText = () => [];

export function leakGate({ headerNames = [] }) {   // R18 before: names only
  const suspiciousNames = [...new Set(headerNames)].filter((n) => /key|secret|token|signature|credential|authorization/i.test(n)).sort();
  return { pass: suspiciousNames.length === 0, suspiciousNames, valueLeaks: [] };
}

export function redirectGate(log) {                  // R13 before: ANY 3xx on ANY tracked request (incl. negative controls and the I10 probe) fails the gate
  const hits = log.filter((o) => o.status >= 300 && o.status < 400 && o.status !== 304);
  return { pass: hits.length === 0, signedRequests: log.length, signed3xx: hits.map((o) => ({ id: o.id, status: o.status })), negativeRedirects: 0, informationalRedirects: [] };
}

export function etagGate(log) {                      // R11 before: only the 200, R2, R3, R4, R10 and the HEAD were compared
  const subset = log.filter((o) => ['R1', 'R2', 'R3', 'R4', 'R10', 'I1'].includes(o.id));
  const etags = subset.map((o) => o.etag);
  return { pass: etags.every((e) => e && e === etags[0] && /^"[^"]+"$/.test(e)), judged: subset.length, distinctEtags: [...new Set(etags)], missing: [], noEtag: [], different: [], weak: [] };
}

export function cleanupGate() {                      // cleanup before: reported in the JSON but never part of the exit status
  return { pass: true, verified: true, objects: 0, remaining: [], unverified: [], deleteFailed: [] };
}

// Round 3 (retained-header redaction). Before the fix the probe's only redaction of a provider header was a `X-Amz-…=` regex, and nothing swept the finished report.
export const redactText = (text) => ({ text: String(text ?? '').replace(/X-Amz-[A-Za-z-]+=[^&\s"']+/g, 'X-Amz-…=<redacted>'), kinds: [] });
export const redactDeep = (value) => ({ value, kinds: [] });
export const safeSerialize = (value, _tokens, space = 2) => ({ text: JSON.stringify(value, null, space), sweepKinds: [], clean: true });
