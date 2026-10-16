#!/usr/bin/env node
// S0-E SPIKE load generator (zero deps). Holds N throttled clients on a streaming URL while probing a tiny health URL, and samples Apache's
// scoreboard (/server-status?auto). usage: node loadgen.js <base> <path> <clients> <KiBps-per-client> <holdSec> [healthPath]
const http = require('http');
const [base, path, N, KIBPS, HOLD, health = '/health.php'] = [process.argv[2], process.argv[3], +process.argv[4], +process.argv[5], +process.argv[6], process.argv[7]];
const agent = new http.Agent({ keepAlive: false, maxSockets: Infinity });
const stats = { started: 0, got200or206: 0, errors: 0, timeouts: 0, bytes: 0, ttfb: [], health: [], healthFail: 0, busy: [], idle: [] };
const T0 = Date.now(); const alive = () => Date.now() - T0 < HOLD * 1000;
const get = (url, headers, onRes, timeoutMs) => { const r = http.get(url, { agent, headers }, onRes); r.setTimeout(timeoutMs, () => { r.destroy(new Error('timeout')); }); return r; };
function client() {
  stats.started++; const t = Date.now();
  const r = get(base + path, { Range: 'bytes=0-' }, (res) => {
    stats.got200or206++; stats.ttfb.push(Date.now() - t);
    res.on('data', (c) => { stats.bytes += c.length; res.pause(); setTimeout(() => res.resume(), (c.length / (KIBPS * 1024)) * 1000); });
    res.on('end', () => {}); res.on('error', () => {});
    setTimeout(() => res.destroy(), Math.max(0, HOLD * 1000 - (Date.now() - T0)));   // hold until the window ends
  }, HOLD * 1000);
  r.on('error', (e) => { if (e.message === 'timeout') stats.timeouts++; else if (alive()) stats.errors++; });
}
for (let i = 0; i < N; i++) setTimeout(client, (i / N) * 2000);                          // ramp over 2 s
const probe = setInterval(() => { const t = Date.now(); get(base + health, {}, (res) => { res.resume(); res.on('end', () => stats.health.push(Date.now() - t)); }, 4000).on('error', () => stats.healthFail++); }, 250);
const sb = setInterval(() => { http.get(base + '/server-status?auto', { agent }, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => { const m = /BusyWorkers: (\d+)/.exec(b), i = /IdleWorkers: (\d+)/.exec(b); if (m) { stats.busy.push(+m[1]); stats.idle.push(+i[1]); } }); }).on('error', () => {}); }, 1000);
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
setTimeout(() => { clearInterval(probe); clearInterval(sb); setTimeout(() => {
  const out = { clients: N, kibps_each: KIBPS, hold_s: HOLD, started: stats.started, responded: stats.got200or206, client_errors: stats.errors, client_timeouts_no_response: stats.timeouts, MB_received: +(stats.bytes / 1048576).toFixed(1),
    ttfb_ms: { p50: q(stats.ttfb, .5), p95: q(stats.ttfb, .95), max: q(stats.ttfb, 1) }, health_probes_ok: stats.health.length, health_probes_failed_or_timeout: stats.healthFail,
    health_ms: { p50: q(stats.health, .5), p95: q(stats.health, .95), max: q(stats.health, 1) }, apache_busy_workers_max: stats.busy.length ? Math.max(...stats.busy) : null };
  console.log(JSON.stringify(out)); process.exit(0); }, 500); }, HOLD * 1000);
