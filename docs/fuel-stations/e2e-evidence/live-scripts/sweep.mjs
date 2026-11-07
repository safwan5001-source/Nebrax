import { chromium, devices } from '/home/user/Nebrax/web/node_modules/@playwright/test/index.mjs';
import { layout, WEB } from './lib.mjs';
import fs from 'node:fs';
const seed = JSON.parse(fs.readFileSync('/tmp/claude-0/e2e/seed.json', 'utf8'));
const s2 = JSON.parse(fs.readFileSync('/tmp/claude-0/e2e/live-shift2.json', 'utf8')).shift;
const s3 = JSON.parse(fs.readFileSync('/tmp/claude-0/e2e/live-shift3.json', 'utf8')).shift;
const s4 = JSON.parse(fs.readFileSync('/tmp/claude-0/e2e/live-shift4.json', 'utf8')).shift;
const routes = [
  ['seller', '', 'home'], ['seller', '/products', 'products'], ['seller', '/shifts', 'shifts-list'], ['seller', '/tanks', 'tanks'], ['seller', '/profile', 'profile'],
  ['seller', `/shifts/${s4}`, 'shift-open-detail'], ['seller', `/shifts/${s4}/readings/closing`, 'readings-closing'], ['seller', `/shifts/${s4}/handover`, 'handover'],
  ['seller', `/shifts/${s2}`, 'shift-approved-detail'], ['supervisor', `/shifts/${s3}/review`, 'review-shortage'], ['seller', '/shifts/open', 'open-form'],
];
const out = [];
for (const [locale, vp] of [['ar', { width: 390, height: 844 }], ['en', { width: 390, height: 844 }], ['ar', { width: 375, height: 667 }]]) {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--unsafely-treat-insecure-origin-as-secure=http://e2e-ui.awj.app:3012'] });
  for (const who of ['seller', 'supervisor']) {
    const ctx = await b.newContext({ ...devices['iPhone 14'], viewport: vp, locale: locale === 'ar' ? 'ar-SA' : 'en-US', deviceScaleFactor: 2 });
    await ctx.addCookies([{ name: 'locale', value: locale, url: WEB }]);
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 120)));
    await page.goto(WEB + '/fuel-stations/ops/login', { waitUntil: 'networkidle' });
    await page.locator('input[name=employee_no]').fill(seed.pins[who].employee_no);
    await page.locator('input[name=pin]').fill(seed.pins[who].pin);
    await page.getByRole('button').last().click();
    await page.waitForFunction(() => /\/fuel-stations\/ops\/?$/.test(location.pathname) && document.body.innerText.length > 200, null, { timeout: 20000 });
    await page.waitForTimeout(2500);
    for (const [r, path, name] of routes.filter(x => x[0] === who)) {
      await page.goto(WEB + '/fuel-stations/ops' + path, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2500);
      const p = await layout(page);
      const dir = await page.evaluate(() => document.documentElement.dir);
      const eastern = await page.evaluate(() => (document.body.innerText.match(/[٠-٩۰-۹]/g) || []).length);
      await page.screenshot({ path: `/tmp/claude-0/e2e/shots/sweep-${locale}-${vp.width}-${name}.png`, fullPage: true });
      out.push({ locale, vp: `${vp.width}x${vp.height}`, route: name, dir, problems: p, easternDigits: eastern, pageErrors: errs.splice(0) });
    }
    await ctx.close();
  }
  await b.close();
}
fs.writeFileSync('/tmp/claude-0/e2e/sweep.json', JSON.stringify(out, null, 1));
for (const o of out) console.log(o.problems.length || o.pageErrors.length || o.easternDigits ? 'ISSUE' : 'ok   ', o.locale, o.vp, o.route, o.dir, o.problems.join(' | '), o.pageErrors.join(' | '));
