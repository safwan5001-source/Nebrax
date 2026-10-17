// Regression tests for the three gates fixed after review of PR #1558 (R13, R18, R11). Run:
//   node --test v0-gates.test.mjs                                          → must pass
//   V0_GATES=./regression/legacy-gates.mjs node --test v0-gates.test.mjs   → the new regression tests must FAIL (they document the pre-fix defects)
import test from 'node:test';
import assert from 'node:assert/strict';

const gates = await import(process.env.V0_GATES ?? './v0-gates.mjs');
const { sensitiveTokens, scanHeaderValues, scanText, leakGate, redirectGate, etagGate, cleanupGate, classifyLocation, redactText, redactDeep, safeSerialize } = gates;

const KEY_ID = 'AKIAEXAMPLEKEYID0001';
const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const SIG = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const URL_ = `https://bucket.acct.r2.cloudflarestorage.com/tenant/t/storefront-media/m/video.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${KEY_ID}%2F20261017%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20261017T000000Z&X-Amz-Expires=90&X-Amz-SignedHeaders=host&X-Amz-Signature=${SIG}`;
const tokens = () => sensitiveTokens({ secrets: [KEY_ID, SECRET], urls: [URL_] });
const CLEAN = [['content-type', 'video/mp4'], ['etag', '"abc123"'], ['accept-ranges', 'bytes'], ['server', 'cloudflare'], ['date', 'Sat, 17 Oct 2026 10:00:00 GMT'], ['x-amz-request-id', '1A2B3C4D5E6F'], ['content-length', '100'], ['content-range', 'bytes 0-99/8388608'], ['last-modified', 'Sat, 17 Oct 2026 09:00:00 GMT']];
const valueLeaks = (entries) => leakGate({ headerNames: entries.map(([n]) => n), valueFindings: scanHeaderValues(entries, tokens()).map((f) => ({ id: 'T', ...f })) });

// ───────────── R13 — an acceptable HTTP→HTTPS redirect on the informational I10 probe must not fail the signed-HTTPS gate ─────────────
const signed = (n = 6) => Array.from({ length: n }, (_, i) => ({ id: `S${i}`, kind: 'signed', status: i === 0 ? 200 : 206 }));

test('R13 regression: I10 plain-http probe answered 301 → https is recorded but does NOT fail R13', () => {
  const r = redirectGate([...signed(), { id: 'I10', kind: 'informational', status: 301 }]);
  assert.equal(r.pass, true);
  assert.deepEqual(r.informationalRedirects, [{ id: 'I10', status: 301 }]);
  assert.deepEqual(r.signed3xx, []);
});
test('R13 regression: every redirect status is acceptable for the informational probe (301, 302, 307, 308)', () => {
  for (const status of [301, 302, 307, 308]) assert.equal(redirectGate([...signed(), { id: 'I10', kind: 'informational', status }]).pass, true, String(status));
});
test('R13 regression: negative controls (tampered / unsigned / expired) answering with a redirect do not count as "correctly signed" requests', () => {
  assert.equal(redirectGate([...signed(), { id: 'R17', kind: 'negative', status: 302 }, { id: 'R14', kind: 'negative', status: 307 }]).pass, true);
});
test('R13 preserved: a redirect on any correctly signed HTTPS request still fails the gate', () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const r = redirectGate([...signed(), { id: 'R3', kind: 'signed', status }, { id: 'I10', kind: 'informational', status: 301 }]);
    assert.equal(r.pass, false, String(status));
    assert.deepEqual(r.signed3xx, [{ id: 'R3', status }]);
  }
});
test('R13 preserved: 304 is a conditional response, not a redirect', () => {
  assert.equal(redirectGate([...signed(), { id: 'I7', kind: 'signed', status: 304 }]).pass, true);
});
test('I10 location classification never exposes a URL', () => {
  assert.equal(classifyLocation('https://acct.r2.cloudflarestorage.com/b/k?X-Amz-Signature=zz', 'acct.r2.cloudflarestorage.com'), 'same-host-https');
  assert.equal(classifyLocation('https://evil.example/x', 'acct.r2.cloudflarestorage.com'), 'other-host-https');
  assert.equal(classifyLocation('http://acct.r2.cloudflarestorage.com/x', 'acct.r2.cloudflarestorage.com'), 'non-https(http)');
  assert.equal(classifyLocation(null, 'x'), 'none');
});

