// Experiment 7: demo-mode pages: payment voucher, receipt voucher, partner statement, report -> list actions, download PDFs, check content
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:3001';
const targets = [
  ['payment_pm51', '/payments/pm-51'],
  ['receipt_voucher_pm51', '/receipt-vouchers/pm-51'],
  ['partner_statement_p1', '/partners/p1/statement'],
  ['partner_p1', '/partners/p1'],
  ['reports', '/reports'],
  ['quote', '/quotes/q-1'],
  ['credit_note', '/credit-notes/cn-1'],
  ['purchase', '/purchases/pu-1'],
];
function info(f) { const i = execSync(`pdfinfo "${f}"`).toString(); return { pages: /Pages:\s+(\d+)/.exec(i)?.[1], size: /Page size:\s+(.*)/.exec(i)?.[1], bytes: fs.statSync(f).size, text: Number(execSync(`pdftotext "${f}" - | wc -c`).toString()) }; }
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  for (const [tag, url] of targets) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
    await ctx.addCookies([{ name: 'locale', value: 'ar', url: BASE }]);
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('demo', 'true');
      localStorage.setItem('user', JSON.stringify({ id: 'demo-user', name: 'demo', email: 'd@x.t', role: 'owner', permissions: ['*'], tenant_id: 'demo-tenant' }));
      window.print = () => { window.__printCalls = (window.__printCalls || 0) + 1; window.__pageStyle = document.getElementById('nebrax-doc-print-page')?.textContent ?? null; window.__target = document.querySelector('[data-print-target]')?.id ?? null; };
    });
    const row = { tag, url };
    try {
      await page.goto(`${BASE}${url}`, { waitUntil: 'commit', timeout: 120000 }).catch(() => {});
      await page.waitForLoadState('load', { timeout: 120000 }).catch(() => {});
      await page.waitForTimeout(6000);
      await page.screenshot({ path: path.join(OUT, `${tag}.png`), fullPage: true });
      row.title = (await page.title()).slice(0, 60);
      row.hasPrintRoot = (await page.locator('#print-root').count());
      row.hasThermalRoot = (await page.locator('#thermal-print-root').count());
      const btns = await page.getByRole('button').allInnerTexts();
      row.buttons = btns.map((b) => b.trim()).filter((b) => /PDF|طباع|تنزيل|مشاركة|إكسل|Excel|Print|CSV|تصدير/i.test(b)).slice(0, 12);
      // try PDF download button
      const pdfBtn = page.getByRole('button', { name: /PDF|تنزيل/ }).first();
      const menuBtn = page.getByRole('button', { name: /إجراءات|actions|Actions|المزيد/ }).first();
      let dl = null;
      for (let attempt = 0; attempt < 2 && !dl; attempt++) {
        try {
          if (attempt === 1 && (await menuBtn.count())) { await menuBtn.click(); await page.waitForTimeout(400); }
          const target = attempt === 0 ? pdfBtn : page.getByRole('menuitem', { name: /PDF|تنزيل/ }).first();
          if (await target.count()) {
            const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), target.click({ timeout: 5000 })]);
            dl = d;
          }
        } catch (e) { row['dlAttempt' + attempt] = String(e).slice(0, 80); }
      }
      if (dl) { const f = path.join(OUT, `${tag}.pdf`); await dl.saveAs(f); row.pdf = info(f); }
    } catch (e) { row.error = String(e).slice(0, 200); }
    console.log(JSON.stringify(row));
    await ctx.close();
  }
  await browser.close();
})();
