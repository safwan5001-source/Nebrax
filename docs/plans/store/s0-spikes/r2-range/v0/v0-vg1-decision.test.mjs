// Tests for the V-G1 decision (PR #1551 §4.6): gate on what the proxy consumes + security + verified cleanup; diagnostic cases and synthesised headers can never fail it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gateSub } from './v0-gates.mjs';
import { decide, toMarkdown, CONSUMED_CASES, SECURITY_CASES, PRODUCTION_SHAPED_IDS } from './v0-vg1-decision.mjs';

const good = (extra = {}) => ({
  label: 't', runId: 'abc', provider: 'remote S3 API', endpointHost: '<account>.r2.cloudflarestorage.com', cleanedUp: true, upstreamGuard: { requestsRefused: 0 },
  results: [
    ...CONSUMED_CASES.map((id) => ({ id, group: 'R', pass: true, observed: { gate: { consumed: { statusOk: true, contentLengthOk: true, ...(id === 'R1' ? {} : { contentRangeOk: true }), noContentEncoding: true, bodyLengthOk: true, bodyHashOk: true }, diagnosticOnly: { acceptRangesBytes: true, etagPresent: true, contentTypeOk: true } } } })),
    { id: 'R12', group: 'R', pass: true, observed: {} },
    ...SECURITY_CASES.map((id) => ({ id, group: 'R', pass: true, observed: {} })),
    { id: 'R13', group: 'R', pass: true, observed: { signedRequests: 40, signed3xx: [] } },
    ...['R5', 'R6', 'R7', 'R8', 'R9', 'R11'].map((id) => ({ id, group: 'R', pass: true, observed: {} })),
  ],
  ...extra,
});
const edit = (rep, id, fn) => { const r = rep.results.find((x) => x.id === id); fn(r); return rep; };

test('a complete real-R2 report with every gate satisfied is GO', () => {
  const d = decide(good());
  assert.equal(d.verdict, 'GO', JSON.stringify(d.failed));
});

test('diagnostic-only failures can never fail V-G1: R5–R9, R11 and every synthesised header', () => {
  const rep = good();
  for (const id of ['R5', 'R6', 'R7', 'R8', 'R9', 'R11']) edit(rep, id, (r) => { r.pass = false; });
  for (const id of CONSUMED_CASES) edit(rep, id, (r) => { r.pass = false; r.observed.gate.diagnosticOnly = { acceptRangesBytes: false, etagPresent: false, contentTypeOk: false }; });
  assert.equal(decide(rep).verdict, 'GO');
});

test('each consumed property fails the gate on its own', () => {
  for (const id of CONSUMED_CASES) {
    for (const k of Object.keys(good().results.find((r) => r.id === id).observed.gate.consumed)) {
      const d = decide(edit(good(), id, (r) => { r.observed.gate.consumed[k] = false; }));
      assert.equal(d.verdict, 'NO-GO', `${id}.${k}`);
    }
  }
});

test('a report without recorded sub-results is not a GO (unverified)', () => {
  const d = decide(edit(good(), 'R2', (r) => { delete r.observed.gate; }));
  assert.equal(d.verdict, 'NO-GO (unverified)');
});

test('security gates fail the run: R13 on a production-shaped request, R14–R20, cleanup, upstream guard', () => {
  for (const id of SECURITY_CASES) assert.equal(decide(edit(good(), id, (r) => { r.pass = false; })).verdict, 'NO-GO', id);
  assert.equal(decide(edit(good(), 'R12', (r) => { r.pass = false; })).verdict, 'NO-GO');
  assert.equal(decide(good({ cleanedUp: false })).verdict, 'NO-GO');
  assert.equal(decide(good({ upstreamGuard: { requestsRefused: 1 } })).verdict, 'NO-GO');
  assert.equal(decide(good({ fatal: 'x' })).verdict, 'NO-GO');
  for (const id of PRODUCTION_SHAPED_IDS) {
    const rep = edit(good(), 'R13', (r) => { r.pass = false; r.observed.signed3xx = [{ id, status: 302 }]; });
    assert.equal(decide(rep).verdict, 'NO-GO', `3xx on ${id}`);
  }
});

