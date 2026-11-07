// Experiment 8: pages that call window.print() directly (no print target). What does the printed page contain?
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:3001';
const targets = [['expense', '/expenses/exp-1'], ['receipt_voucher', '/receipt-vouchers/pm-51'], ['pos_report', '/pos/report'], ['partner_statement', '/partners/p1/statement']];
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  for (const [tag, url] of targets) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await ctx.addCookies([{ name: 'locale', value: 'ar', url: BASE }]);
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('demo', 'true');
      localStorage.setItem('user', JSON.stringify({ id: 'demo-user', name: 'demo', email: 'd@x.t', role: 'owner', permissions: ['*'], tenant_id: 'demo-tenant' }));
    });
    await page.goto(`${BASE}${url}`, { waitUntil: 'commit', timeout: 120000 }).catch(() => {});
    await page.waitForLoadState('load').catch(() => {});
    await page.waitForTimeout(6000);
    await page.emulateMedia({ media: 'print' });
    const f = path.join(OUT, `${tag}.print.pdf`);
    await page.pdf({ path: f, printBackground: true, preferCSSPageSize: true });
    const txt = execSync(`pdftotext -layout "${f}" -`).toString();
    const pages = /Pages:\s+(\d+)/.exec(execSync(`pdfinfo "${f}"`).toString())[1];
    const leaked = ['إجراءات', 'تنزيل', 'طباعة', 'مشاركة', 'تعديل', 'لوحة التحكم', 'المبيعات', 'نقطة البيع'].filter((w) => txt.includes(w));
    console.log(tag, 'pages', pages, 'chars', txt.length, 'UI words leaked into print:', JSON.stringify(leaked));
    execSync(`pdftoppm -r 40 -png -f 1 -l 1 "${f}" "${f}.p"`);
    await ctx.close();
  }
  await browser.close();
})();
