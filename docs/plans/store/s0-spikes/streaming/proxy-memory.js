#!/usr/bin/env node
// S0-E SPIKE - NOT production code. Compares the CURRENT storefront media-proxy behaviour (buffer the whole upstream body with arrayBuffer(), then respond)
// with a STREAMING pass-through (what video requires), under N slow clients. Reports the proxy process' peak RSS.
// usage: node proxy-memory.js <buffering|streaming> <clients> <KiBps> <holdSec> [fileMB=15]
const http = require('http'); const { Readable } = require('stream');
const [MODE, N, KIBPS, HOLD, MB = 15] = [process.argv[2], +process.argv[3], +process.argv[4], +process.argv[5], +(process.argv[6] || 15)];
const FILE = Buffer.alloc(MB * 1048576, 7);
// origin (the Laravel stand-in): serves the file as fast as the proxy reads it, honouring Range
const origin = http.createServer((req, res) => {
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || ''); let s = 0, e = FILE.length - 1, st = 200;
  if (m && m[1] !== '') { s = +m[1]; if (m[2] !== '') e = Math.min(+m[2], e); st = 206; }
  res.writeHead(st, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': e - s + 1, ...(st === 206 ? { 'Content-Range': `bytes ${s}-${e}/${FILE.length}` } : {}) });
  res.end(FILE.subarray(s, e + 1));
}).listen(0);
let peak = 0; setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 50);
origin.on('listening', () => {
  const OPORT = origin.address().port;
  // the "Next route handler": returns a web Response; the framework streams that Response to the socket
  const proxy = http.createServer(async (req, res) => {
    const up = await fetch(`http://127.0.0.1:${OPORT}/v`, { headers: req.headers.range ? { Range: req.headers.range } : {}, cache: 'no-store' });
    const headers = { 'Content-Type': up.headers.get('content-type'), 'Cache-Control': 'public, max-age=300, must-revalidate' };
    let response;
    if (MODE === 'buffering') { const buf = await up.arrayBuffer(); response = new Response(buf, { status: up.status, headers }); }       // = today's route.ts
    else { for (const h of ['content-range', 'accept-ranges', 'content-length']) if (up.headers.get(h)) headers[h] = up.headers.get(h); response = new Response(up.body, { status: up.status, headers }); }
    res.writeHead(response.status, Object.fromEntries(response.headers)); Readable.fromWeb(response.body).pipe(res); req.on('close', () => { try { up.body?.cancel(); } catch {} });
  }).listen(0, () => {
    const PORT = proxy.address().port; let ok = 0, err = 0, bytes = 0; const T0 = Date.now(); const base = process.memoryUsage().rss;
    for (let i = 0; i < N; i++) setTimeout(() => {
      const r = http.get({ port: PORT, path: '/v', headers: { Range: 'bytes=0-' }, agent: false }, (res) => { ok++; res.on('data', (c) => { bytes += c.length; res.pause(); setTimeout(() => res.resume(), (c.length / (KIBPS * 1024)) * 1000); }); res.on('error', () => {}); });
      r.on('error', () => { err++; });
    }, (i / N) * 1500);
    setTimeout(() => { console.log(JSON.stringify({ mode: MODE, clients: N, kibps_each: KIBPS, file_mb: MB, hold_s: HOLD, responded: ok, errors: err, MB_delivered: +(bytes / 1048576).toFixed(1), rss_baseline_mib: +(base / 1048576).toFixed(0), rss_peak_mib: +(peak / 1048576).toFixed(0) })); process.exit(0); }, HOLD * 1000);
  });
});
