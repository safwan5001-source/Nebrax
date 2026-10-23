// Negative control for the isolated I9 experiment (review round 3): if the test object cannot be uploaded the experiment must ABORT with a nonzero exit status and no
// rows — never continue and exit 0. Hermetic: a fake `php` on PATH plays the signer (no S3, no credentials, no network beyond loopback).
//   node --test v0-i9-experiment.test.mjs                                                       → must pass
//   git show <pre-fix sha>:<path>/v0-i9-experiment.mjs > prefix-i9.mjs; V0_I9=./prefix-i9.mjs node --test v0-i9-experiment.test.mjs   → the abort tests must FAIL
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = process.env.V0_I9 ?? join(here, 'v0-i9-experiment.mjs');
const SIGNED = 'X-Amz-Signature=cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe';

function fakePhp(dir, { put, deleteOk = true, headStatus = 404, urlBase }) {
  const bin = join(dir, 'php');
  writeFileSync(bin, `#!/usr/bin/env node
let b = ''; process.stdin.on('data', (d) => { b += d; }); process.stdin.on('end', () => {
  const r = JSON.parse(b || '{}'); const o = ${JSON.stringify({ put, deleteOk, headStatus, urlBase })};
  if (r.op === 'put') return console.log(JSON.stringify(o.put));
  if (r.op === 'delete') return console.log(JSON.stringify(o.deleteOk ? { ok: true } : { error: 'aws', code: 'AccessDenied', status: 403 }));
  if (r.op === 'head') return console.log(JSON.stringify(o.headStatus === 200 ? { ok: true } : { error: 'aws', code: 'NotFound', status: o.headStatus }));
  if (r.op === 'presign') return console.log(JSON.stringify({ ok: true, url: o.urlBase + '?${SIGNED}' }));
  console.log(JSON.stringify({ ok: true }));
});
`);
  chmodSync(bin, 0o755);
}
const run = (env) => new Promise((resolve) => {
  const p = spawn(process.execPath, [script, '--size-mib=0.0625', '--mibps=8'], { env: { ...process.env, S3_ENDPOINT: 'http://127.0.0.1:1', S3_KEY: 'KEYKEYKEY1', S3_SECRET: 'SECRETSECRET1', S3_BUCKET: 'b', ...env } });
  let out = ''; let err = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => resolve({ code, out, err }));
});
const originOf = (base) => new URL(base).origin;
/** A server that must NEVER be contacted: counts TCP connections (not just requests), so even a bare connect/TLS attempt is caught. */
async function withMalicious(fn) {
  let connections = 0; let requests = 0;
  const srv = http.createServer((q, r) => { requests += 1; r.end('x'); });
  srv.on('connection', () => { connections += 1; });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  try { return await fn(`http://127.0.0.1:${srv.address().port}/obj?${SIGNED}`, () => ({ connections, requests })); } finally { srv.close(); }
}
async function withServer(fn) {
  const body = Buffer.alloc(0.0625 * 1048576, 1);
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-length': body.length }); r.end(body); });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  try { return await fn(`http://127.0.0.1:${srv.address().port}/obj`); } finally { srv.close(); }
}
const withDir = async (fn) => { const d = mkdtempSync(join(tmpdir(), 'v0i9t-')); try { return await fn(d); } finally { rmSync(d, { recursive: true, force: true }); } };

