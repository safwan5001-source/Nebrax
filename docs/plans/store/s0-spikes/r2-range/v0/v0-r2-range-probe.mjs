// V0 SPIKE — NOT production code. Validates architecture B2 against a real object store: Laravel signs a short-lived GET URL (v0-signer.php, the app's
// own AWS SDK), the Node side fetches it server-to-server with the browser's Range headers. This is the Node half: it plays the storefront proxy.
//
//   usage:  node v0-r2-range-probe.mjs --plan                     print the reproducible test plan (needs no credentials)
//           node v0-r2-range-probe.mjs --hostlist                 offline SSRF host allow-list checks only (needs no credentials)
//           S3_ENDPOINT=… S3_KEY=… S3_SECRET=… S3_BUCKET=… [S3_REGION=auto] [S3_PATH_STYLE=0|1] \
//             node v0-r2-range-probe.mjs --label=r2-pathstyle --autoload=/path/to/vendor/autoload.php [--size-mib=8] [--ttl=4]
//
// SECURITY: presigned URLs are bearer tokens. They live only in memory in this process; nothing here prints or writes a URL, a signature, a credential or the
// account id. Provider response headers are reduced to an allow-list; error bodies to the S3 <Code>. The probe writes only the key prefix v0-range-probe/<run>/
// of the TEST bucket and deletes it at the end (and verifies it is gone).
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { allowedUpstream, guardedFetch, UpstreamRefused } from './v0-upstream-guard.mjs';
import { classifyLocation, cleanupGate, etagGate, leakGate, redactText, redirectGate, safeSerialize, scanHeaderValues, scanText, sensitiveTokens } from './v0-gates.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split('=').slice(1).join('=');
const flag = (n) => process.argv.includes(`--${n}`);

// the proxy-side SSRF guard (allowedUpstream) and the only outgoing-request path (guardedFetch) live in v0-upstream-guard.mjs
export { allowedUpstream };

const HOSTLIST_CASES = [
  ['exact endpoint host', 'https://acct.r2.cloudflarestorage.com/b/k?X-Amz-Signature=x', true],
  ['virtual-hosted bucket host', 'https://b.acct.r2.cloudflarestorage.com/k?X-Amz-Signature=x', true],
  ['other bucket on the same account', 'https://other.acct.r2.cloudflarestorage.com/k', false],
  ['look-alike suffix', 'https://acct.r2.cloudflarestorage.com.evil.example/b/k', false],
  ['look-alike prefix', 'https://evilacct.r2.cloudflarestorage.com/b/k', false],
  ['userinfo trick', 'https://acct.r2.cloudflarestorage.com@evil.example/b/k', false],
  ['userinfo present', 'https://user:pw@acct.r2.cloudflarestorage.com/b/k', false],
  ['plain http to the real host', 'http://acct.r2.cloudflarestorage.com/b/k', false],
  ['explicit port', 'https://acct.r2.cloudflarestorage.com:8443/b/k', false],
  ['IP literal', 'https://169.254.169.254/latest/meta-data', false],
  ['localhost', 'https://localhost/b/k', false],
  ['different scheme', 'ftp://acct.r2.cloudflarestorage.com/b/k', false],
  ['not a URL', 'not a url', false],
  ['empty', '', false],
  ['uppercase host', 'https://ACCT.R2.CLOUDFLARESTORAGE.COM/b/k', true],
];
function runHostlist() {
  const cfg = { endpoint: 'https://acct.r2.cloudflarestorage.com', bucket: 'b' };
  return HOSTLIST_CASES.map(([name, url, expected]) => ({ name, expected, observed: allowedUpstream(url, cfg), pass: allowedUpstream(url, cfg) === expected }));
}

