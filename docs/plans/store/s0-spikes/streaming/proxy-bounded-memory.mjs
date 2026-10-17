// P2-0 evidence — NOT production code. Compares the Customizer media proxy's OLD buffering (unbounded arrayBuffer, no gate) with the P2-0
// buffering (readBodyBounded + concurrency gate from src/lib/commerce/media-proxy-guard.ts) under N slow visitors and an origin that sends
// an oversized body. Reports the proxy process' peak RSS and how requests ended.
// usage: node --experimental-strip-types proxy-bounded-memory.mjs <old|new> <clients> <KiBps> <holdSec> <originMB> [lie=0|1]
import http from 'node:http';
import { Readable } from 'node:stream';
import { createConcurrencyGate, mediaProxyLimits, readBodyBounded } from '../../../../../storefront/src/lib/commerce/media-proxy-guard.ts';

const [MODE, N, KIBPS, HOLD, MB, LIE = '0'] = [process.argv[2], +process.argv[3], +process.argv[4], +process.argv[5], +process.argv[6], process.argv[7]];
const FILE = Buffer.alloc(MB * 1048576, 7);
const origin = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'image/webp', ...(LIE === '1' ? {} : { 'Content-Length': FILE.length }) });
  res.end(FILE);
}).listen(0);
let peak = 0; setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 25);
const limits = mediaProxyLimits({});
const gate = createConcurrencyGate(limits);
const outcome = { ok: 0, shed503: 0, failed502: 0, clientErr: 0 };
origin.on('listening', () => {
  const OP = origin.address().port;
  const proxy = http.createServer(async (req, res) => {
    let release = () => {};
    if (MODE === 'new') { try { release = await gate.acquire('shop.example.com'); } catch { outcome.shed503++; res.writeHead(503); return res.end(); } }
    try {
      const up = await fetch(`http://127.0.0.1:${OP}/v`, { cache: 'no-store' });
      const body = MODE === 'new' ? await readBodyBounded(up, limits.maxBodyBytes) : Buffer.from(await up.arrayBuffer());
      release();
      res.writeHead(200, { 'Content-Type': 'image/webp' }); Readable.from([body]).pipe(res); outcome.ok++;
    } catch { release(); outcome.failed502++; res.writeHead(502); res.end(); }
  }).listen(0, () => {
    const PORT = proxy.address().port; const base = process.memoryUsage().rss;
    for (let i = 0; i < N; i++) setTimeout(() => {
      const r = http.get({ port: PORT, path: '/v', agent: false }, (res) => { res.on('data', (c) => { res.pause(); setTimeout(() => res.resume(), (c.length / (KIBPS * 1024)) * 1000); }); res.on('error', () => {}); });
      r.on('error', () => { outcome.clientErr++; });
    }, (i / N) * 1000);
    setTimeout(() => { console.log(JSON.stringify({ mode: MODE, clients: N, kibps: KIBPS, originMB: MB, originSendsContentLength: LIE !== '1', rss_baseline_mib: +(base / 1048576).toFixed(0), rss_peak_mib: +(peak / 1048576).toFixed(0), ...outcome, limits: { maxBodyBytes: limits.maxBodyBytes, maxConcurrent: limits.maxConcurrent } })); process.exit(0); }, HOLD * 1000);
  });
});