// ───────────── R18 — header VALUES, not just names ─────────────
test('R18 regression: the full signed URL echoed in a Location header value fails the gate', () => {
  const r = valueLeaks([...CLEAN, ['location', URL_]]);
  assert.equal(r.pass, false);
  assert.ok(r.valueLeaks.some((f) => f.header === 'location' && f.kind === 'signed-url'));
});
test('R18 regression: the signature alone, the credential scope, or the access key id in an ordinary header value fail the gate', () => {
  assert.equal(valueLeaks([...CLEAN, ['x-debug', `sig=${SIG}`]]).pass, false);
  assert.equal(valueLeaks([...CLEAN, ['x-trace', `scope=${KEY_ID}/20261017/auto/s3/aws4_request`]]).pass, false);
  assert.equal(valueLeaks([...CLEAN, ['x-who', `user ${KEY_ID}`]]).pass, false);
  assert.equal(valueLeaks([...CLEAN, ['x-s', SECRET]]).pass, false);
});
test('R18 regression: a percent-encoded copy of the URL or the query string is still caught', () => {
  assert.equal(valueLeaks([...CLEAN, ['link', encodeURIComponent(URL_)]]).pass, false);
  assert.equal(valueLeaks([...CLEAN, ['link', `/x?${new URL(URL_).search.slice(1)}`]]).pass, false);
});
test('R18 regression: presigned-URL parameters are caught even for a URL the probe never requested', () => {
  assert.equal(valueLeaks([...CLEAN, ['location', 'https://x.example/k?X-Amz-Signature=deadbeef']]).pass, false);
  assert.equal(valueLeaks([...CLEAN, ['www-authenticate', 'AWS4-HMAC-SHA256 Credential=zzz']]).pass, false);
});
test('R18 regression: the same leak is caught in an error BODY (kinds only)', () => {
  assert.ok(scanText(`<Error><AWSAccessKeyId>${KEY_ID}</AWSAccessKeyId></Error>`, tokens()).includes('credential'));
  assert.deepEqual(scanText('<Error><Code>AccessDenied</Code></Error>', tokens()), []);
});
test('R18 never reports a value: findings carry only header name, id and kind', () => {
  const r = valueLeaks([...CLEAN, ['location', URL_], ['x-s', SECRET]]);
  const dump = JSON.stringify(r);
  for (const secret of [KEY_ID, SECRET, SIG, 'X-Amz-Signature', 'r2.cloudflarestorage.com']) assert.ok(!dump.includes(secret), `report contains ${secret}`);
});
test('R18 preserved: a clean, ordinary provider header set passes (no false positives)', () => {
  assert.equal(valueLeaks(CLEAN).pass, true);
  assert.equal(valueLeaks([...CLEAN, ['cf-ray', '8a1b2c3d4e5f-AMS'], ['vary', 'Accept-Encoding'], ['x-amz-id-2', 'abcdef/ghijkl=']]).pass, true);
});
test('R18 preserved: suspicious header NAMES still fail', () => {
  const r = leakGate({ headerNames: ['content-type', 'x-amz-security-token'], valueFindings: [] });
  assert.equal(r.pass, false);
  assert.deepEqual(r.suspiciousNames, ['x-amz-security-token']);
});

// ───────────── R11 — one ETag on EVERY successful response ─────────────
const E = '"d41d8cd98f00b204e9800998ecf8427e"';
const REQUIRED = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R10', 'I1'];
const goodLog = () => [
  { id: 'R1', status: 200, etag: E }, { id: 'R2', status: 206, etag: E }, { id: 'R3', status: 206, etag: E }, { id: 'R4', status: 206, etag: E },
  { id: 'R5', status: 206, etag: E }, { id: 'R6', status: 206, etag: E }, { id: 'R7', status: 206, etag: E }, { id: 'R8', status: 416, etag: null },
  { id: 'R9', status: 416, etag: null }, { id: 'R10', status: 206, etag: E }, { id: 'I1', status: 200, etag: E },
];
test('R11 baseline: identical ETags everywhere pass; 416 responses (no ETag) are not judged', () => {
  const r = etagGate(goodLog(), REQUIRED);
  assert.equal(r.pass, true);
  assert.deepEqual(r.distinctEtags, [E]);
});
for (const id of ['R5', 'R6', 'R7']) {
  test(`R11 regression: a different ETag only on ${id} (${{ R5: 'open-ended', R6: 'suffix', R7: 'EOF-clamped' }[id]}) fails the gate`, () => {
    const log = goodLog().map((o) => (o.id === id ? { ...o, etag: '"drifted"' } : o));
    const r = etagGate(log, REQUIRED);
    assert.equal(r.pass, false);
    assert.deepEqual(r.different, [id]);
  });
}
test('R11 regression: a drifting ETag on the other successful ranged cases (If-Range, parallel, suffix-larger) also fails', () => {
  for (const id of ['I5', 'I6-matching', 'I11-3']) {
    const log = [...goodLog(), { id, status: 206, etag: E }].map((o) => (o.id === id ? { ...o, etag: '"drifted"' } : o));
    assert.equal(etagGate(log, REQUIRED).pass, false, id);
  }
});
test('R11 regression: a required ranged observation that is missing (case skipped) cannot pass', () => {
  const log = goodLog().filter((o) => o.id !== 'R6');
  const r = etagGate(log, REQUIRED);
  assert.equal(r.pass, false);
  assert.deepEqual(r.missing, ['R6']);
});
test('R11 regression: a successful ranged response with NO ETag fails', () => {
  assert.equal(etagGate(goodLog().map((o) => (o.id === 'R7' ? { ...o, etag: null } : o)), REQUIRED).pass, false);
});
test('R11 preserved: weak ETags fail, and a 200 with a different ETag still fails', () => {
  assert.equal(etagGate(goodLog().map((o) => ({ ...o, etag: o.etag ? 'W/"x"' : o.etag })), REQUIRED).pass, false);
  assert.equal(etagGate(goodLog().map((o) => (o.id === 'R1' ? { ...o, etag: '"other"' } : o)), REQUIRED).pass, false);
});