// ───────────────────────────── test plan ─────────────────────────────
// group R = required for B2 (a failure is a blocker or needs a proxy-side shim); I = informational (behaviour recorded, shim decided from it)
const PLAN = [
  ['R1', 'R', 'Full GET with a presigned URL → 200, Content-Length = size, Accept-Ranges: bytes, ETag, Content-Type, body sha256 matches'],
  ['R2', 'R', 'Range bytes=100-199 → 206, Content-Range "bytes 100-199/N", 100 bytes, body matches'],
  ['R3', 'R', 'Range bytes=0-0 → 206, 1 byte'],
  ['R4', 'R', 'Safari probe bytes=0-1 → 206, 2 bytes'],
  ['R5', 'R', 'Open-ended bytes=<N-500>- → 206 to the last byte'],
  ['R6', 'R', 'Suffix bytes=-500 → 206, last 500 bytes'],
  ['R7', 'R', 'End beyond EOF bytes=0-<2N> → 206 clamped to N-1'],
  ['R8', 'R', 'Start == size → 416 (a Content-Range "bytes */N" from the provider is recorded, not required: the proxy knows N from the authorise response and always synthesises it)'],
  ['R9', 'R', 'Start > size → 416'],
  ['R10', 'R', 'Last byte bytes=<N-1>- → 206, 1 byte'],
  ['R11', 'R', 'One strong, quoted ETag on EVERY successful response for the object: the 200, every 206 (closed, open-ended, suffix, EOF-clamped, If-Range, parallel…) and the HEAD'],
  ['R12', 'R', 'With Accept-Encoding: identity the 200 and 206 carry no Content-Encoding (video/mp4)'],
  ['R13', 'R', 'No 3xx on any correctly signed HTTPS request (redirect: manual). Negative controls and the informational I10 probe never feed this gate'],
  ['R14', 'R', 'Expired URL (TTL elapsed) → 403, nothing served'],
  ['R15a', 'R', 'Tampered signature → 403'],
  ['R15b', 'R', 'Signed for key A, used for key B → 403'],
  ['R15c', 'R', 'X-Amz-Expires extended after signing → 403'],
  ['R15d', 'R', 'Signature removed → 403/400'],
  ['R16a', 'R', 'PUT with a GET-signed URL → 403, object unchanged'],
  ['R16b', 'R', 'DELETE with a GET-signed URL → 403, object still present'],
  ['R17', 'R', 'Unsigned GET of the same object → 403 (bucket is private)'],
  ['R18', 'R', 'No provider response header NAME or VALUE exposes a credential, a signature, SigV4 material or the signed URL (every header of every response is scanned)'],
  ['R19', 'R', 'Host allow-list (offline, 15 cases) accepts only the endpoint or <bucket>.<endpoint>, https, no userinfo/port tricks'],
  ['R20', 'R', 'Every URL the signer produced passes the host allow-list'],
  ['I1', 'I', 'HEAD with a HEAD-signed URL → 200 with the same metadata'],
  ['I2', 'I', 'HEAD with a GET-signed URL (record)'],
  ['I3', 'I', 'Multi-range bytes=0-1,5-6 (record; B2 proxy will refuse multi-range)'],
  ['I4', 'I', 'Malformed ranges: bytes=abc, bytes=5-2, items=0-1, bytes=-0, bytes=--5, bytes=0-9, , Bytes=0-1 (record)'],
  ['I5', 'I', 'Suffix larger than the object bytes=-<N+10> (record)'],
  ['I6', 'I', 'If-Range: matching ETag → 206 ; mismatching ETag → 200 (RFC) or ignored ; HTTP-date (record)'],
  ['I7', 'I', 'If-Match wrong → 412 ; If-None-Match current (with Range) → 304 (record)'],
  ['I8', 'I', 'Accept-Encoding: gzip on video/mp4 → Content-Encoding? (record)'],
  ['I9', 'I', 'Download started before expiry and still running after it (record whether it completes)'],
  ['I10', 'I', 'Plain http:// to the real https endpoint (record: refused / redirected to https is ACCEPTABLE and does not affect R13) — remote endpoints only'],
  ['I11', 'I', '8 parallel ranges all correct'],
  ['I12', 'I', 'Empty object: full GET 200 len 0 ; bytes=0-0 → 416 (record)'],
  ['I13', 'I', 'Oversized Range header (8 KiB) (record)'],
  ['I14', 'I', 'Provider ERROR BODIES that echo credential or signature material (kinds only; the proxy must never forward upstream bodies)'],
];

if (flag('plan')) {
  console.log('V0 R2 presigned Range — reproducible test plan (no credentials needed to read it)\n');
  for (const [id, g, d] of PLAN) console.log(`${id.padEnd(5)} [${g === 'R' ? 'required' : 'info    '}] ${d}`);
  console.log('\nRun with credentials scoped to the TEST bucket only (see README.md). Run twice: S3_PATH_STYLE=1 and S3_PATH_STYLE=0.');
  process.exit(0);
}
if (flag('hostlist')) {
  const rows = runHostlist();
  for (const r of rows) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
  process.exit(rows.every((r) => r.pass) ? 0 : 1);
}

