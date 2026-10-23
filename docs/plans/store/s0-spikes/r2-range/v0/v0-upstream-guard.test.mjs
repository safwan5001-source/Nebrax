// Regression tests for the upstream host allow-list (review round 4): a signed URL on any host but the configured endpoint must be refused BEFORE a connection is made,
// for the probe, the isolated I9 experiment (v0-i9-experiment.test.mjs) and redirects. "Zero requests reach the malicious host" is measured by counting TCP
// connections on a real listener, not by inspecting our own code.
//   node --test v0-upstream-guard.test.mjs                                                  → must pass
//   cp <pre-fix probe> ./prefix4-probe.mjs; V0_PROBE=./prefix4-probe.mjs node --test v0-upstream-guard.test.mjs   → the probe e2e tests must FAIL (the pre-fix probe connects)
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowedUpstream, guardedFetch, permittedHostnames, UpstreamRefused } from './v0-upstream-guard.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const probe = process.env.V0_PROBE ?? join(here, 'v0-r2-range-probe.mjs');
const SIGNED = 'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=KEYKEYKEY1%2F20261017%2Fauto%2Fs3%2Faws4_request&X-Amz-Signature=cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe';
const POLICY = { endpoint: 'https://acct.r2.cloudflarestorage.com', bucket: 'b' };

/** a listener that counts TCP connections and HTTP requests */
async function listener(handler = (q, r) => r.end('x')) {
  const seen = { connections: 0, requests: 0 };
  const srv = http.createServer((q, r) => { seen.requests += 1; handler(q, r); });
  srv.on('connection', () => { seen.connections += 1; });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  return { seen, port: srv.address().port, close: () => srv.close() };
}

// ───────────── the guard itself ─────────────
const REFUSED = [
  ['look-alike suffix', 'https://acct.r2.cloudflarestorage.com.evil.example/b/k'],
  ['look-alike prefix', 'https://evilacct.r2.cloudflarestorage.com/b/k'],
  ['userinfo trick', 'https://acct.r2.cloudflarestorage.com@evil.example/b/k'],
  ['other bucket on the same account', 'https://other.acct.r2.cloudflarestorage.com/k'],
  ['IP literal (metadata service)', 'https://169.254.169.254/latest/meta-data'],
  ['loopback', 'https://127.0.0.1/b/k'],
  ['plain http to the real host', 'http://acct.r2.cloudflarestorage.com/b/k'],
  ['explicit port', 'https://acct.r2.cloudflarestorage.com:8443/b/k'],
  ['other scheme', 'ftp://acct.r2.cloudflarestorage.com/b/k'],
  ['not a URL', 'not a url'],
];
for (const [name, url] of REFUSED) {
  test(`guard: ${name} is refused and fetch is never called`, async () => {
    let called = 0;
    await assert.rejects(guardedFetch(`${url}?${SIGNED}`, {}, POLICY, async () => { called += 1; return new Response('x'); }), (e) => e instanceof UpstreamRefused && e.reason === 'host-not-allowed');
    assert.equal(called, 0);
  });
}
test('guard: the refusal carries a reason code only — never the URL, host or signature', async () => {
  try { await guardedFetch(`https://evil.example/k?${SIGNED}`, {}, POLICY, async () => new Response('x')); assert.fail('should refuse'); } catch (e) {
    assert.ok(!/evil|cafebabe|KEYKEY/.test(`${e.message} ${e.stack}`.split('\n')[0]), e.message);
  }
});
test('guard: the configured hosts pass (endpoint, <bucket>.<endpoint>), and redirect is forced to manual whatever the caller asks', async () => {
  const calls = [];
  const spy = async (u, init) => { calls.push([u, init.redirect]); return new Response('x'); };
  await guardedFetch(`https://acct.r2.cloudflarestorage.com/b/k?${SIGNED}`, { redirect: 'follow' }, POLICY, spy);
  await guardedFetch(`https://b.acct.r2.cloudflarestorage.com/k?${SIGNED}`, {}, POLICY, spy);
  assert.deepEqual(calls.map((c) => c[1]), ['manual', 'manual']);
});
test('guard: plainHttpProbe (the informational I10 case) allows http ONLY for the configured host', async () => {
  let called = 0; const spy = async () => { called += 1; return new Response('x'); };
  await guardedFetch(`http://acct.r2.cloudflarestorage.com/b/k?${SIGNED}`, { plainHttpProbe: true }, POLICY, spy);
  assert.equal(called, 1);
  for (const bad of ['http://evil.example/b/k', 'http://acct.r2.cloudflarestorage.com.evil.example/b/k', 'http://acct.r2.cloudflarestorage.com@evil.example/b/k', 'http://127.0.0.1/b/k']) {
    await assert.rejects(guardedFetch(bad, { plainHttpProbe: true }, POLICY, spy), UpstreamRefused, bad);
  }
  assert.equal(called, 1);
});
test('guard: a redirect from an ALLOWED host to a malicious one is recorded, never followed — the malicious host sees zero connections', async () => {
  const evil = await listener();
  const good = await listener((q, r) => { r.writeHead(302, { location: `http://127.0.0.1:${evil.port}/stolen?${SIGNED}` }); r.end(); });
  try {
    const policy = { endpoint: `http://127.0.0.1:${good.port}`, bucket: 'b', allowInsecureLoopback: true };
    const res = await guardedFetch(`http://127.0.0.1:${good.port}/b/k?${SIGNED}`, { redirect: 'follow' }, policy);
    assert.equal(res.status, 302);
    assert.equal(good.seen.requests, 1);
    assert.deepEqual(evil.seen, { connections: 0, requests: 0 });
  } finally { good.close(); evil.close(); }
});
test('guard: a malicious host is never contacted through the real fetch (zero connections)', async () => {
  const evil = await listener();
  try {
    await assert.rejects(guardedFetch(`http://127.0.0.1:${evil.port}/k?${SIGNED}`, {}, { endpoint: 'https://acct.r2.cloudflarestorage.com', bucket: 'b' }), UpstreamRefused);
    await assert.rejects(guardedFetch(`http://127.0.0.1:${evil.port}/k?${SIGNED}`, {}, { endpoint: 'http://127.0.0.1:9', bucket: 'b', allowInsecureLoopback: true }), UpstreamRefused);
    assert.deepEqual(evil.seen, { connections: 0, requests: 0 });
  } finally { evil.close(); }
});
test('guard: allowedUpstream behaviour is unchanged for the loopback self-test (same IP and port only)', () => {
  const p = { endpoint: 'http://127.0.0.1:8000', bucket: 'b', allowInsecureLoopback: true };
  assert.equal(allowedUpstream('http://127.0.0.1:8000/b/k', p), true);
  assert.equal(allowedUpstream('http://127.0.0.1:8001/b/k', p), false);
  assert.equal(allowedUpstream('http://localhost:8000/b/k', p), false);
  assert.equal(allowedUpstream('http://127.0.0.1:8000/b/k', { ...p, allowInsecureLoopback: false }), false);
});

