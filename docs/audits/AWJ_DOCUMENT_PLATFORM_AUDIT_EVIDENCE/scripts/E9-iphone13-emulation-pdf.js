const { chromium, devices } = require('playwright');
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:3001';
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
  await ctx.addCookies([{ name: 'locale', value: 'ar', url: BASE }]);
  const page = await ctx.newPage();
  for (const [scenario, tpl] of [['multipage', 'tax-invoice-erp-v2'], ['three', 'tax-invoice-retail-v2']]) {
    await page.goto(`${BASE}/document-qa?${new URLSearchParams({ type: 'tax_invoice', template: tpl, scenario, direction: 'rtl', qr: 'on', logo: 'on', assets: 'on' })}`, { waitUntil: 'networkidle', timeout: 120000 });
    await page.waitForSelector('#qa-print-root'); await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(() => ({ vw: innerWidth, docW: document.documentElement.scrollWidth, rootW: document.getElementById('qa-print-root').getBoundingClientRect().width, scrollW: document.getElementById('qa-print-root').scrollWidth }));
    await page.screenshot({ path: path.join(OUT, `iphone_${scenario}.png`) });
    const btn = page.getByRole('button').filter({ hasText: /PDF|تصدير|تنزيل/ }).first();
    const t0 = Date.now();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), btn.click()]);
    const f = path.join(OUT, `iphone_${scenario}.pdf`); await dl.saveAs(f);
    const i = execSync(`pdfinfo "${f}"`).toString();
    console.log(scenario, JSON.stringify(m), 'ms', Date.now() - t0, 'pages', /Pages:\s+(\d+)/.exec(i)[1], 'bytes', fs.statSync(f).size);
    execSync(`pdftoppm -r 40 -png -f 1 -l 1 "${f}" "${f}.p"`);
  }
  await browser.close();
})();
