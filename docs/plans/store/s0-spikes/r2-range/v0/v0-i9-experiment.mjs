// V0 SPIKE — NOT production code. Isolates case I9 ("does an in-flight download survive the URL's expiry?") from harness timing artefacts.
// The probe's I9 reads 8 MiB at ~1 MiB/s, i.e. for ≈ 8 s — and every look-alike run ended at ≈ 8.0 s with UND_ERR_SOCKET, sometimes 64 KiB short. That coincidence needs separating:
// is it the signature expiring, or a server/transport time limit? So this reads the same object at a SLOWER rate (so the download lasts well past 8 s) with
//   (a) a URL that expires mid-download (ttl 2 s)      (b) a URL that does NOT expire during the download (ttl 120 s)
// If (b) is cut at the same ≈ 8 s mark, the limit is not expiry. Same secrecy rules as the probe: no URL, signature or credential is printed.
// The experiment is only meaningful if its test object exists AND each download URL really starts a download. If the upload fails (or a URL cannot be signed) it ABORTS:
// no rows, a nonzero exit status, and the cleanup is still attempted and verified — a failed upload must never read as "the download survived expiry" or exit 0 (review
// round 3). The same holds for a download URL that answers anything but HTTP 200 (403/404/500 — the fetch API does not throw on those) or that gets no response at all
// (review round 5, P2-A): nothing was in flight, so nothing was measured.
//   S3_ENDPOINT=… S3_KEY=… S3_SECRET=… S3_BUCKET=… [S3_PATH_STYLE=1] node v0-i9-experiment.mjs --autoload=/path/to/vendor/autoload.php [--mibps=0.5] [--size-mib=8]
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { cleanupGate, safeSerialize, sensitiveTokens } from './v0-gates.mjs';
import { guardedFetch, UpstreamRefused } from './v0-upstream-guard.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split('=').slice(1).join('=');
for (const k of ['S3_ENDPOINT', 'S3_KEY', 'S3_SECRET', 'S3_BUCKET']) if (!process.env[k]) { console.error(`missing environment variable ${k}`); process.exit(2); }
const autoload = arg('autoload', join(here, 'vendor/autoload.php')); const mibps = +arg('mibps', 0.5); const N = Math.round(+arg('size-mib', 8) * 1048576);
const signer = (req) => { const r = spawnSync('php', [join(here, 'v0-signer.php'), autoload], { input: JSON.stringify(req), encoding: 'utf8', env: process.env }); try { return JSON.parse(r.stdout); } catch { return { error: 'signer-unparseable' }; } };
const KEY = `v0-range-probe/i9-${randomBytes(4).toString('hex')}/probe.bin`;
const tmp = mkdtempSync(join(tmpdir(), 'v0i9-'));
let attempted = false; let aborted = null; let cleanup;
const rows = [];
const sensitiveUrls = [];
// the same allow-list as the probe, enforced before the request is made (a signed URL for any other host is never fetched)
const policy = { endpoint: process.env.S3_ENDPOINT, bucket: process.env.S3_BUCKET, allowInsecureLoopback: /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(process.env.S3_ENDPOINT) };
const secrets = [process.env.S3_KEY, process.env.S3_SECRET].filter(Boolean);
try {
  writeFileSync(join(tmp, 'p.bin'), randomBytes(N));
  if (process.env.S3_CREATE_BUCKET === '1') signer({ op: 'create-bucket' });
  attempted = true; // from here on an object MAY exist (even after a reported failure), so cleanup is always attempted and verified
  const put = signer({ op: 'put', key: KEY, file: join(tmp, 'p.bin'), contentType: 'video/mp4' });
  if (put.ok !== true || put.error) aborted = `test object upload failed (${put.error === 'aws' ? `aws ${put.code ?? put.status ?? 'error'}` : put.error ?? 'no confirmation'})`;
  else for (const [name, ttl] of [['expires mid-download', 2], ['does not expire', 120]]) {
    const url = signer({ op: 'presign', method: 'GET', key: KEY, ttl }).url;
    if (!url) { aborted = 'could not sign the download URL'; break; }
    sensitiveUrls.push(url);
    const t0 = Date.now(); let got = 0; let err = null; let status = null;
    try {
      const res = await guardedFetch(url, { headers: { 'accept-encoding': 'identity' } }, policy); status = res.status;
      // Fail closed (review round 5, P2-A): the fetch API does not throw on 403/404/500, and an error body is not a download. Only a plain 200 starts the in-flight download this
      // experiment measures; anything else (also 206/3xx) means no experiment ran. The body is never read — it is cancelled — and nothing of it is kept.
      if (status !== 200) { aborted = `download URL answered HTTP ${status}, not 200 — the in-flight download was not tested`; await res.body?.cancel().catch(() => {}); break; }
      for await (const c of res.body) { got += c.length; await sleep((c.length / (mibps * 1048576)) * 1000); }
    } catch (e) {
      if (e instanceof UpstreamRefused) { aborted = `download URL refused by the upstream allow-list (${e.reason})`; break; }
      // no response at all (DNS/TCP/TLS failure): nothing was in flight. An error AFTER a 200 started (e.g. UND_ERR_SOCKET) is the observation this experiment exists to make.
      if (status === null) { aborted = 'download request failed before any response — the in-flight download was not tested'; break; }
      err = e.cause?.code ?? e.name;
    }
    rows.push({ url: name, ttlSeconds: ttl, status, readRateMiBps: mibps, receivedBytes: got, of: N, complete: got === N, error: err, endedAfterMs: Date.now() - t0 });
  }
} finally {
  cleanup = cleanupGate(attempted ? [(() => { const d = signer({ op: 'delete', key: KEY }); const h = signer({ op: 'head', key: KEY }); return { label: 'probe', deleteOk: !d.error, headStatus: h.error === 'aws' ? h.status : (h.ok ? 200 : null) }; })()] : []);
  rmSync(tmp, { recursive: true, force: true });
}
// Same rule as the probe: the serialised JSON is redacted and re-scanned for credentials / signed URLs before it is printed.
// an aborted run reports no rows: a row recorded before the abort (the first URL) must not read as a completed experiment
const serial = safeSerialize({ experiment: 'I9-isolated', ...(aborted ? { aborted } : {}), rows: aborted ? [] : rows, cleanup }, sensitiveTokens({ secrets, urls: sensitiveUrls }), 1);
if (!serial.clean) { console.error(`NOT PRINTED: sensitive material (${serial.sweepKinds.join(', ')}) survived redaction`); process.exit(1); }
console.log(serial.text);
if (aborted) console.error(`ABORTED: ${aborted} — no experiment ran (exit 1)`);
process.exit(aborted || !cleanup.pass || serial.sweepKinds.length ? 1 : 0);