// ───────────── I9 — the short-TTL streaming request must be judged by R11 and R13 like every other signed request ─────────────
test('I9 regression: a redirect on the I9 signed request fails R13', () => {
  const r = redirectGate([...signed(), { id: 'I9', kind: 'signed', status: 302 }]);
  assert.equal(r.pass, false);
  assert.deepEqual(r.signed3xx, [{ id: 'I9', status: 302 }]);
});
test('I9 regression: a missing or different ETag on the I9 response fails R11', () => {
  const withI9 = (etag) => [...goodLog(), { id: 'I9', status: 200, etag }];
  assert.equal(etagGate(withI9(E), REQUIRED).pass, true);
  assert.equal(etagGate(withI9('"drifted-i9"'), REQUIRED).pass, false);
  assert.equal(etagGate(withI9(null), REQUIRED).pass, false);
});

// ───────────── cleanup — failed or unverified cleanup must fail the run ─────────────
const objs = (...heads) => heads.map((h, i) => ({ label: ['probe', 'other', 'empty'][i], deleteOk: true, headStatus: h }));
test('cleanup regression: every object deleted and confirmed 404 passes; nothing created passes', () => {
  assert.equal(cleanupGate(objs(404, 404, 404)).pass, true);
  assert.equal(cleanupGate([]).pass, true);
});
test('cleanup regression: an object that is still present fails and is named by label only', () => {
  const r = cleanupGate(objs(404, 200, 404));
  assert.equal(r.pass, false);
  assert.deepEqual(r.remaining, ['other']);
});
test('cleanup regression: a failed delete whose object is still there fails', () => {
  const r = cleanupGate([{ label: 'probe', deleteOk: false, headStatus: 200 }, ...objs(404, 404).map((o, i) => ({ ...o, label: ['other', 'empty'][i] }))]);
  assert.equal(r.pass, false);
  assert.deepEqual(r.deleteFailed, ['probe']);
});
test('cleanup regression: an UNVERIFIED cleanup (HEAD 403 / 500 / no answer) fails — absence of proof is not a clean bucket', () => {
  for (const unknown of [403, 500, 503, null]) {
    const r = cleanupGate(objs(404, unknown, 404));
    assert.equal(r.pass, false, String(unknown));
    assert.deepEqual(r.unverified, ['other']);
  }
});
test('cleanup: a delete call that errored but whose object is confirmed gone is clean (recorded, not failed)', () => {
  const r = cleanupGate([{ label: 'probe', deleteOk: false, headStatus: 404 }]);
  assert.equal(r.pass, true);
  assert.deepEqual(r.deleteFailed, ['probe']);
});

// ───────────── redaction (review round 3) — nothing sensitive may reach a serialized result, retained headers and failure cases included ─────────────
const SIG_ENC = encodeURIComponent(SECRET);
// what a hostile / misconfigured endpoint can put into the headers the probe RETAINS in its JSON
const HOSTILE = {
  etag: `"${SIG}"`,
  location: URL_,
  'content-disposition': `attachment; filename="${URL_}"`,
  'cache-control': `private; ${KEY_ID}`,
  server: SECRET.toUpperCase(),
  'x-amz-id-2': SIG_ENC,
  'www-authenticate': `AWS4-HMAC-SHA256 Credential=SOMEOTHERKEY/20261017/auto/s3/aws4_request, Signature=0123456789abcdef`,
  'content-type': 'video/mp4?X-Amz-Signature=feedfacefeedface',
};
const SENSITIVE = [SIG, KEY_ID, SECRET, SIG_ENC, URL_, 'SOMEOTHERKEY', '0123456789abcdef', 'feedfacefeedface'];
const retain = (headers) => Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, redactText(v, tokens()).text]));
const hasAnySensitive = (text) => SENSITIVE.filter((x) => String(text).toLowerCase().includes(x.toLowerCase()));

