import { newPhone, dump, layout, WEB } from './lib.mjs';
import fs from 'node:fs';
const seed = JSON.parse(fs.readFileSync('/tmp/claude-0/e2e/seed.json', 'utf8'));
const API = 'http://e2e-ui.awj.app:8000/api';
const results = [];
const note = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(ok ? 'PASS' : 'FAIL', id, detail ?? ''); };
const shot = (page, n) => page.screenshot({ path: `/tmp/claude-0/e2e/shots/${n}.png`, fullPage: true });
async function login(page, no, pin) {
  await page.goto(WEB + '/fuel-stations/ops/login', { waitUntil: 'networkidle' });
  await page.locator('input[name=employee_no]').fill(no);
  await page.locator('input[name=pin]').fill(pin);
  await page.getByRole('button', { name: 'دخول' }).last().click();
  await page.waitForFunction(() => document.body.innerText.includes('مساحة عمل'), null, { timeout: 20000 });
  await page.waitForTimeout(1500);
}
async function api(path, token, init = {}) {
  const r = await fetch(API + path, { ...init, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) }, body: init.body ? JSON.stringify(init.body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function check(page, id) { const p = await layout(page); note(`layout:${id}`, p.length === 0, p.join('; ')); }

const s = await newPhone('ar');
const { page, errors } = s;
await login(page, seed.pins.seller.employee_no, seed.pins.seller.pin);
await shot(page, '10-seller-home'); await check(page, 'home');

// 1) فتح الوردية
await page.getByRole('link', { name: 'فتح وردية جديدة' }).first().click();
await page.waitForURL(/shifts\/open/);
await page.getByTestId('open-float').fill('500');
await check(page, 'open-form'); await shot(page, '11-open-form');
await page.getByRole('button', { name: 'مراجعة وفتح الوردية' }).click();
await page.getByRole('dialog').waitFor();
await shot(page, '12-open-confirm');
const dlgButtons = await page.getByRole('dialog').getByRole('button').allInnerTexts();
console.log('dialog buttons', dlgButtons);
await page.getByRole('dialog').getByRole('button').filter({ hasText: /تأكيد|فتح/ }).last().click();
await page.waitForTimeout(2500);
await shot(page, '13-open-success');
console.log(await dump(page));
const shifts = await api('/fuel-stations/shifts', seed.tokens.owner);
const sh = shifts.body.data.find(x => x.status === 'open');
note('shift-opened-in-db', !!sh && sh.opening_float_minor === 50000, JSON.stringify({ id: sh?.id, float: sh?.opening_float_minor }));
fs.writeFileSync('/tmp/claude-0/e2e/live-shift.json', JSON.stringify({ shift: sh?.id }));
console.log('ERRORS', errors);
await s.b.close();
