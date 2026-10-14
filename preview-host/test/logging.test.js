import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { start, FP_A, TEAM } from './helpers.js';

const REF = 'LogLeakMarker7Qx9ZkW2mN4pR6tV8yB1cD3fG5hJ0';
const SERVER = fileURLToPath(new URL('../src/server.js', import.meta.url));

test('request log lines redact the reference and carry no path, query, or headers', async () => {
  const s = await start();
  await s.get(`/preview/${REF}?token=QUERYLEAK`, { headers: { Referer: 'https://x.example/REFERERLEAK' } });
  await s.get('/preview/bad-ref-BADLEAK');
  await s.get('/elsewhere/ELSEWHERELEAK');
  await s.get('/health');
  const log = s.lines.join('\n');
  assert.ok(s.lines.includes('GET /preview/[REDACTED] 200'));
  assert.ok(s.lines.includes('GET /preview/[REDACTED] 404'));
  assert.ok(s.lines.includes('GET [UNMATCHED] 404'));
  assert.ok(s.lines.includes('GET /health 200'));
  for (const leak of [REF, 'QUERYLEAK', 'REFERERLEAK', 'BADLEAK', 'ELSEWHERELEAK']) {
    assert.ok(!log.includes(leak), leak);
  }
  await s.close();
});

function freePort() {
  return new Promise((resolve) => {
    const srv = createServer().listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function run(env) {
  const child = spawn(process.execPath, [SERVER], { env: { PATH: process.env.PATH, ...env } });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (err += d));
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return { child, exited, output: () => out + err };
}

test('process: refuses to start without signing inputs (fail closed), naming variables only', async () => {
  const p = run({ PORT: '0', ANDROID_APP_LINK_SHA256_FINGERPRINTS: 'SECRETISH-BAD-VALUE' });
  assert.equal(await p.exited, 1);
  assert.ok(p.output().includes('ANDROID_APP_LINK_SHA256_FINGERPRINTS'));
  assert.ok(p.output().includes('APPLE_TEAM_ID'));
  assert.ok(!p.output().includes('SECRETISH-BAD-VALUE'));
});

test('process: serves traffic and its stdout/stderr never contain the reference', async () => {
  const port = await freePort();
  const p = run({ PORT: String(port), ANDROID_APP_LINK_SHA256_FINGERPRINTS: FP_A, APPLE_TEAM_ID: TEAM });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 50 && !ready; i++) {
    try {
      ready = (await fetch(`${base}/health`)).status === 200;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.ok(ready, 'server did not become ready');
  assert.equal((await fetch(`${base}/preview/${REF}`)).status, 200);
  p.child.kill('SIGTERM');
  assert.equal(await p.exited, 0);
  assert.ok(p.output().includes('GET /preview/[REDACTED] 200'));
  assert.ok(!p.output().includes(REF));
});