// ───────────────────────────── runtime ─────────────────────────────
const cfg = {
  endpoint: process.env.S3_ENDPOINT ?? '', bucket: process.env.S3_BUCKET ?? '', style: process.env.S3_PATH_STYLE === '1' ? 'path' : 'virtual-hosted',
  label: arg('label', 'run'), autoload: arg('autoload', join(here, 'vendor/autoload.php')), sizeMiB: +arg('size-mib', 8), ttl: +arg('ttl', 4),
  loopback: /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(process.env.S3_ENDPOINT ?? ''),
};
for (const k of ['S3_ENDPOINT', 'S3_KEY', 'S3_SECRET', 'S3_BUCKET']) if (!process.env[k]) { console.error(`missing environment variable ${k} (see README.md; use --plan to read the test plan without credentials)`); process.exit(2); }
const N = Math.round(cfg.sizeMiB * 1048576);
const secrets = [process.env.S3_KEY, process.env.S3_SECRET].filter(Boolean);
const accountLike = (() => { try { return new URL(cfg.endpoint).hostname.split('.')[0]; } catch { return ''; } })();
// The ONE redaction path for anything that is kept or printed. Token-aware (credentials, every URL ever requested and its signature / credential / token parts, in every
// encoding) on top of the generic presign markers; a regex over `X-Amz-*=` alone is not enough (review round 3). `tk` lets hit() compute the token set once per response.
const scrub = (s, tk = tokens()) => { let t = redactText(String(s), tk).text; for (const v of secrets) t = t.split(v).join('<secret>'); if (accountLike && !cfg.loopback) t = t.split(accountLike).join('<account>'); return t; };
// ORDER MATTERS: token redaction runs FIRST. Replacing the access key id (a substring of every signed URL's X-Amz-Credential) before it would mutate an echoed URL so that the
// whole-URL token no longer matched, leaving the host/path and key prefix in the report.

function signer(request) {
  const r = spawnSync('php', [join(here, 'v0-signer.php'), cfg.autoload], { input: JSON.stringify(request), encoding: 'utf8', env: process.env, maxBuffer: 1 << 20 });
  try { return JSON.parse(r.stdout); } catch { return { error: 'signer-unparseable', status: r.status }; }
}
const RUN = randomBytes(6).toString('hex');
const KEY = `v0-range-probe/${RUN}/probe.bin`;
const KEY_B = `v0-range-probe/${RUN}/other.bin`;
const KEY_EMPTY = `v0-range-probe/${RUN}/empty.bin`;
const sign = (method, key, ttl = 120, query) => { const r = signer({ op: 'presign', method, key, ttl, query }); if (!r.url) throw new Error(`signer failed: ${scrub(JSON.stringify(r))}`); return r.url; };

const KEEP = ['status', 'content-length', 'content-range', 'accept-ranges', 'etag', 'content-type', 'content-encoding', 'last-modified', 'location', 'content-disposition', 'cache-control', 'x-amz-request-id', 'cf-cache-status', 'server', 'x-amz-id-2', 'www-authenticate'];
const sensitiveUrls = new Set();
const tokens = () => sensitiveTokens({ secrets, urls: [...sensitiveUrls] });
const upstreamPolicy = { endpoint: cfg.endpoint, bucket: process.env.S3_BUCKET, allowInsecureLoopback: cfg.loopback };
let upstreamAllowed = 0; const upstreamRefused = [];
async function hit(url, { method = 'GET', headers = {}, body, read = true, keepBody = false, plainHttpProbe = false } = {}) {
  sensitiveUrls.add(url); // every URL we ever send (signed, derived or tampered) is something the provider must never echo back
  const h = { 'accept-encoding': 'identity', ...headers };
  // The allow-list is enforced BEFORE any connection: a disallowed host never receives a request (and so never sees the signature). A refusal is recorded (reason only) and fails the run.
  let res;
  try { res = await guardedFetch(url, { method, headers: h, body, plainHttpProbe }, upstreamPolicy); } catch (e) { if (e instanceof UpstreamRefused) upstreamRefused.push(e.reason); throw e; }
  upstreamAllowed += 1;
  const tk = tokens();
  const seen = {}; const allNames = []; const rawEntries = [];
  // every retained VALUE and every NAME is redacted against the token set before it can reach `seen` / `headerNames` (and from there the JSON report)
  res.headers.forEach((v, k) => { allNames.push(scrub(k, tk)); rawEntries.push([k, v]); if (KEEP.includes(k)) seen[k] = scrub(v, tk); });
  let len = 0; let sha = null; let errorCode = null; let bodyLeaks = [];
  if (keepBody) { /* streaming body left untouched for the caller (I9) */ } else if (read && method !== 'HEAD') {
    const hash = createHash('sha256'); const chunks = [];
    for await (const c of res.body ?? []) { len += c.length; hash.update(c); if (len <= 4096) chunks.push(c); }
    sha = hash.digest('hex');
    if (res.status >= 400) { const text = Buffer.concat(chunks).toString('utf8'); errorCode = scrub((text.match(/<Code>([^<]+)<\/Code>/) ?? [])[1] ?? '', tk) || null; bodyLeaks = scanText(text, tk); }
  } else { await res.body?.cancel().catch(() => undefined); }
  // header VALUES are scanned here, in memory, against the unscrubbed tokens; only {header, kind} survives
  const valueFindings = [...scanHeaderValues(rawEntries, tk), ...scanHeaderValues(rawEntries.map(([k]) => ['<header-name>', k]), tk)];
  return { ...(keepBody ? { res } : {}), status: res.status, headers: seen, headerNames: allNames, valueFindings, bodyLeaks, bodyLen: len, sha, errorCode, locationClass: res.headers.get('location') ? classifyLocation(res.headers.get('location'), new URL(cfg.endpoint).hostname) : null };
}