// ───────────── the permitted hostname formats (review round 5, P2-B) ─────────────
test('guard: permitted hostnames are exact — the configured R2 endpoint host and `<bucket>.<endpoint host>`, nothing else', () => {
  assert.deepEqual(permittedHostnames(POLICY), ['acct.r2.cloudflarestorage.com', 'b.acct.r2.cloudflarestorage.com']);
  assert.deepEqual(permittedHostnames({ endpoint: 'https://acct.eu.r2.cloudflarestorage.com', bucket: 'my-bucket-1' }), ['acct.eu.r2.cloudflarestorage.com', 'my-bucket-1.acct.eu.r2.cloudflarestorage.com']);
  assert.deepEqual(permittedHostnames({ endpoint: 'https://ACCT.R2.CLOUDFLARESTORAGE.COM', bucket: 'B' }), ['acct.r2.cloudflarestorage.com', 'b.acct.r2.cloudflarestorage.com']);
});
test('guard: an endpoint that is not an R2 endpoint format permits NO host (fail closed), including itself', () => {
  for (const endpoint of ['https://evil.example', 'https://r2.cloudflarestorage.com', 'https://x.evil.r2.cloudflarestorage.com', 'https://acct.r2.cloudflarestorage.com.evil.example', 'https://u:p@acct.r2.cloudflarestorage.com', 'nope', '']) {
    assert.deepEqual(permittedHostnames({ endpoint, bucket: 'b' }), [], endpoint);
    assert.equal(allowedUpstream(`${endpoint || 'x'}/b/k`, { endpoint, bucket: 'b' }), false, endpoint);
  }
});
test('guard: loopback is a permitted endpoint only for the self-test flag, and never gets a virtual-hosted form', () => {
  assert.deepEqual(permittedHostnames({ endpoint: 'http://127.0.0.1:9', bucket: 'b' }), []);
  assert.deepEqual(permittedHostnames({ endpoint: 'http://127.0.0.1:9', bucket: 'b', allowInsecureLoopback: true }), ['127.0.0.1']);
  assert.deepEqual(permittedHostnames({ endpoint: 'http://localhost:9', bucket: 'b', allowInsecureLoopback: true }), ['localhost']);
});
test('guard: an unusable bucket name adds no virtual-hosted host (it never widens the allow-list)', () => {
  for (const bucket of ['', 'A.B', 'a/b', 'a..b', '-x', 'x-', 'x'.repeat(64), 'evil.example', null, undefined]) {
    assert.deepEqual(permittedHostnames({ endpoint: POLICY.endpoint, bucket }), ['acct.r2.cloudflarestorage.com'], String(bucket));
  }
});
test('guard: a redirect to a LOOK-ALIKE host is recorded, never followed — the look-alike listener sees zero connections', async () => {
  const lookalike = await listener();
  const good = await listener((q, r) => { r.writeHead(302, { location: `http://localhost:${lookalike.port}/stolen?${SIGNED}` }); r.end(); });
  try {
    const policy = { endpoint: `http://127.0.0.1:${good.port}`, bucket: 'b', allowInsecureLoopback: true };
    const res = await guardedFetch(`http://127.0.0.1:${good.port}/b/k?${SIGNED}`, { redirect: 'follow' }, policy);
    assert.equal(res.status, 302);
    assert.deepEqual(lookalike.seen, { connections: 0, requests: 0 });
  } finally { good.close(); lookalike.close(); }
});