test('I9 negative control: a failed test-object upload aborts the experiment — exit 1, aborted reason, NO experiment rows', async () => {
  await withDir(async (dir) => {
    fakePhp(dir, { put: { error: 'aws', code: 'AccessDenied', status: 403 }, urlBase: 'http://127.0.0.1:1/never' });
    const r = await run({ PATH: `${dir}:${process.env.PATH}` });
    assert.equal(r.code, 1, r.err);
    const j = JSON.parse(r.out);
    assert.ok(/upload failed/.test(j.aborted), JSON.stringify(j));
    assert.deepEqual(j.rows, []);
    assert.ok(/ABORTED/.test(r.err));
  });
});
test('I9 negative control: an upload that returns no confirmation (unparseable signer output) also aborts', async () => {
  await withDir(async (dir) => {
    fakePhp(dir, { put: { error: 'signer-unparseable' }, urlBase: 'http://127.0.0.1:1/never' });
    const r = await run({ PATH: `${dir}:${process.env.PATH}` });
    assert.equal(r.code, 1);
    assert.deepEqual(JSON.parse(r.out).rows, []);
  });
});
test('I9: after a failed upload cleanup is still attempted and verified (an object may exist despite the reported failure)', async () => {
  await withDir(async (dir) => {
    fakePhp(dir, { put: { error: 'aws', code: 'InternalError', status: 500 }, headStatus: 200, urlBase: 'http://127.0.0.1:1/never' });
    const r = await run({ PATH: `${dir}:${process.env.PATH}` });
    const j = JSON.parse(r.out);
    assert.equal(r.code, 1);
    assert.equal(j.cleanup.objects, 1);
    assert.deepEqual(j.cleanup.remaining, ['probe']);
  });
});
test('I9 positive control: a successful upload runs both rows, exits 0, and the output carries no signed URL', async () => {
  await withDir(async (dir) => withServer(async (base) => {
    fakePhp(dir, { put: { ok: true, etag: 'abc' }, urlBase: base });
    const r = await run({ PATH: `${dir}:${process.env.PATH}`, S3_ENDPOINT: originOf(base) });
    assert.equal(r.code, 0, r.err);
    const j = JSON.parse(r.out);
    assert.equal(j.rows.length, 2);
    assert.ok(j.rows.every((x) => x.status === 200 && x.complete));
    assert.ok(!r.out.includes('cafebabe') && !r.err.includes('cafebabe'));
  }));
});
test('I9: a cleanup that cannot be verified still exits nonzero after a successful run (previous gate preserved)', async () => {
  await withDir(async (dir) => withServer(async (base) => {
    fakePhp(dir, { put: { ok: true, etag: 'abc' }, headStatus: 500, urlBase: base });
    const r = await run({ PATH: `${dir}:${process.env.PATH}`, S3_ENDPOINT: originOf(base) });
    assert.equal(r.code, 1);
    assert.deepEqual(JSON.parse(r.out).cleanup.unverified, ['probe']);
  }));
});
// ───────────── HTTP status validation (review round 5, P2-A): fetch does not throw on 403/404/500 — only a plain 200 starts the download being measured ─────────────
/** a storage stand-in that answers every request with the given status (and a short error body that must never be treated as the object) */
async function withStatus(status, fn, extraHeaders = {}) {
  let requests = 0;
  const srv = http.createServer((q, r) => { requests += 1; r.writeHead(status, { 'content-type': 'application/xml', ...extraHeaders }); r.end('<Error><Code>X</Code></Error>'); });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  try { return await fn(`http://127.0.0.1:${srv.address().port}/obj`, () => requests); } finally { srv.close(); }
}
for (const status of [403, 404, 500, 503]) {
  test(`I9 fail closed: a download URL answering HTTP ${status} aborts — exit 1, no rows, nothing reads as "survived expiry"; cleanup still verified`, async () => {
    await withDir(async (dir) => withStatus(status, async (base, requests) => {
      fakePhp(dir, { put: { ok: true, etag: 'abc' }, urlBase: base });
      const r = await run({ PATH: `${dir}:${process.env.PATH}`, S3_ENDPOINT: originOf(base) });
      assert.equal(r.code, 1, r.err);
      const j = JSON.parse(r.out);
      assert.ok(new RegExp(`HTTP ${status}, not 200`).test(j.aborted), JSON.stringify(j));
      assert.deepEqual(j.rows, []);
      assert.equal(requests(), 1, 'it stops at the first URL: the second download is never attempted');
      assert.equal(j.cleanup.pass, true, 'cleanup is still attempted and verified');
      assert.ok(/ABORTED/.test(r.err));
      assert.ok(!r.out.includes('cafebabe') && !r.err.includes('cafebabe'), 'no signed URL in the output');
    }));
  });
}
for (const status of [206, 301, 302, 304]) {
  test(`I9 fail closed: a non-200 success/redirect (${status}) is not a download either — exit 1, no rows`, async () => {
    await withDir(async (dir) => withStatus(status, async (base) => {
      fakePhp(dir, { put: { ok: true, etag: 'abc' }, urlBase: base });
      const r = await run({ PATH: `${dir}:${process.env.PATH}`, S3_ENDPOINT: originOf(base) });
      assert.equal(r.code, 1, r.err);
      assert.deepEqual(JSON.parse(r.out).rows, []);
    }, status >= 300 && status < 400 ? { location: 'http://127.0.0.1:1/elsewhere' } : {}));
  });
}
test('I9 fail closed: the SECOND URL failing discards the first URL\'s row — a partial run never reads as a completed experiment', async () => {
  await withDir(async (dir) => {
    const body = Buffer.alloc(0.0625 * 1048576, 1); let n = 0;
    const srv = http.createServer((q, r) => { n += 1; if (n === 1) { r.writeHead(200, { 'content-length': body.length }); r.end(body); } else { r.writeHead(403); r.end('denied'); } });
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    try {
      const base = `http://127.0.0.1:${srv.address().port}/obj`;
      fakePhp(dir, { put: { ok: true, etag: 'abc' }, urlBase: base });
      const r = await run({ PATH: `${dir}:${process.env.PATH}`, S3_ENDPOINT: originOf(base) });
      assert.equal(r.code, 1, r.err);
      const j = JSON.parse(r.out);
      assert.ok(/HTTP 403/.test(j.aborted)); assert.deepEqual(j.rows, []);
    } finally { srv.close(); }
  });
});
test('I9 fail closed: no response at all (connection refused) aborts too — it is not an observation of the expiry', async () => {
  await withDir(async (dir) => {
    const probe = http.createServer(); await new Promise((ok) => probe.listen(0, '127.0.0.1', ok));
    const port = probe.address().port; await new Promise((ok) => probe.close(ok)); // a port nothing listens on
    const base = `http://127.0.0.1:${port}/obj`;
    fakePhp(dir, { put: { ok: true, etag: 'abc' }, urlBase: base });
    const r = await run({ PATH: `${dir}:${process.env.PATH}`, S3_ENDPOINT: originOf(base) });
    assert.equal(r.code, 1, r.err);
    const j = JSON.parse(r.out);
    assert.ok(/before any response/.test(j.aborted), JSON.stringify(j)); assert.deepEqual(j.rows, []);
  });
});
test('I9 positive control (status gate): HTTP 200 still runs both rows and exits 0', async () => {
  await withDir(async (dir) => withServer(async (base) => {
    fakePhp(dir, { put: { ok: true, etag: 'abc' }, urlBase: base });
    const r = await run({ PATH: `${dir}:${process.env.PATH}`, S3_ENDPOINT: originOf(base) });
    assert.equal(r.code, 0, r.err);
    const j = JSON.parse(r.out);
    assert.equal(j.aborted, undefined); assert.equal(j.rows.length, 2); assert.ok(j.rows.every((x) => x.status === 200));
  }));
});
test('I9 source: the response status is checked against 200 before the body is read (structural pin)', () => {
  const src = readFileSync(script, 'utf8');
  const check = src.search(/status !== 200/); const read = src.search(/for await \(const c of res\.body\)/);
  assert.ok(check > 0 && read > 0 && check < read, 'the 200 check must precede the body loop');
});
// ───────────── upstream allow-list (review round 4): the signed URL is fetched only if its host is the configured endpoint ─────────────
for (const [name, endpoint] of [['a remote R2 endpoint (https, other host)', 'https://acct.r2.cloudflarestorage.com'], ['a loopback self-test endpoint (same IP, other port)', 'http://127.0.0.1:9']]) {
  test(`I9 allow-list: a signer URL on a malicious host is refused BEFORE any connection — ${name}`, async () => {
    await withDir(async (dir) => withMalicious(async (maliciousUrl, seen) => {
      fakePhp(dir, { put: { ok: true, etag: 'abc' }, urlBase: maliciousUrl.split('?')[0] });
      const r = await run({ PATH: `${dir}:${process.env.PATH}`, S3_ENDPOINT: endpoint });
      assert.deepEqual(seen(), { connections: 0, requests: 0 }, 'the malicious host must receive nothing');
      assert.equal(r.code, 1, r.err);
      const j = JSON.parse(r.out);
      assert.ok(/refused by the upstream allow-list/.test(j.aborted), JSON.stringify(j));
      assert.deepEqual(j.rows, []);
      assert.equal(j.cleanup.pass, true, 'cleanup is still verified');
      assert.ok(!r.out.includes('cafebabe') && !r.err.includes('cafebabe') && !r.out.includes('127.0.0.1') && !r.err.includes(String(new URL(maliciousUrl).port)), 'no URL, host or signature in the output');
    }));
  });
}
test('I9 allow-list: a URL for the configured host still runs (the guard does not break the experiment)', async () => {
  await withDir(async (dir) => withServer(async (base) => {
    fakePhp(dir, { put: { ok: true, etag: 'abc' }, urlBase: base });
    const r = await run({ PATH: `${dir}:${process.env.PATH}`, S3_ENDPOINT: originOf(base) });
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).rows.length, 2);
  }));
});
test('I9 source: the upload result decides `aborted`, and the exit status includes it (structural pin)', () => {
  const src = readFileSync(script, 'utf8');
  assert.ok(/aborted/.test(src) && /process\.exit\([^\n]*aborted[^\n]*cleanup\.pass/.test(src));
  assert.ok(!/created = !signer/.test(src));
});
test('I9 source: no raw fetch() — the only request path is guardedFetch (allow-list first)', () => {
  const src = readFileSync(script, 'utf8');
  assert.equal((src.match(/(?<![A-Za-z])fetch\(/g) ?? []).length, 0);
  assert.equal((src.match(/\bguardedFetch\(/g) ?? []).length, 1);
});