const data = randomBytes(N);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const slice = (s, e) => data.subarray(s, e + 1);
const results = []; const allHeaderNames = new Set(); const producedUrls = [];
const redirectLog = []; const etagLog = []; const valueFindings = []; const bodyLeakKinds = new Set();
const D = Object.fromEntries(PLAN.map(([id, , d]) => [id, d]));
const rec = (id, group, _ignored, pass, observed, note) => { results.push({ id, group, description: D[id], pass, observed, ...(note ? { note } : {}) }); };
// kind: 'signed' = a correctly signed HTTPS request (feeds R13) · 'negative' = tampered/unsigned/expired/wrong-method control · 'informational' = I10 (a redirect to https is fine).
// label: identifies a response for the ETag gate (R11) — every successful response for the test object must carry one.
const track = (r, kind = 'signed', label = null) => {
  const id = label ?? `${kind}#${redirectLog.length}`;
  r.headerNames.forEach((n) => allHeaderNames.add(n));
  redirectLog.push({ id, kind, status: r.status });
  r.valueFindings.forEach((f) => valueFindings.push({ id, ...f }));
  r.bodyLeaks.forEach((k) => bodyLeakKinds.add(k));
  if (label) etagLog.push({ id: label, status: r.status, etag: r.headers.etag ?? null });
  return r;
};
const brief = (r) => ({ status: r.status, ...(r.errorCode ? { errorCode: r.errorCode } : {}), headers: r.headers, bodyLen: r.bodyLen });

