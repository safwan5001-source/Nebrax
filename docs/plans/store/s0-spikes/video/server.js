#!/usr/bin/env node
// S0 SPIKE harness - NOT production code. Zero-dependency static server with switchable HTTP Range behaviour, request logging,
// optional throttling, and a result sink. Use on a real iPhone/Mac: `node server.js 8099`, open http://<LAN-IP>:8099/page/device.html.
//   /files/<name>?mode=range      (default) RFC 9110 single-range: 206 + Content-Range + Accept-Ranges: bytes
//   /files/<name>?mode=norange    ignores Range, always 200, no Accept-Ranges     (what a naive origin / buffering proxy does)
//   /files/<name>?mode=badcr      206 with a WRONG Content-Range total            (malformed origin)
//   &slow=<KiB/s>                 throttle body to simulate a slow client
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = +process.argv[2] || 8099, ROOT = __dirname, LOG = process.env.S0_LOG || path.join(ROOT, 'requests.log.jsonl'), RES = process.env.S0_RESULTS || path.join(ROOT, 'results.jsonl');
const TYPES = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.avif': 'image/avif', '.gif': 'image/gif', '.webp': 'image/webp', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json' };
const log = (o) => fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), ...o }) + '\n');
function parseRange(h, size) {              // single range only; null = ignore, 'bad' = 416
  const m = /^bytes=(\d*)-(\d*)$/.exec((h || '').trim()); if (!m || (m[1] === '' && m[2] === '')) return null;
  let s, e; if (m[1] === '') { const n = +m[2]; if (n === 0) return 'bad'; s = Math.max(0, size - n); e = size - 1; } else { s = +m[1]; e = m[2] === '' ? size - 1 : Math.min(+m[2], size - 1); }
  return (s >= size || s > e) ? 'bad' : [s, e];
}
function send(req, res, file, q) {
  const st = fs.statSync(file), size = st.size, type = TYPES[path.extname(file)] || 'application/octet-stream', mode = q.get('mode') || 'range', slow = +q.get('slow') || 0;
  const etag = '"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
  const base = { 'Content-Type': type, 'ETag': etag, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const rangeHdr = req.headers['range']; let status = 200, start = 0, end = size - 1, hdr = { ...base };
  if (mode !== 'norange') hdr['Accept-Ranges'] = 'bytes';
  if (mode !== 'norange' && rangeHdr && !(req.headers['if-range'] && req.headers['if-range'] !== etag)) {
    const r = parseRange(rangeHdr, size);
    if (r === 'bad') { res.writeHead(416, { ...hdr, 'Content-Range': `bytes */${size}` }); res.end(); return log({ m: req.method, u: req.url, range: rangeHdr, status: 416, ua: req.headers['user-agent']?.slice(0, 60) }); }
    if (r) { [start, end] = r; status = 206; hdr['Content-Range'] = `bytes ${start}-${end}/${mode === 'badcr' ? size + 7 : size}`; }
  }
  hdr['Content-Length'] = end - start + 1; res.writeHead(status, hdr);
  log({ m: req.method, u: req.url, range: rangeHdr || null, status, len: end - start + 1, mode, ua: req.headers['user-agent']?.slice(0, 60) });
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(file, { start, end, highWaterMark: slow ? Math.max(1024, slow * 1024 / 10) : 65536 });
  if (!slow) return stream.pipe(res);
  stream.on('data', (c) => { stream.pause(); res.write(c); setTimeout(() => stream.resume(), (c.length / (slow * 1024)) * 1000); }); stream.on('end', () => res.end());
  req.on('close', () => stream.destroy());
}
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const p = decodeURIComponent(u.pathname);
  if (req.method === 'POST' && p === '/__result') { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { fs.appendFileSync(RES, b.replace(/\n/g, ' ') + '\n'); res.writeHead(204); res.end(); }); return; }
  const m = /^\/(files|page|avif)\/([\w.\-]+)$/.exec(p); if (!m) { res.writeHead(404); return res.end('not found'); }
  const dir = { files: path.join(ROOT, 'corpus'), page: path.join(ROOT, 'pages'), avif: path.join(ROOT, '..', 'avif', 'corpus') }[m[1]];
  const file = path.join(dir, m[2]); if (!file.startsWith(dir) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  send(req, res, file, u.searchParams);
}).listen(PORT, '0.0.0.0', () => console.log('s0 harness on :' + PORT));
