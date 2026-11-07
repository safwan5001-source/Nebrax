import { newPhone, WEB } from './lib.mjs';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const seed = JSON.parse(fs.readFileSync('/tmp/claude-0/e2e/seed.json', 'utf8'));
const { shift } = JSON.parse(fs.readFileSync('/tmp/claude-0/e2e/live-shift4.json', 'utf8'));
const q = (sql) => execSync(`psql -h /tmp -p 5433 -U postgres -d e2e_ui -t -A -c "${sql}"`).toString().trim();
const shot = (page, n) => page.screenshot({ path: `/tmp/claude-0/e2e/shots/${n}.png`, fullPage: true });
const s = await newPhone('ar'); const { page, errors } = s;
await page.goto(WEB + '/fuel-stations/ops/login', { waitUntil: 'networkidle' });
await page.locator('input[name=employee_no]').fill(seed.pins.seller.employee_no);
await page.locator('input[name=pin]').fill(seed.pins.seller.pin);
await page.getByRole('button', { name: 'دخول' }).last().click();
await page.waitForFunction(() => document.body.innerText.includes('مساحة عمل'), null, { timeout: 20000 });
await page.waitForTimeout(1500);
let lost = 0, calls = [];
await page.route('**/api/fuel-stations/shifts/*/meter-readings', async (route) => {
  calls.push('meter');
  if (lost === 0) { lost++; await route.fetch(); await route.abort('connectionreset'); } else { await route.continue(); }
});
await page.goto(`${WEB}/fuel-stations/ops/shifts/${shift}/readings/opening`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const inputs = page.locator('[data-entry-input]');
await inputs.nth(0).fill('1060'); await inputs.nth(1).fill('9940');
await page.getByRole('button', { name: /مراجعة وحفظ/ }).click();
await page.getByRole('dialog').getByRole('button', { name: 'تأكيد وحفظ' }).click();
await page.waitForTimeout(4000);
await shot(page, '73-lost-response');
const txt = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g,' ');
console.log('1) UI after lost response:', txt.match(/(قد يكون|لم نتمكن|تحقق|غير مؤكد|تعذر)[^.]{0,200}\./)?.[0] ?? txt.slice(200, 700));
console.log('1) meter rows on server (server DID process):', q(`select count(*) from fuel_shift_meter_readings where fuel_shift_id='${shift}'`), '| client calls:', calls.length);
console.log('1) buttons:', await page.getByRole('button').allInnerTexts());
// المستخدم يعيد المحاولة صراحةً
const retry = page.getByRole('button', { name: /تحقق|إعادة|حفظ/ });
console.log('1) retry-ish buttons:', await retry.allInnerTexts());
await page.waitForTimeout(500);
// نعيد الحفظ يدوياً عبر نفس الواجهة
const again = page.getByRole('button', { name: /مراجعة وحفظ|تحقق من الحالة|إعادة المحاولة/ }).first();
if (await again.count()) { await again.click(); await page.waitForTimeout(500); const d = page.getByRole('dialog'); if (await d.count()) { await d.getByRole('button', { name: /تأكيد وحفظ|إعادة|تحقق/ }).first().click().catch(()=>{}); } }
await page.waitForTimeout(4000);
console.log('2) meter rows after user retry:', q(`select count(*) from fuel_shift_meter_readings where fuel_shift_id='${shift}'`), 'tank rows:', q(`select count(*) from fuel_shift_tank_readings where fuel_shift_id='${shift}'`));
console.log('2) final text:', (await page.evaluate(() => document.body.innerText)).replace(/\s+/g,' ').slice(120, 520));
await shot(page, '74-after-retry');
console.log('ERRORS', errors.filter(e=>!/reqfailed/.test(e)));
await s.b.close();
