import { newPhone, layout, WEB } from './lib.mjs';
import fs from 'node:fs';
const seed = JSON.parse(fs.readFileSync('/tmp/claude-0/e2e/seed.json', 'utf8'));
const sh = JSON.parse(fs.readFileSync('/tmp/claude-0/e2e/live-shift4.json', 'utf8')).shift;
const s = await newPhone('en'); const { page, errors } = s;
await page.goto(WEB + '/fuel-stations/ops/login', { waitUntil: 'networkidle' });
await page.locator('input[name=employee_no]').fill(seed.pins.seller.employee_no);
await page.locator('input[name=pin]').fill(seed.pins.seller.pin);
await page.getByRole('button').last().click();
await page.waitForFunction(() => /\/fuel-stations\/ops\/?$/.test(location.pathname) && document.body.innerText.length > 200, null, { timeout: 20000 });
await page.waitForTimeout(3000);
for (const [p, n] of [['', 'home'], [`/shifts/${sh}/handover`, 'handover'], [`/shifts/${sh}/readings/closing`, 'readings']]) {
  await page.goto(WEB + '/fuel-stations/ops' + p, { waitUntil: 'networkidle' }); await page.waitForTimeout(2500);
  console.log(n, 'dir=', await page.evaluate(() => document.documentElement.dir), 'lang=', await page.evaluate(() => document.documentElement.lang), 'layout=', await layout(page), '| ', (await page.evaluate(() => document.body.innerText)).replace(/\s+/g,' ').slice(60, 200));
  await page.screenshot({ path: `/tmp/claude-0/e2e/shots/en-${n}.png`, fullPage: true });
}
console.log('ERRORS', errors.filter(e=>!/reqfailed/.test(e)));
await s.b.close();
