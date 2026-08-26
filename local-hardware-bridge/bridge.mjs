#!/usr/bin/env node

import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const VERSION = '0.1.0';
const DEFAULT_PORT = 17463;
const CONFIG_PATH = resolve(process.env.NEBRAX_BRIDGE_CONFIG ?? `${homedir()}/.nebrax/cash-drawer-bridge.json`);
const REQUEST_LIMIT = new Map();
const REPLAY_GUARD = new Map();

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function hmac(secret, value) { return createHmac('sha256', secret).update(value).digest('hex'); }
function safeEqual(a, b) {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
function isLoopbackOrigin(origin) {
  try {
    const parsed = new URL(origin);
    return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname);
  } catch { return false; }
}
function isValidAllowedOrigin(origin) {
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:')
      && !parsed.username && !parsed.password && !parsed.pathname.replace(/\/$/, '') && !parsed.search && !parsed.hash;
  } catch { return false; }
}
function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith('--')) continue;
    result[value.slice(2)] = args[index + 1]?.startsWith('--') ? true : (args[index + 1] ?? true);
    if (result[value.slice(2)] !== true) index += 1;
  }
  return result;
}
function randomPairingCode() { return randomBytes(9).toString('base64url').toUpperCase(); }
function randomSecret() { return randomBytes(32).toString('base64url'); }
function defaultConfig(origin, printer) {
  const pairingCode = process.env.NEBRAX_PAIRING_CODE ?? randomPairingCode();
  return {
    version: 1,
    host: '127.0.0.1',
    port: DEFAULT_PORT,
    allowedOrigins: [origin],
    pairingCodeHash: sha256(pairingCode),
    printer: {
      transport: process.platform === 'win32' ? 'windows_spooler' : 'tcp',
      identifier: printer ?? '',
      drawerChannel: 0,
      pulseOnMs: 120,
      pulseOffMs: 240,
      timeoutMs: 3000,
    },
    devices: {},
    _initialPairingCode: pairingCode,
  };
}
function writeConfig(config) {
  const toWrite = { ...config };
  delete toWrite._initialPairingCode;
  mkdirSync(dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(toWrite, null, 2)}\n`, { mode: 0o600 });
}
function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`لم يُعثر على ملف إعداد الجسر: ${CONFIG_PATH}. شغّل npm run init أولاً.`);
  }
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  if (config.host !== '127.0.0.1' || !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) {
    throw new Error('إعداد الاستماع غير آمن: الجسر يدعم 127.0.0.1 ومنفذاً محلياً فقط.');
  }
  if (!Array.isArray(config.allowedOrigins) || config.allowedOrigins.length === 0 || config.allowedOrigins.some((origin) => !isValidAllowedOrigin(origin) || origin === '*')) {
    throw new Error('allowedOrigins يجب أن تحتوي origins صريحة صالحة فقط، ولا تقبل *.');
  }
  if (typeof config.pairingCodeHash !== 'string' || !config.printer || typeof config.devices !== 'object') {
    throw new Error('ملف إعداد الجسر ناقص أو غير صالح.');
  }
  return config;
}
function sendJson(response, status, body, origin, config) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (origin && config.allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
  }
  response.writeHead(status, headers);
  response.end(JSON.stringify(body));
}
function allowOrigin(request, response, config) {
  const origin = request.headers.origin;
  if (!origin || !config.allowedOrigins.includes(origin)) {
    sendJson(response, 403, { ok: false, status: 'permission_denied', error_code: 'origin_not_allowed' }, undefined, config);
    return null;
  }
  return origin;
}
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const records = (REQUEST_LIMIT.get(key) ?? []).filter((time) => time > now - windowMs);
  if (records.length >= max) return false;
  records.push(now);
  REQUEST_LIMIT.set(key, records);
  return true;
}
async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8 * 1024) throw new Error('payload_too_large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('invalid_json'); }
}
function validatePrinter(printer) {
  const channel = printer.drawerChannel;
  const on = printer.pulseOnMs;
  const off = printer.pulseOffMs;
  if (!['windows_spooler', 'tcp'].includes(printer.transport) || typeof printer.identifier !== 'string' || !printer.identifier.trim()) {
    return 'printer_not_selected';
  }
  if (![0, 1].includes(channel) || !Number.isInteger(on) || on < 2 || on > 510 || !Number.isInteger(off) || off < 2 || off > 510) {
    return 'invalid_drawer_pulse';
  }
  return null;
}
function escPosDrawerPulse(printer) {
  return Buffer.from([0x1b, 0x70, printer.drawerChannel, Math.ceil(printer.pulseOnMs / 2), Math.ceil(printer.pulseOffMs / 2)]);
}
function sendTcp(host, port, bytes, timeoutMs) {
  return new Promise((resolveSend, rejectSend) => {
    const socket = createConnection({ host, port });
    const timeout = setTimeout(() => socket.destroy(new Error('timeout')), timeoutMs);
    socket.once('connect', () => socket.end(bytes));
    socket.once('error', (error) => { clearTimeout(timeout); rejectSend(error); });
    socket.once('close', (hadError) => { clearTimeout(timeout); hadError ? undefined : resolveSend(); });
  });
}
function sendWindowsSpooler(printerName, bytes, timeoutMs) {
  const script = resolve(dirname(new URL(import.meta.url).pathname), 'scripts/send-escpos-raw.ps1');
  return new Promise((resolveSend, rejectSend) => {
    const child = spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', script, '-PrinterName', printerName, '-PayloadBase64', bytes.toString('base64'),
    ], { windowsHide: true });
    let stderr = '';
    const timeout = setTimeout(() => child.kill(), timeoutMs);
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.once('error', (error) => { clearTimeout(timeout); rejectSend(error); });
    child.once('close', (code) => {
      clearTimeout(timeout);
      code === 0 ? resolveSend() : rejectSend(new Error(stderr || `spooler_exit_${code}`));
    });
  });
}
async function kickDrawer(printer) {
  const invalid = validatePrinter(printer);
  if (invalid) return { status: 'not_configured', error_code: invalid };
  try {
    const bytes = escPosDrawerPulse(printer);
    if (printer.transport === 'windows_spooler') {
      if (process.platform !== 'win32') return { status: 'unsupported', error_code: 'windows_spooler_requires_windows' };
      await sendWindowsSpooler(printer.identifier, bytes, printer.timeoutMs);
    } else {
      const [host, portText] = printer.identifier.split(':');
      const port = Number(portText);
      if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return { status: 'not_configured', error_code: 'invalid_tcp_printer_identifier' };
      await sendTcp(host, port, bytes, printer.timeoutMs);
    }
    // TCP/spooler confirms acceptance by printer path; physical state switches cannot report drawer sensor state.
    return { status: 'opened', error_code: null };
  } catch (error) {
    return { status: 'printer_unavailable', error_code: 'printer_write_failed' };
  }
}
function resultWithReceipt(config, deviceId, actionId, result) {
  const requestId = randomBytes(12).toString('hex');
  const secret = config.devices[deviceId]?.secret;
  const canonical = [actionId, deviceId, result.status, result.error_code ?? '', requestId].join('|');
  return { ok: result.status === 'opened', ...result, device: config.printer.identifier, request_id: requestId, receipt: hmac(secret, canonical) };
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.init) {
    const origin = String(args.origin ?? process.env.NEBRAX_ALLOWED_ORIGIN ?? 'http://localhost:3000');
    if (!isValidAllowedOrigin(origin)) throw new Error('--origin يجب أن يكون origin صريحاً مثل https://pos.example.com، وليس wildcard أو مساراً.');
    if (existsSync(CONFIG_PATH) && !args.force) throw new Error(`ملف الإعداد موجود بالفعل: ${CONFIG_PATH}. استخدم --force فقط عند الاستبدال المتعمد.`);
    const config = defaultConfig(origin, typeof args.printer === 'string' ? args.printer : undefined);
    writeConfig(config);
    process.stdout.write(`تم إنشاء إعداد الجسر في ${CONFIG_PATH}\nرمز الاقتران لمرة واحدة: ${config._initialPairingCode}\n`);
    return;
  }

  const config = loadConfig();
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    const url = new URL(request.url ?? '/', `http://${config.host}:${config.port}`);
    if (request.method === 'OPTIONS') {
      const allowed = allowOrigin(request, response, config);
      if (!allowed) return;
      response.writeHead(204, {
        'Access-Control-Allow-Origin': allowed,
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '300',
        Vary: 'Origin',
      });
      response.end();
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/health') {
      sendJson(response, 200, { ok: true, status: validatePrinter(config.printer) ? 'not_configured' : 'ready', version: VERSION }, origin, config);
      return;
    }
    if (request.method !== 'POST' || !['/v1/pair', '/v1/cash-drawer/open'].includes(url.pathname)) {
      sendJson(response, 404, { ok: false, status: 'failed', error_code: 'route_not_found' }, origin, config);
      return;
    }
    const allowedOrigin = allowOrigin(request, response, config);
    if (!allowedOrigin) return;
    let body;
    try { body = await readJson(request); }
    catch (error) { sendJson(response, 400, { ok: false, status: 'failed', error_code: error.message }, allowedOrigin, config); return; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      sendJson(response, 400, { ok: false, status: 'failed', error_code: 'invalid_payload' }, allowedOrigin, config); return;
    }

    if (url.pathname === '/v1/pair') {
      if (!rateLimit(`pair:${request.socket.remoteAddress}`, 3, 60_000)) {
        sendJson(response, 429, { ok: false, status: 'permission_denied', error_code: 'pairing_rate_limited' }, allowedOrigin, config); return;
      }
      if (typeof body.device_id !== 'string' || typeof body.pairing_code !== 'string' || !safeEqual(sha256(body.pairing_code), config.pairingCodeHash)) {
        sendJson(response, 403, { ok: false, status: 'permission_denied', error_code: 'pairing_code_invalid' }, allowedOrigin, config); return;
      }
      const secret = randomSecret();
      config.devices[body.device_id] = { secret, pairedAt: new Date().toISOString() };
      writeConfig(config);
      sendJson(response, 201, {
        ok: true, status: 'paired', pairing_secret: secret,
        printer_identifier: config.printer.identifier, drawer_channel: config.printer.drawerChannel,
        pulse_on_ms: config.printer.pulseOnMs, pulse_off_ms: config.printer.pulseOffMs,
      }, allowedOrigin, config);
      return;
    }

    if (!rateLimit(`open:${body.device_id ?? 'unknown'}`, 10, 10_000)) {
      sendJson(response, 429, { ok: false, status: 'failed', error_code: 'drawer_rate_limited' }, allowedOrigin, config); return;
    }
    const { action_id: actionId, device_id: deviceId, expires_at: expiresAt, nonce, signature } = body;
    const pair = config.devices[deviceId];
    const canonical = [actionId, deviceId, String(expiresAt), nonce].join('|');
    if (typeof actionId !== 'string' || typeof deviceId !== 'string' || typeof expiresAt !== 'number' || typeof nonce !== 'string' || typeof signature !== 'string'
      || !pair || expiresAt < Math.floor(Date.now() / 1000) || expiresAt > Math.floor(Date.now() / 1000) + 60 || !safeEqual(hmac(pair.secret, canonical), signature)) {
      sendJson(response, 403, { ok: false, status: 'permission_denied', error_code: 'command_not_authorized' }, allowedOrigin, config); return;
    }
    if (REPLAY_GUARD.has(actionId)) {
      sendJson(response, 409, resultWithReceipt(config, deviceId, actionId, { status: 'failed', error_code: 'command_replayed' }), allowedOrigin, config); return;
    }
    REPLAY_GUARD.set(actionId, Date.now());
    setTimeout(() => REPLAY_GUARD.delete(actionId), 65_000).unref();
    const result = await kickDrawer(config.printer);
    sendJson(response, result.status === 'opened' ? 200 : 409, resultWithReceipt(config, deviceId, actionId, result), allowedOrigin, config);
  });
  server.requestTimeout = 5_000;
  server.headersTimeout = 6_000;
  server.listen(config.port, config.host, () => process.stdout.write(`Nebrax Local Hardware Bridge ${VERSION} يستمع على http://${config.host}:${config.port}\n`));
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
