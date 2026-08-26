import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const bridge = join(root, 'bridge.mjs');
const origin = 'https://pos.nebrax.test';
const pairingCode = 'PAIRING-CODE-TEST';
const sha = (value) => createHash('sha256').update(value).digest('hex');

async function startBridge(printer = { transport: 'tcp', identifier: '', drawerChannel: 0, pulseOnMs: 120, pulseOffMs: 240, timeoutMs: 100 }) {
  const dir = mkdtempSync(join(tmpdir(), 'nebrax-bridge-'));
  const port = 18000 + Math.floor(Math.random() * 1000);
  const config = join(dir, 'bridge.json');
  writeFileSync(config, JSON.stringify({
    version: 1, host: '127.0.0.1', port, allowedOrigins: [origin], pairingCodeHash: sha(pairingCode),
    printer, devices: {},
  }));
  const bridgeProcess = spawn(process.execPath, [bridge], { env: { ...process.env, NEBRAX_BRIDGE_CONFIG: config }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(() => rejectReady(new Error('bridge did not start')), 3000);
    bridgeProcess.stdout.on('data', (chunk) => { if (chunk.toString().includes('يستمع')) { clearTimeout(timer); resolveReady(); } });
    bridgeProcess.once('error', rejectReady);
  });
  return { port, process: bridgeProcess };
}
async function request(port, path, body, requestOrigin = origin) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

test('bridge denies an external origin before pairing', async (t) => {
  const bridgeProcess = await startBridge();
  t.after(() => bridgeProcess.process.kill());
  const response = await request(bridgeProcess.port, '/v1/pair', { device_id: 'device-1', pairing_code: pairingCode }, 'https://evil.example');
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error_code, 'origin_not_allowed');
});

test('bridge rejects invalid pairing code and never exposes a pairing secret', async (t) => {
  const bridgeProcess = await startBridge();
  t.after(() => bridgeProcess.process.kill());
  const response = await request(bridgeProcess.port, '/v1/pair', { device_id: 'device-1', pairing_code: 'wrong' });
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.status, 'permission_denied');
  assert.equal('pairing_secret' in body, false);
});

test('bridge sends the fixed ESC/POS drawer pulse to the configured TCP printer only after a valid signed command', async (t) => {
  let received = Buffer.alloc(0);
  const printer = createServer((socket) => {
    socket.on('data', (chunk) => { received = Buffer.concat([received, chunk]); });
  });
  await new Promise((resolveReady) => printer.listen(0, '127.0.0.1', resolveReady));
  const port = printer.address().port;
  const bridgeProcess = await startBridge({ transport: 'tcp', identifier: `127.0.0.1:${port}`, drawerChannel: 0, pulseOnMs: 120, pulseOffMs: 240, timeoutMs: 500 });
  t.after(() => { bridgeProcess.process.kill(); printer.close(); });
  const paired = await request(bridgeProcess.port, '/v1/pair', { device_id: 'device-1', pairing_code: pairingCode });
  const pair = await paired.json();
  const expiresAt = Math.floor(Date.now() / 1000) + 30;
  const actionId = 'action-escpos';
  const nonce = 'escpos-nonce';
  const signature = createHmac('sha256', pair.pairing_secret).update([actionId, 'device-1', String(expiresAt), nonce].join('|')).digest('hex');
  const response = await request(bridgeProcess.port, '/v1/cash-drawer/open', { action_id: actionId, device_id: 'device-1', expires_at: expiresAt, nonce, signature });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'opened');
  await new Promise((resolveReady) => setTimeout(resolveReady, 20));
  assert.deepEqual([...received], [0x1b, 0x70, 0x00, 60, 120]);
});

test('bridge accepts a trusted pairing but rejects an unsigned drawer command', async (t) => {
  const bridgeProcess = await startBridge();
  t.after(() => bridgeProcess.process.kill());
  const paired = await request(bridgeProcess.port, '/v1/pair', { device_id: 'device-1', pairing_code: pairingCode });
  assert.equal(paired.status, 201);
  const response = await request(bridgeProcess.port, '/v1/cash-drawer/open', {
    action_id: 'action-1', device_id: 'device-1', expires_at: Math.floor(Date.now() / 1000) + 30, nonce: 'nonce', signature: 'invalid',
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error_code, 'command_not_authorized');
});
