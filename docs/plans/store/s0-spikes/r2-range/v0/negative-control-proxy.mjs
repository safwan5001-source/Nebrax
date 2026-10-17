// V0 harness NEGATIVE CONTROL — NOT production code. A loopback forwarder in front of the local S3 look-alike that DROPS the Range header, i.e. a store that ignores Range.
// The probe must report failures for every ranged case against it; if it did not, the probe could not be trusted to detect an R2 that mishandles Range.
import http from 'node:http';
const [LISTEN, UPSTREAM] = [+process.argv[2], +process.argv[3]];
http.createServer((req, res) => {
  const headers = { ...req.headers }; delete headers.range;
  const up = http.request({ host: '127.0.0.1', port: UPSTREAM, method: req.method, path: req.url, headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', () => { res.statusCode = 502; res.end(); });
  req.pipe(up);
}).listen(LISTEN, '127.0.0.1');
