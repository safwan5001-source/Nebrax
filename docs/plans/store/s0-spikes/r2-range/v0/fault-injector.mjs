// V0 harness FAULT INJECTOR — NOT production code. A loopback forwarder in front of the local S3 look-alike that misbehaves in one chosen way, so the probe can be shown to
// DETECT (or correctly ignore) each fault. If the probe passes a run it should have failed, it cannot be trusted against the real R2.
//
//   node fault-injector.mjs <listenPort> <upstreamPort> <mode>
//     drop-range          drops the Range header (a store that ignores Range)                          → R2–R10 must FAIL
//     leak-url-header     echoes the full request URL (signature included) in an ordinary header          → R18 must FAIL  (review finding: header VALUES)
//     leak-signature-header  echoes only the signature value in an ordinary header                        → R18 must FAIL
//     etag-drift          changes the ETag only on suffix / EOF-clamped / larger open-ended Range responses → R11 must FAIL  (review finding: R5–R7; the old gate missed it)
//     redirect-http       answers a plain-http probe (header x-v0-plain: 1) with 301 → https               → R13 must still PASS and I10 must record the redirect  (review finding)
//     redirect-signed     answers a correctly signed GET carrying `range: bytes=0-0` with 302               → R13 must FAIL  (the security gate still bites)
import http from 'node:http';
const [LISTEN, UPSTREAM, MODE] = [+process.argv[2], +process.argv[3], process.argv[4] ?? 'drop-range'];
http.createServer((req, res) => {
  const headers = { ...req.headers };
  if (MODE === 'drop-range') delete headers.range;
  if (MODE === 'redirect-http' && req.headers['x-v0-plain'] === '1') {
    res.writeHead(301, { location: `https://${req.headers.host}${req.url.split('?')[0]}` }); return res.end();
  }
  if (MODE === 'redirect-signed' && req.headers.range === 'bytes=0-0') {
    res.writeHead(302, { location: `https://${req.headers.host}/elsewhere` }); return res.end();
  }
  const up = http.request({ host: '127.0.0.1', port: UPSTREAM, method: req.method, path: req.url, headers }, (r) => {
    const out = { ...r.headers };
    if (MODE === 'leak-url-header') out['x-debug-origin'] = `http://${req.headers.host}${req.url}`;
    if (MODE === 'leak-signature-header') out['x-trace'] = new URL(`http://x${req.url}`).searchParams.get('X-Amz-Signature') ?? '';
    // drifts the ETag only where the pre-fix R11 never looked: suffix, EOF-clamped and open-ended ranges that return ≥ 100 bytes (R5, R6, R7, I5, …) — NOT the 1-byte last-byte case R10
    if (MODE === 'etag-drift' && req.headers.range && /^bytes=(-\d+|\d+-|0-\d{8,})$/.test(req.headers.range) && out.etag && !(/^bytes=\d+-$/.test(req.headers.range) && +r.headers['content-length'] < 100)) out.etag = '"drifted"';
    res.writeHead(r.statusCode, out); r.pipe(res);
  });
  up.on('error', () => { res.statusCode = 502; res.end(); });
  req.pipe(up);
}).listen(LISTEN, '127.0.0.1');