// ───────────── the probe end to end (fake `php` signer; a listener that must stay untouched) ─────────────
function fakePhp(dir, presignUrl) {
  const bin = join(dir, 'php');
  writeFileSync(bin, `#!/usr/bin/env node
let b = ''; process.stdin.on('data', (d) => { b += d; }); process.stdin.on('end', () => {
  const r = JSON.parse(b || '{}');
  if (r.op === 'put') return console.log(JSON.stringify({ ok: true, etag: 'abc' }));
  if (r.op === 'presign') return console.log(JSON.stringify({ ok: true, url: ${JSON.stringify(presignUrl)} }));
  if (r.op === 'head') return console.log(JSON.stringify({ error: 'aws', code: 'NotFound', status: 404 }));
  console.log(JSON.stringify({ ok: true }));
});
`);
  chmodSync(bin, 0o755);
}
const runProbe = (env, label) => new Promise((resolve) => {
  const p = spawn(process.execPath, [probe, `--label=${label}`, '--size-mib=0.01', '--ttl=1'], { env: { ...process.env, S3_KEY: 'KEYKEYKEY1', S3_SECRET: 'SECRETSECRET1', S3_BUCKET: 'b', ...env } });
  let out = ''; let err = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => resolve({ code, out, err }));
});
for (const [name, endpoint] of [['a remote R2 endpoint', 'https://acct.r2.cloudflarestorage.com'], ['a loopback self-test endpoint', 'http://127.0.0.1:9']]) {
  test(`probe: a signer URL on a malicious host receives ZERO connections and fails the run — ${name}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'v0g-')); const label = `guardtest-${Math.random().toString(16).slice(2, 8)}`; const resultFile = join(here, `result-${label}.json`);
    const evil = await listener();
    try {
      fakePhp(dir, `http://127.0.0.1:${evil.port}/b/v0-range-probe/x/probe.bin?${SIGNED}`);
      const r = await runProbe({ PATH: `${dir}:${process.env.PATH}`, S3_ENDPOINT: endpoint }, label);
      assert.deepEqual(evil.seen, { connections: 0, requests: 0 }, 'the malicious host must receive nothing');
      assert.equal(r.code, 1, r.err);
      assert.ok(existsSync(resultFile), 'a redacted report is still written');
      const rep = JSON.parse(readFileSync(resultFile, 'utf8'));
      assert.equal(rep.upstreamGuard.requestsAllowed, 0);
      assert.equal(rep.upstreamGuard.requestsRefused, 1);
      assert.deepEqual(rep.upstreamGuard.refusedReasons, ['host-not-allowed']);
      assert.ok(/refused/.test(rep.fatal));
      const all = `${r.out}${r.err}${readFileSync(resultFile, 'utf8')}`;
      assert.ok(!/cafebabe|KEYKEY|SECRETSECRET/.test(all) && !all.includes(String(evil.port)), 'no signature, credential or malicious URL anywhere in the output');
    } finally { evil.close(); rmSync(dir, { recursive: true, force: true }); rmSync(resultFile, { force: true }); }
  });
}
