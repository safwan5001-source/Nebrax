// P2-0b evidence — NOT production code. Runs the REAL built Next.js standalone storefront (`node <dir>/server.js`) against a fake Laravel origin
// and drives N slow visitors at the Customizer media proxy, sampling the server's VmRSS/VmHWM from /proc. It answers: while slow clients are
// still downloading, how much memory does the proxy hold, how many requests does it serve vs. shed (503 + Retry-After), and does it recover
// after the slow clients disconnect?
//
// usage: node proxy-delivery-memory.mjs <standaloneDir> [--clients=48] [--bodyMiB=6] [--kibps=16] [--holdSec=12] [--hosts=1] [--disconnect=1] [--env=KEY=VAL ...]
//   --hosts          slow visitors are spread over this many storefront hostnames (a host may use at most half the budget); the fast
//                    probe visitor always comes from a different hostname (fairness: is an unrelated storefront still served?)
//   <standaloneDir>  a `next build` output dir containing server.js (e.g. storefront/.next/standalone)
//   --kibps          each slow visitor reads about this many KiB/s (0 = never reads)
//   --disconnect     after holdSec, every slow visitor drops the connection; then 6 fast requests measure recovery
// Output: one JSON line.
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const dir = process.argv[2];
const opt = Object.fromEntries(process.argv.slice(3).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || '1']; }));
const extraEnv = Object.fromEntries(process.argv.slice(3).filter((a) => a.startsWith('--env=')).map((a) => a.slice(6).split('=')).map(([k, ...v]) => [k, v.join('=')]));
const CLIENTS = +(opt.clients ?? 48), BODY = Math.round(+(opt.bodyMiB ?? 6) * 1048576), KIBPS = +(opt.kibps ?? 16), HOLD = +(opt.holdSec ?? 12), HOSTS = +(opt.hosts ?? 1), DISCONNECT = (opt.disconnect ?? '1') === '1';
const UUID = '11111111-2222-4333-8444-555555555555';
const PATH = `/api/storefront/media/customizer/${UUID}/1920w.jpg`;

// fake Laravel origin: always a fast, complete answer
const payload = Buffer.alloc(BODY, 7);
const origin = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': payload.length, ETag: '"x"' }); res.end(payload); });
await new Promise((r) => origin.listen(0, '127.0.0.1', r));
const originPort = origin.address().port;

const PORT = 20000 + Math.floor(Math.random() * 20000);
const server = spawn(process.execPath, ['server.js'], {
  cwd: dir,
  env: { ...process.env, PORT: String(PORT), HOSTNAME: '127.0.0.1', NODE_ENV: 'production', AWJ_COMMERCE_API_URL: `http://127.0.0.1:${originPort}`, STOREFRONT_GATEWAY_SECRET: 'spike-secret', NEXT_TELEMETRY_DISABLED: '1', ...extraEnv },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
const kb = (f) => { try { const m = readFileSync(`/proc/${server.pid}/status`, 'utf8').match(new RegExp(`${f}:\\s+(\\d+) kB`)); return m ? +m[1] / 1024 : 0; } catch { return 0; } };

// wait until the server answers
for (let i = 0; i < 100; i++) { try { await new Promise((ok, no) => http.get({ port: PORT, host: '127.0.0.1', path: '/api/storefront/media/customizer/x/y', headers: { host: 'shop.example.com' } }, (r) => { r.resume(); ok(); }).on('error', no)); break; } catch { await sleep(200); } }

const fastRequest = (host = 'fast.example.com') => new Promise((resolve) => {
  const t0 = Date.now();
  http.get({ port: PORT, host: '127.0.0.1', path: PATH, headers: { host }, agent: false }, (res) => {
    let n = 0; res.on('data', (c) => { n += c.length; }); res.on('end', () => resolve({ status: res.statusCode, bytes: n, ms: Date.now() - t0, retryAfter: res.headers['retry-after'] ?? null }));
  }).on('error', () => resolve({ status: 0, bytes: 0, ms: Date.now() - t0 }));
});

const baseline = kb('VmRSS'); let peakSample = baseline;
const sampler = setInterval(() => { peakSample = Math.max(peakSample, kb('VmRSS')); }, 50);

// slow visitors (raw sockets so we control the read rate exactly)
const slow = []; const outcome = { slow200: 0, slow503: 0, slowOther: 0, slowCompleted: 0 };
for (let i = 0; i < CLIENTS; i++) {
  const s = net.createConnection({ port: PORT, host: '127.0.0.1' });
  const st = { s, status: null, got: 0 };
  s.write(`GET ${PATH} HTTP/1.1\r\nHost: slow${i % HOSTS}.example.com\r\nConnection: close\r\n\r\n`);
  s.on('error', () => {});
  s.on('end', () => { if (st.status === 200) outcome.slowCompleted++; });
  // pull-based reading: parse the status line from the first 16 bytes, then take ~KIBPS KiB per second (10 ticks/s)
  s.on('readable', () => {
    if (st.status === null) { const c = s.read(16); if (c) { const m = c.toString('latin1').match(/HTTP\/1\.1 (\d{3})/); st.status = m ? +m[1] : 0; st.got += c.length; } }
  });
  if (KIBPS > 0) st.timer = setInterval(() => { if (st.status === null) return; const c = s.read(Math.max(1, Math.round((KIBPS * 1024) / 10))); if (c) st.got += c.length; }, 100);
  slow.push(st);
  await sleep(40);
}
await sleep(HOLD * 1000);
for (const st of slow) { if (st.status === 200) outcome.slow200++; else if (st.status === 503) outcome.slow503++; else outcome.slowOther++; }
const holding = { rss_MiB: +kb('VmRSS').toFixed(0), hwm_MiB: +kb('VmHWM').toFixed(0) };

// a fast visitor arriving while the slow ones are still downloading
const fastDuring = await fastRequest();

let afterDisconnect = null;
if (DISCONNECT) {
  for (const st of slow) { clearInterval(st.timer); st.s.destroy(); }
  await sleep(3000);
  const recoveries = []; for (let i = 0; i < 6; i++) recoveries.push(await fastRequest());
  afterDisconnect = { rss_MiB: +kb('VmRSS').toFixed(0), fast: recoveries.map((r) => r.status), fastBytesOk: recoveries.every((r) => r.status === 200 ? r.bytes === BODY : true) };
} else for (const st of slow) { clearInterval(st.timer); st.s.destroy(); }

clearInterval(sampler);
const result = { clients: CLIENTS, hosts: HOSTS, bodyMiB: +(BODY / 1048576).toFixed(2), slowKiBps: KIBPS, holdSec: HOLD, env: extraEnv,
  baseline_MiB: +baseline.toFixed(0), ...outcome, whileHolding: holding, peak_sampled_MiB: +peakSample.toFixed(0), peak_VmHWM_MiB: +kb('VmHWM').toFixed(0),
  fastDuring: { status: fastDuring.status, ms: fastDuring.ms, retryAfter: fastDuring.retryAfter }, afterDisconnect };
console.log(JSON.stringify(result));
server.kill('SIGKILL'); origin.close(); process.exit(0);