test('R13 is scoped: a 3xx on a diagnostic shape is recorded as a NOTE and does not fail V-G1', () => {
  const rep = edit(good(), 'R13', (r) => { r.pass = false; r.observed.signed3xx = [{ id: 'I1', status: 301 }, { id: 'I6-matching', status: 302 }, { id: 'R5', status: 307 }]; });
  const d = decide(rep);
  assert.equal(d.verdict, 'GO');
  assert.ok(d.rows.some((r) => r.verdict === 'NOTE' && /diagnostic shapes/.test(r.condition) && /I1:301/.test(r.evidence)));
});

test('a local look-alike or any non-R2 endpoint is never GO', () => {
  assert.equal(decide(good({ provider: 'LOCAL LOOK-ALIKE (not R2)', endpointHost: '127.0.0.1:8000' })).verdict, 'NO-GO');
  assert.equal(decide(good({ endpointHost: 'evil.example.com' })).verdict, 'NO-GO');
  assert.equal(decide(good({ endpointHost: 'x.r2.cloudflarestorage.com.evil.test' })).verdict, 'NO-GO');
});

test('a missing required case is a failure, not a pass', () => {
  const rep = good(); rep.results = rep.results.filter((r) => r.id !== 'R17');
  assert.equal(decide(rep).verdict, 'NO-GO');
});

test('the markdown output never contains more than ids, verdicts and short evidence', () => {
  const md = toMarkdown(decide(good()));
  assert.match(md, /V-G1 decision — GO/);
  assert.doesNotMatch(md, /X-Amz|AWS4|https?:\/\//);
});

test('gateSub records each consumed property and each synthesised header separately', () => {
  const r = { status: 206, headers: { 'content-length': '100', 'content-range': 'bytes 100-199/8', 'accept-ranges': 'bytes', etag: '"x"', 'content-type': 'video/mp4' }, bodyLen: 100, sha: 'h' };
  const ok = gateSub(r, { status: 206, length: 100, range: 'bytes 100-199/8', hash: 'h' });
  assert.deepEqual(ok.consumed, { statusOk: true, contentLengthOk: true, contentRangeOk: true, noContentEncoding: true, bodyLengthOk: true, bodyHashOk: true });
  assert.deepEqual(ok.diagnosticOnly, { acceptRangesBytes: true, etagPresent: true, contentTypeOk: true });
  // an R2 that omits Accept-Ranges / ETag / Content-Type but serves the bytes correctly: consumed all true, diagnostics false
  const bare = gateSub({ ...r, headers: { 'content-length': '100', 'content-range': 'bytes 100-199/8' } }, { status: 206, length: 100, range: 'bytes 100-199/8', hash: 'h' });
  assert.ok(Object.values(bare.consumed).every(Boolean));
  assert.ok(Object.values(bare.diagnosticOnly).every((v) => v === false));
  // each consumed failure is visible on its own
  assert.equal(gateSub({ ...r, headers: { ...r.headers, 'content-range': 'bytes 0-99/8' } }, { status: 206, length: 100, range: 'bytes 100-199/8', hash: 'h' }).consumed.contentRangeOk, false);
  assert.equal(gateSub({ ...r, headers: { ...r.headers, 'content-encoding': 'gzip' } }, { status: 206, length: 100, hash: 'h' }).consumed.noContentEncoding, false);
  assert.equal(gateSub({ ...r, sha: 'other' }, { status: 206, length: 100, hash: 'h' }).consumed.bodyHashOk, false);
  assert.equal('contentRangeOk' in gateSub({ ...r, status: 200 }, { status: 200, length: 100, hash: 'h' }).consumed, false); // full GET has no Content-Range expectation
});
