// P2-0 review evidence — NOT production code. Measures the READ-PHASE memory of the media proxy when `C` origin reads are in flight at once, each
// holding (almost) a full `maxBodyBytes` body, using the limits `mediaProxyLimits(env)` actually returns. The origin (a child process, so it does
// not pollute the measurement) sends every body except its last byte, waits until C bodies are held, then finishes them all at once — the worst
// instant for the proxy. Reports effective limits, the proxy process' peak RSS and the product C × L.
// usage: STOREFRONT_MEDIA_PROXY_MAX_CONCURRENT=64 STOREFRONT_MEDIA_PROXY_MAX_BODY_BYTES=8388608 node --experimental-strip-types proxy-aggregate-budget.mjs
import http from 'node:http';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createConcurrencyGate, mediaProxyLimits, readBodyBounded } from '../../../../../storefront/src/lib/commerce/media-proxy-guard.ts';

if (process.argv[2] === 'origin') {
  const [BODY, WANT] = [+process.argv[3], +process.argv[4]];
  const chunk = Buffer.alloc(64 * 1024, 7);
  const waiting = [];
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/webp' }); // chunked: no Content-Length, so the bound is enforced on received bytes
    let left = BODY - 1;
    const pump = () => { while (left > 0) { const n = Math.min(left, chunk.length); left -= n; if (!res.write(n === chunk.length ? chunk : chunk.subarray(0, n))) return res.once('drain', pump); }
      waiting.push(res); if (waiting.length >= WANT) { for (const r of waiting.splice(0)) r.end(Buffer.from([7])); } };
    pump();
  }).listen(0, () => process.send({ port: server.address().port }));
  setTimeout(() => { for (const r of waiting.splice(0)) r.end(Buffer.from([7])); }, 6000).unref(); // never hang if fewer than WANT arrive
} else {
  const limits = mediaProxyLimits(process.env);
  const REQUESTS = +(process.env.SPIKE_REQUESTS ?? limits.maxConcurrent * 2);
  const gate = createConcurrencyGate(limits);
  const origin = fork(fileURLToPath(import.meta.url), ['origin', String(limits.maxBodyBytes), String(limits.maxConcurrent)]);
  origin.once('message', async ({ port }) => {
    const base = process.memoryUsage().rss; let peak = base;
    const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 5);
    const out = { ok: 0, shed: 0, failed: 0 };
    await Promise.all(Array.from({ length: REQUESTS }, (_, i) => (async () => {
      let release; try { release = await gate.acquire(`h${i % 8}.example.com`); } catch { out.shed++; return; }
      try { const up = await fetch(`http://127.0.0.1:${port}/v`, { cache: 'no-store' }); await readBodyBounded(up, limits.maxBodyBytes); out.ok++; }
      catch { out.failed++; } finally { release(); }
    })()));
    clearInterval(sampler);
    const MiB = (n) => +(n / 1048576).toFixed(0);
    console.log(JSON.stringify({ limits: { maxConcurrent: limits.maxConcurrent, maxBodyBytes_MiB: MiB(limits.maxBodyBytes), maxBufferedBytes_MiB: limits.maxBufferedBytes === undefined ? null : MiB(limits.maxBufferedBytes) },
      product_C_x_L_MiB: MiB(limits.maxConcurrent * limits.maxBodyBytes), requests: REQUESTS, ...out, rss_baseline_MiB: MiB(base), rss_peak_MiB: MiB(peak), rss_over_baseline_MiB: MiB(peak - base) }));
    origin.kill(); process.exit(0);
  });
}
