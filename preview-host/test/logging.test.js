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
  return { child, exited, output: () => out + err, stderr: () => err, stdout: () => out };
}

// Starts the real server.js on a free port and waits until /health answers.
async function runReady(env) {
  const port = await freePort();
  const p = run({ PORT: String(port), ...env });
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
  const stop = async () => {
    p.child.kill('SIGTERM');
    assert.equal(await p.exited, 0);
  };
  return { ...p, base, stop };
}

test('process: invalid PORT still fails startup (exit 1)', async () => {
  const p = run({ PORT: 'not-a-port', ANDROID_APP_LINK_SHA256_FINGERPRINTS: FP_A, APPLE_TEAM_ID: TEAM });
  assert.equal(await p.exited, 1);
  assert.ok(p.stderr().includes('PORT is invalid'));
});

test('process: Android-only starts; assetlinks 200, AASA 503, preview works', async () => {
  const p = await runReady({ ANDROID_APP_LINK_SHA256_FINGERPRINTS: FP_A });
  const links = await fetch(`${p.base}/.well-known/assetlinks.json`);
  assert.equal(links.status, 200);
  assert.deepEqual((await links.json())[0].target.sha256_cert_fingerprints, [FP_A]);
  const aasa = await fetch(`${p.base}/.well-known/apple-app-site-association`);
  assert.equal(aasa.status, 503);
  assert.ok(!(await aasa.text()).includes('appIDs'));
  assert.equal((await fetch(`${p.base}/preview/AndroidOnlyRef123`)).status, 200);
  await p.stop();
  assert.ok(p.stderr().includes('APPLE_TEAM_ID'));
  assert.ok(p.stdout().includes('associations android=enabled apple=disabled'));
  assert.ok(!p.output().includes(FP_A));
});

test('process: no signing inputs at all still starts; both associations 503; health and preview OK', async () => {
  const p = await runReady({});
  assert.equal((await fetch(`${p.base}/.well-known/assetlinks.json`)).status, 503);
  assert.equal((await fetch(`${p.base}/.well-known/apple-app-site-association`)).status, 503);
  assert.equal((await fetch(`${p.base}/preview/NoInputsRef123`)).status, 200);
  await p.stop();
  assert.ok(p.stdout().includes('associations android=disabled apple=disabled'));
});

test('process: malformed inputs start, disable that platform, and are never echoed', async () => {
  const p = await runReady({ ANDROID_APP_LINK_SHA256_FINGERPRINTS: 'BADFINGERPRINTVALUE', APPLE_TEAM_ID: 'BADTEAM' });
  assert.equal((await fetch(`${p.base}/.well-known/assetlinks.json`)).status, 503);
  assert.equal((await fetch(`${p.base}/.well-known/apple-app-site-association`)).status, 503);
  await p.stop();
  assert.ok(!p.output().includes('BADFINGERPRINTVALUE'));
  assert.ok(!p.output().includes('BADTEAM'));
});

test('process: serves traffic and its stdout/stderr never contain the reference', async () => {
  const p = await runReady({ ANDROID_APP_LINK_SHA256_FINGERPRINTS: FP_A, APPLE_TEAM_ID: TEAM });
  assert.equal((await fetch(`${p.base}/preview/${REF}`)).status, 200);
  await p.stop();
  assert.ok(p.output().includes('GET /preview/[REDACTED] 200'));
  assert.ok(!p.output().includes(REF));
});

test('process: reference never logged in Android-only mode either', async () => {
  const p = await runReady({ ANDROID_APP_LINK_SHA256_FINGERPRINTS: FP_A });
  await fetch(`${p.base}/preview/${REF}?x=QUERYLEAK`);
  await p.stop();
  assert.ok(!p.output().includes(REF));
  assert.ok(!p.output().includes('QUERYLEAK'));
});