test('redaction regression: no token survives in ANY retained header value (etag, location, content-disposition, … — not just a name allow-list)', () => {
  const kept = retain(HOSTILE);
  assert.deepEqual(hasAnySensitive(JSON.stringify(kept)), []);
  assert.deepEqual(scanText(JSON.stringify(kept), tokens()), []);
});
test('redaction regression: a signature echoed as a "strong" ETag is replaced, not merely flagged (the pre-fix probe wrote it to the report)', () => {
  const r = redactText(`"${SIG}"`, tokens());
  assert.ok(!r.text.includes(SIG));
  assert.ok(/^"<redacted:[a-z-]+>"$/.test(r.text), r.text);
  assert.ok(r.kinds.includes('signature'));
});
test('redaction regression: unknown SigV4 material (a token the probe never requested) is still removed by the generic markers', () => {
  const r = redactText('AWS4-HMAC-SHA256 Credential=OTHER/20261017/auto/s3/aws4_request, Signature=abc123def456', tokens());
  assert.ok(!/OTHER|abc123def456/.test(r.text));
  const q = redactText('https://h/k?X-Amz-Signature=abc123def456&X-Amz-Expires=60', tokens());
  assert.ok(!q.text.includes('abc123def456'));
});
test('redaction: percent-encoded, decoded and upper-/lower-case variants of a credential or signature are all removed', () => {
  for (const v of [SECRET, SIG_ENC, SECRET.toUpperCase(), SECRET.toLowerCase(), SIG.toUpperCase()]) assert.deepEqual(hasAnySensitive(redactText(`x ${v} y`, tokens()).text), [], v);
});
test('redaction: ordinary provider headers are left byte-for-byte unchanged (the report stays useful)', () => {
  for (const [n, v] of CLEAN) assert.equal(redactText(v, tokens()).text, v, n);
});
test('redaction: header NAMES are redacted too (a hostile endpoint can name a header after a token)', () => {
  const r = redactDeep({ providerHeaderNames: ['etag', SIG, `x-${KEY_ID}`] }, tokens());
  assert.deepEqual(hasAnySensitive(JSON.stringify(r.value)), []);
});
test('redaction (failure case): a fatal error message that embeds the signed URL or a credential is redacted before it is serialised', () => {
  const report = { label: 'x', fatal: `fetch failed for ${URL_} (key ${KEY_ID}, secret ${SECRET})`, results: [{ id: 'R2', observed: { error: `bad ${SIG}` } }] };
  const s = safeSerialize(report, tokens());
  assert.equal(s.clean, true);
  assert.deepEqual(hasAnySensitive(s.text), []);
  assert.deepEqual(scanText(s.text, tokens()), []);
});
test('redaction: the sweep reports KINDS only — a finding never contains the value it removed', () => {
  const s = safeSerialize({ a: { b: [SIG, URL_, SECRET] } }, tokens());
  assert.ok(s.sweepKinds.length > 0);
  assert.deepEqual(hasAnySensitive(JSON.stringify(s.sweepKinds)), []);
});
test('redaction: a clean report passes the sweep untouched (no false positives, no sweep hits)', () => {
  const s = safeSerialize({ results: CLEAN.map(([n, v]) => ({ n, v })) }, tokens());
  assert.deepEqual(s.sweepKinds, []);
  assert.equal(s.clean, true);
});
test('redaction FAILS CLOSED: if the serialised text still contains a token after redaction, no text is returned (the caller must not write a file)', () => {
  // pathological: a credential whose own text appears in the redaction label — the replacement re-creates the token
  const s = safeSerialize({ v: 'xx redacted yy' }, sensitiveTokens({ secrets: ['redacted'] }));
  assert.equal(s.clean, false);
  assert.equal(s.text, null);
});
test('redaction: an echoed URL whose access key id was substituted FIRST is no longer matched as a whole — token redaction must come before substitutions', () => {
  // documents the ordering defect found while verifying round 3 (`location` kept host + path after the credential had been replaced inside it)
  const mutated = URL_.split(KEY_ID).join('<secret>');
  const r = redactText(mutated, tokens());
  assert.ok(r.text.includes('bucket.acct.r2.cloudflarestorage.com'), 'the mutated URL escapes whole-URL redaction (this is why scrub() must not substitute first)');
  const whole = redactText(URL_, tokens());
  assert.equal(whole.text, '<redacted:signed-url>');
});
