// Audit experiment 1: export PDF via the app's own exporter (html2canvas+jsPDF) and Chromium print for QA fixtures.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const OUT = process.argv[2];
const BASE = 'http://127.0.0.1:3001';
fs.mkdirSync(OUT, { recursive: true });

const cases = [
  // type, template, scenario, direction
  ['tax_invoice', 'tax-invoice-erp-v2', 'single', 'rtl'],
  ['tax_invoice', 'tax-invoice-erp-v2', 'multipage', 'rtl'],
  ['tax_invoice', 'tax-invoice-classic-v2', 'twenty', 'ltr'],
  ['tax_invoice', 'tax-invoice-modern-v2', 'long_content', 'rtl'],
  ['simplified_tax_invoice', 'tax-invoice-retail-v2', 'three', 'rtl'],
  ['quotation', 'quotation-proposal', 'five', 'rtl'],
  ['purchase_order', 'purchase-order-formal', 'twenty', 'ltr'],
  ['delivery_note', 'tax-invoice-minimal-v2', 'three', 'rtl'],
];

function pdfInfo(file) {
  try {
    const info = execSync(`pdfinfo "${file}"`).toString();
    const pages = /Pages:\s+(\d+)/.exec(info)?.[1];
    const size = /Page size:\s+(.*)/.exec(info)?.[1];
    const text = execSync(`pdftotext -layout "${file}" - | wc -c`).toString().trim();
    const fonts = execSync(`pdffonts "${file}" | tail -n +3 | wc -l`).toString().trim();
    return { pages, size, textChars: Number(text), fonts: Number(fonts), bytes: fs.statSync(file).size };
  } catch (e) { return { error: String(e).slice(0, 120) }; }
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const results = [];
  for (const [type, template, scenario, direction] of cases) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
    await ctx.addCookies([{ name: 'locale', value: direction === 'ltr' ? 'en' : 'ar', url: BASE }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    const q = new URLSearchParams({ type, template, scenario, direction, qr: 'on', logo: 'on', assets: 'on' });
    const tag = `${type}__${template}__${scenario}__${direction}`;
    const row = { tag };
    try {
      await page.goto(`${BASE}/document-qa?${q}`, { waitUntil: 'networkidle', timeout: 120000 });
      await page.waitForSelector('#qa-print-root', { timeout: 60000 });
      await page.evaluate(() => document.fonts.ready);
      const dims = await page.evaluate(() => {
        const r = document.getElementById('qa-print-root');
        return { w: r.scrollWidth, h: r.scrollHeight };
      });
      row.dom = dims;
      await page.screenshot({ path: path.join(OUT, `${tag}.screen.png`), fullPage: true });

      // (a) app exporter: click the PDF button in the harness
      const btn = page.getByRole('button').filter({ hasText: /PDF|تصدير|تنزيل/ });
      const nBtn = await btn.count();
      row.pdfButtons = nBtn;
      if (nBtn) {
        const [dl] = await Promise.all([
          page.waitForEvent('download', { timeout: 90000 }),
          btn.first().click(),
        ]);
        const f = path.join(OUT, `${tag}.app.pdf`);
        await dl.saveAs(f);
        row.appPdf = pdfInfo(f);
      }

      // (b) Chromium native print of #qa-print-root with the app's print CSS (A4)
      await page.emulateMedia({ media: 'print' });
      await page.evaluate(() => document.getElementById('qa-print-root')?.setAttribute('data-print-target', ''));
      const f2 = path.join(OUT, `${tag}.print.pdf`);
      await page.pdf({ path: f2, format: 'A4', printBackground: true, preferCSSPageSize: true });
      row.printPdf = pdfInfo(f2);
    } catch (e) {
      row.error = String(e).slice(0, 300);
    }
    row.pageErrors = errors;
    results.push(row);
    console.log(JSON.stringify(row));
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
})();
