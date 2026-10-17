// V0 SPIKE — NOT production code. Isolates case I9 ("does an in-flight download survive the URL's expiry?") from harness timing artefacts.
// The probe's I9 reads 8 MiB at ~1 MiB/s, i.e. for ≈ 8 s — and every look-alike run ended at ≈ 8.0 s with UND_ERR_SOCKET, sometimes 64 KiB short. That coincidence needs separating:
// is it the signature expiring, or a server/transport time limit? So this reads the same object at a SLOWER rate (so the download lasts well past 8 s) with
//   (a) a URL that expires mid-download (ttl 2 s)      (b) a URL that does NOT expire during the download (ttl 120 s)
// If (b) is cut at the same ≈ 8 s mark, the limit is not expiry. Same secrecy rules as the probe: no URL, signature or credential is printed.
//   S3_ENDPOINT=… S3_KEY=… S3_SECRET=… S3_BUCKET=… [S3_PATH_STYLE=1] node v0-i9-experiment.mjs --autoload=/path/to/vendor/autoload.php [--mibps=0.5] [--size-mib=8]
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { cleanupGate } from './v0-gates.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split('=').slice(1).join('=');
for (const k of ['S3_ENDPOINT', 'S3_KEY', 'S3_SECRET', 'S3_BUCKET']) if (!process.env[k]) { console.error(`missing environment variable ${k}`); process.exit(2); }
const autoload = arg('autoload', join(here, 'vendor/autoload.php')); const mibps = +arg('mibps', 0.5); const N = Math.round(+arg('size-mib', 8) * 1048576);
const signer = (req) => { const r = spawnSync('php', [join(here, 'v0-signer.php'), autoload], { input: JSON.stringify(req), encoding: 'utf8', env: process.env }); try { return JSON.parse(r.stdout); } catch { return { error: 'signer-unparseable' }; } };
const KEY = `v0-range-probe/i9-${randomBytes(4).toString('hex')}/probe.bin`;
const tmp = mkdtempSync(join(tmpdir(), 'v0i9-'));
let created = false; let cleanup;
const rows = [];
try {
  writeFileSync(join(tmp, 'p.bin'), randomBytes(N));
  if (process.env.S3_CREATE_BUCKET === '1') signer({ op: 'create-bucket' });
  created = !signer({ op: 'put', key: KEY, file: join(tmp, 'p.bin'), contentType: 'video/mp4' }).error;
  for (const [name, ttl] of [['expires mid-download', 2], ['does not expire', 120]]) {
    const url = signer({ op: 'presign', method: 'GET', key: KEY, ttl }).url;
    const t0 = Date.now(); let got = 0; let err = null; let status = null;
    try {
      const res = await fetch(url, { headers: { 'accept-encoding': 'identity' }, redirect: 'manual' }); status = res.status;
      for await (const c of res.body) { got += c.length; await sleep((c.length / (mibps * 1048576)) * 1000); }
    } catch (e) { err = e.cause?.code ?? e.name; }
    rows.push({ url: name, ttlSeconds: ttl, status, readRateMiBps: mibps, receivedBytes: got, of: N, complete: got === N, error: err, endedAfterMs: Date.now() - t0 });
  }
} finally {
  cleanup = cleanupGate(created ? [(() => { const d = signer({ op: 'delete', key: KEY }); const h = signer({ op: 'head', key: KEY }); return { label: 'probe', deleteOk: !d.error, headStatus: h.error === 'aws' ? h.status : (h.ok ? 200 : null) }; })()] : []);
  rmSync(tmp, { recursive: true, force: true });
}
console.log(JSON.stringify({ experiment: 'I9-isolated', rows, cleanup }, null, 1));
process.exit(cleanup.pass ? 0 : 1);