const tmp = mkdtempSync(join(tmpdir(), 'v0-'));
let cleanupEntries = [];
let etag = null; let started = false; let fatal = null;
try {
  if (process.env.S3_CREATE_BUCKET === '1') signer({ op: 'create-bucket' });
  writeFileSync(join(tmp, 'probe.bin'), data); writeFileSync(join(tmp, 'other.bin'), randomBytes(1024)); writeFileSync(join(tmp, 'empty.bin'), Buffer.alloc(0));
  started = true;
  const put = signer({ op: 'put', key: KEY, file: join(tmp, 'probe.bin'), contentType: 'video/mp4' });
  if (!put.ok || put.error) throw new Error(`test object upload failed: ${scrub(JSON.stringify(put))}`);
  etag = put.etag;
  if (signer({ op: 'put', key: KEY_B, file: join(tmp, 'other.bin'), contentType: 'video/mp4' }).error) throw new Error('second test object upload failed');
  if (signer({ op: 'put', key: KEY_EMPTY, file: join(tmp, 'empty.bin'), contentType: 'video/mp4' }).error) throw new Error('empty test object upload failed');

  const getUrl = sign('GET', KEY); producedUrls.push(getUrl);
  const R = async (v, extra, label) => track(await hit(getUrl, { headers: { range: v, ...extra } }), 'signed', label ?? `range ${v}${extra ? ` +${Object.keys(extra).join(',')}` : ''}`);

  // R1
  const full = track(await hit(getUrl), 'signed', 'R1');
  rec('R1', 'R', PLAN[0][2], full.status === 200 && full.headers['content-length'] === String(N) && full.headers['accept-ranges'] === 'bytes' && !!full.headers.etag && full.headers['content-type'] === 'video/mp4' && full.sha === sha(data), brief(full));
  const ranged = async (id, desc, v, s, e, expectStatus = 206) => {
    const r = await R(v, undefined, id); const want = `bytes ${s}-${e}/${N}`;
    rec(id, 'R', desc, r.status === expectStatus && r.headers['content-range'] === want && r.bodyLen === e - s + 1 && r.sha === sha(slice(s, e)) && r.headers['content-length'] === String(e - s + 1), { range: v, ...brief(r) });
    return r;
  };
  const r2 = await ranged('R2', PLAN[1][2], 'bytes=100-199', 100, 199);
  const r3 = await ranged('R3', PLAN[2][2], 'bytes=0-0', 0, 0);
  const r4 = await ranged('R4', PLAN[3][2], 'bytes=0-1', 0, 1);
  await ranged('R5', PLAN[4][2], `bytes=${N - 500}-`, N - 500, N - 1);
  await ranged('R6', PLAN[5][2], 'bytes=-500', N - 500, N - 1);
  await ranged('R7', PLAN[6][2], `bytes=0-${N * 2}`, 0, N - 1);
  const r8 = await R(`bytes=${N}-${N + 10}`, undefined, 'R8');
  rec('R8', 'R', PLAN[7][2], r8.status === 416, { range: `bytes=${N}-${N + 10}`, providerSendsContentRangeStar: r8.headers['content-range'] === `bytes */${N}`, ...brief(r8) }, 'Criterion relaxed after the local self-test: S3-compatible servers answer 416 with an XML InvalidRange error and no Content-Range; the proxy builds the header itself.');
  const r9 = await R(`bytes=${N + 5000}-`, undefined, 'R9');
  rec('R9', 'R', PLAN[8][2], r9.status === 416, { range: `bytes=${N + 5000}-`, ...brief(r9) });
  const r10 = await ranged('R10', PLAN[9][2], `bytes=${N - 1}-`, N - 1, N - 1);

  // HEAD (I1) with a HEAD-signed URL, needed for R11
  const headUrl = sign('HEAD', KEY); producedUrls.push(headUrl);
  const head = track(await hit(headUrl, { method: 'HEAD' }), 'signed', 'I1');
  rec('I1', 'I', PLAN[23][2], head.status === 200 && head.headers['content-length'] === String(N) && head.headers['accept-ranges'] === 'bytes', brief(head));
  // R11 is judged at the END over every successful response for the test object (see etagGate); placeholder removed here

  rec('R12', 'R', PLAN[11][2], !full.headers['content-encoding'] && !r2.headers['content-encoding'], { full: full.headers['content-encoding'] ?? null, range: r2.headers['content-encoding'] ?? null });

  // R17 unsigned
  const bare = getUrl.split('?')[0];
  const unsigned = track(await hit(bare), 'negative');
  rec('R17', 'R', PLAN[20][2], unsigned.status === 403, brief(unsigned));

  // R15 tamper
  const u = new URL(getUrl);
  const sigParam = [...u.searchParams.keys()].find((k) => k.toLowerCase() === 'x-amz-signature');
  const tamperSig = new URL(getUrl); const sig = tamperSig.searchParams.get(sigParam); tamperSig.searchParams.set(sigParam, (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1));
  const t1 = track(await hit(tamperSig.toString()), 'negative');
  rec('R15a', 'R', PLAN[14][2], t1.status === 403, brief(t1));
  // sign for A, use for B: swap the object key segment in the path
  const swapped = getUrl.replace(KEY, KEY_B);
  const t2 = track(await hit(swapped), 'negative');
  rec('R15b', 'R', PLAN[15][2], swapped !== getUrl && t2.status === 403, brief(t2));
  const expParam = [...u.searchParams.keys()].find((k) => k.toLowerCase() === 'x-amz-expires');
  const longer = new URL(getUrl); longer.searchParams.set(expParam, String(+longer.searchParams.get(expParam) + 3600));
  const t3 = track(await hit(longer.toString()), 'negative');
  rec('R15c', 'R', PLAN[16][2], t3.status === 403, brief(t3));
  const nosig = new URL(getUrl); nosig.searchParams.delete(sigParam);
  const t4 = track(await hit(nosig.toString()), 'negative');
  rec('R15d', 'R', PLAN[17][2], t4.status === 403 || t4.status === 400, brief(t4));

  // R16 method confusion (destructive attempts are only ever made against the disposable TEST objects)
  const put16 = track(await hit(getUrl, { method: 'PUT', body: Buffer.from('tampered') }), 'negative');
  const afterPut = track(await hit(getUrl, { headers: { range: 'bytes=0-15' } }), 'signed', 'R16a-after');
  rec('R16a', 'R', PLAN[18][2], put16.status === 403 && afterPut.sha === sha(slice(0, 15)), { put: brief(put16), objectUnchanged: afterPut.sha === sha(slice(0, 15)) });
  const del16 = track(await hit(getUrl, { method: 'DELETE' }), 'negative');
  const afterDel = track(await hit(getUrl, { headers: { range: 'bytes=0-15' } }), 'signed', 'R16b-after');
  rec('R16b', 'R', PLAN[19][2], del16.status === 403 && afterDel.status === 206, { delete: brief(del16), stillPresent: afterDel.status === 206 });

  // I2 HEAD with a GET-signed URL
  const headWithGet = track(await hit(getUrl, { method: 'HEAD' }), 'negative');
  rec('I2', 'I', PLAN[24][2], null, brief(headWithGet), 'S3 signs the HTTP method; a GET-signed URL is expected to be refused for HEAD. B2 needs no HEAD at the proxy (size/ETag come from the authorise response).');

  // I3 multi-range
  const mr = await R('bytes=0-1,5-6', undefined, 'I3');
  rec('I3', 'I', PLAN[25][2], null, { ...brief(mr), singleRangeServed: mr.bodyLen === 2 });
  // I4 malformed
  const malformed = [];
  for (const v of ['bytes=abc', 'bytes=5-2', 'items=0-1', 'bytes=-0', 'bytes=--5', 'bytes=0-9,', 'Bytes=0-1', 'bytes = 0-1']) { const r = await R(v, undefined, `I4 ${v}`); malformed.push({ range: v, status: r.status, contentRange: r.headers['content-range'] ?? null, bodyLen: r.bodyLen, ...(r.errorCode ? { errorCode: r.errorCode } : {}) }); }
  rec('I4', 'I', PLAN[26][2], null, malformed, 'B2: the proxy validates Range itself (single closed/open/suffix range only) and never forwards anything else.');
  // I5 suffix larger
  const sl = await R(`bytes=-${N + 10}`, undefined, 'I5');
  rec('I5', 'I', PLAN[27][2], null, brief(sl));
  // I6 If-Range
  const ifOk = await R('bytes=0-9', { 'if-range': etag ? `"${etag}"` : full.headers.etag }, 'I6-matching');
  const ifBad = await R('bytes=0-9', { 'if-range': '"00000000000000000000000000000000"' }, 'I6-mismatching');
  const ifDate = await R('bytes=0-9', { 'if-range': full.headers['last-modified'] ?? 'Mon, 01 Jan 2001 00:00:00 GMT' }, 'I6-date');
  rec('I6', 'I', PLAN[28][2], null, { matching: brief(ifOk), mismatching: brief(ifBad), httpDate: brief(ifDate), ifRangeHonoured: ifOk.status === 206 && ifBad.status === 200 }, 'If the mismatching ETag still yields 206, R2 ignores If-Range → the proxy must implement If-Range itself against the authorised ETag (immutable keys make this cheap).');
  // I7 conditionals
  const im = await R('bytes=0-9', { 'if-match': '"00000000000000000000000000000000"' }, 'I7-if-match');
  const inm = await R('bytes=0-9', { 'if-none-match': full.headers.etag }, 'I7-if-none-match');
  rec('I7', 'I', PLAN[29][2], null, { ifMatchWrong: brief(im), ifNoneMatchCurrent: brief(inm) });
  // I8 gzip
  const gz = track(await hit(getUrl, { headers: { 'accept-encoding': 'gzip', range: 'bytes=0-99' } }), 'signed', 'I8');
  rec('I8', 'I', PLAN[30][2], null, { ...brief(gz), contentEncoding: gz.headers['content-encoding'] ?? null });
  // I11 parallel
  const par = await Promise.all(Array.from({ length: 8 }, (_, i) => hit(getUrl, { headers: { range: `bytes=${i * 1000}-${i * 1000 + 999}` } })));
  par.forEach((r, i) => track(r, 'signed', `I11-${i}`));
  rec('I11', 'I', PLAN[32][2], par.every((r, i) => r.status === 206 && r.sha === sha(slice(i * 1000, i * 1000 + 999))), { statuses: par.map((r) => r.status) });
  // I12 empty object
  const emptyUrl = sign('GET', KEY_EMPTY); producedUrls.push(emptyUrl);
  const e1 = track(await hit(emptyUrl), 'signed'); const e2 = track(await hit(emptyUrl, { headers: { range: 'bytes=0-0' } }), 'signed');
  rec('I12', 'I', PLAN[33][2], null, { full: brief(e1), range0: brief(e2) });
  // I13 oversized header
  let big; try { big = await R(`bytes=0-1,${'1-2,'.repeat(2000)}`, undefined, 'I13'); big = brief(big); } catch (e) { big = { error: scrub(e.message) }; }
  rec('I13', 'I', PLAN[34][2], null, big);

  // I10 plain http. INFORMATIONAL: a refusal or a redirect to https are both acceptable outcomes and never feed the R13 gate (which is about correctly signed HTTPS requests).
  // On a loopback look-alike (plain http only) the probe is skipped unless the self-test hook V0_SELFTEST_PLAIN_HTTP_HOOK=1 asks it to send an `x-v0-plain` marker that the fault injector answers with a 301.
  if (!cfg.loopback || process.env.V0_SELFTEST_PLAIN_HTTP_HOOK === '1') {
    const plainUrl = cfg.loopback ? getUrl : getUrl.replace(/^https:/, 'http:');
    let obs; try { const r = track(await hit(plainUrl, { headers: cfg.loopback ? { 'x-v0-plain': '1' } : {}, plainHttpProbe: !cfg.loopback }), 'informational', 'I10'); obs = { ...brief(r), redirectsTo: r.locationClass }; } catch (e) { obs = { refused: true, error: scrub(e.cause?.code ?? e.message) }; }
    rec('I10', 'I', PLAN[31][2], null, obs, 'Real endpoints should refuse or redirect plain http; a redirect to https is acceptable and is NOT counted by R13. The proxy refuses any non-https URL before connecting (R19).');
  } else rec('I10', 'I', PLAN[31][2], null, { skipped: 'loopback look-alike' });

  // R14 expiry + I9 mid-stream expiry (they overlap in time to save wall-clock)
  const shortUrl = sign('GET', KEY, cfg.ttl); producedUrls.push(shortUrl);
  const okBefore = track(await hit(shortUrl, { headers: { range: 'bytes=0-9' } }), 'signed', 'R14-before');
  // I9: start a slow full download now; it will outlive the TTL
  const slowStart = Date.now();
  // routed through hit()/track() like every other request (status → R13, ETag → R11, header values → R18) WITHOUT consuming its streaming body
  const slow = track(await hit(shortUrl, { keepBody: true }), 'signed', 'I9');
  const slowRes = slow.res;
  let slowBytes = 0; let slowErr = null;
  const slowRead = (async () => { try { for await (const c of slowRes.body) { slowBytes += c.length; await sleep(Math.ceil((c.length / (1024 * 1024)) * 1000)); } } catch (e) { slowErr = scrub(e.cause?.code ?? e.message); } })();
  await sleep((cfg.ttl + 2) * 1000);
  const expired = track(await hit(shortUrl, { headers: { range: 'bytes=0-9' } }), 'negative');
  rec('R14', 'R', PLAN[13][2], okBefore.status === 206 && expired.status === 403, { before: brief(okBefore), afterTtl: brief(expired), ttlSeconds: cfg.ttl });
  await slowRead;
  rec('I9', 'I', PLAN[38 - 1 + 0 > 0 ? 36 : 36][2] ?? '', null, { status: slowRes.status, startedBeforeExpiry: true, ranPastTtlMs: Date.now() - slowStart, receivedBytes: slowBytes, completed: slowBytes === N, error: slowErr, socketErrorAfterAllBytes: !!slowErr && slowBytes === N }, 'S3/R2 validate the signature when the request starts; whether an in-flight body survives expiry is recorded here. The proxy sets its own total deadline anyway.');

  // R13 / R18 / R20 / R19
  const redirects = redirectGate(redirectLog);
  rec('R13', 'R', PLAN[12][2], redirects.pass, redirects);
  const etagResult = etagGate(etagLog, ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R10', 'I1']);
  rec('R11', 'R', PLAN[10][2], etagResult.pass, { ...etagResult, putEtag: etag == null ? null : scrub(etag) });
  const leaks = leakGate({ headerNames: [...allHeaderNames], valueFindings });
  rec('R18', 'R', PLAN[21][2], leaks.pass, { providerHeaderNames: [...allHeaderNames].sort(), suspiciousNames: leaks.suspiciousNames, valueLeaks: leaks.valueLeaks, responsesScanned: redirectLog.length });
  rec('I14', 'I', PLAN[36][2], null, { bodyLeakKinds: [...bodyLeakKinds].sort() }, 'Informational: some S3 implementations echo the access key id or string-to-sign in error documents. The proxy never forwards upstream bodies (empty uniform failures), so this is a log-hygiene note.');
  const hl = runHostlist();
  rec('R19', 'R', PLAN[22][2], hl.every((r) => r.pass), { cases: hl.length, failed: hl.filter((r) => !r.pass).map((r) => r.name) });
  rec('R20', 'R', PLAN[23][2] && 'Every URL the signer produced passes the host allow-list', producedUrls.every((x) => allowedUpstream(x, upstreamPolicy)), { urls: producedUrls.length });
} catch (e) {
  // A thrown matrix still produces a (redacted) report and a nonzero exit; the raw error is never printed — a library error can carry a URL.
  fatal = scrub(e?.cause?.code ?? e?.message ?? e);
  console.error(`FATAL: matrix aborted: ${fatal}`);
} finally {
  // Cleanup is verified, not assumed: delete each disposable object, then require HEAD → 404 for it. Runs even when the matrix threw.
  cleanupEntries = started ? [['probe', KEY], ['other', KEY_B], ['empty', KEY_EMPTY]].map(([label, key]) => {
    const del = signer({ op: 'delete', key }); const head = signer({ op: 'head', key });
    return { label, deleteOk: !del.error, headStatus: head.error === 'aws' ? head.status : (head.ok ? 200 : null) };
  }) : [];
  rmSync(tmp, { recursive: true, force: true });
}
const cleanup = cleanupGate(cleanupEntries);
const cleaned = cleanup.pass;
if (!cleanup.pass) console.error(`CLEANUP NOT VERIFIED — remaining: [${cleanup.remaining}] unverified: [${cleanup.unverified}] deleteFailed: [${cleanup.deleteFailed}]. Remove the prefix v0-range-probe/${RUN}/ from the test bucket by hand.`);
const required = results.filter((r) => r.group === 'R');
const failed = required.filter((r) => r.pass !== true);
const report = {
  label: cfg.label, generatedAt: new Date().toISOString(), provider: cfg.loopback ? 'LOCAL LOOK-ALIKE (not R2)' : 'remote S3 API',
  endpointHost: cfg.loopback ? new URL(cfg.endpoint).host : '<account>.' + new URL(cfg.endpoint).hostname.split('.').slice(1).join('.'),
  addressingStyle: cfg.style, objectBytes: N, ttlSeconds: cfg.ttl, runId: RUN, cleanedUp: cleaned, cleanup,
  upstreamGuard: { enforced: 'before every outgoing request (guardedFetch)', requestsAllowed: upstreamAllowed, requestsRefused: upstreamRefused.length, refusedReasons: [...new Set(upstreamRefused)] },
  ...(fatal ? { fatal } : {}),
  summary: { required: required.length, requiredPassed: required.length - failed.length, requiredFailed: failed.map((r) => r.id), info: results.filter((r) => r.group === 'I').length },
  results,
};
// Last line of defence: the finished report is redacted and the SERIALISED text is scanned again before anything touches the disk. If a sensitive value is still present
// the file is NOT written (exit 1, kinds only). A non-empty sweep also fails the run: it means a value reached the report without passing scrub() upstream.
const serial = safeSerialize(report, tokens());
const outPath = join(here, `result-${cfg.label}.json`);
if (serial.clean) writeFileSync(outPath, serial.text + '\n');
else console.error(`REPORT NOT WRITTEN: sensitive material (${serial.sweepKinds.join(', ')}) survived redaction`);
if (serial.sweepKinds.length) console.error(`REDACTION SWEEP removed [${serial.sweepKinds.join(', ')}] from the report — a value bypassed scrub(); fix the call site`);
console.log(`label=${cfg.label} provider=${report.provider} style=${cfg.style} size=${cfg.sizeMiB}MiB ttl=${cfg.ttl}s cleanedUp=${cleaned}`);
for (const r of results) console.log(`${r.id.padEnd(5)} ${r.group === 'R' ? (r.pass ? 'PASS' : 'FAIL') : 'INFO'}  ${r.description.slice(0, 96)}`);
console.log(`required ${report.summary.requiredPassed}/${report.summary.required}  failed: ${failed.map((r) => r.id).join(', ') || 'none'}  cleanup: ${cleanup.pass ? 'verified' : 'NOT VERIFIED (exit 1)'}${fatal ? '  FATAL: matrix aborted (exit 1)' : ''}${upstreamRefused.length ? `  UPSTREAM ALLOW-LIST REFUSED ${upstreamRefused.length} request(s) (exit 1)` : ''}\n${serial.clean ? `wrote ${outPath.replace(process.cwd() + '/', '')}` : 'no result file written'}`);
process.exit(failed.length || !cleanup.pass || fatal || serial.sweepKinds.length || upstreamRefused.length ? 1 : 0);
