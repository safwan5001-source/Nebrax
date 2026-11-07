// usage: node measure.js <outdir>   (dev server must run on :3001)
const { chromium, devices } = require('playwright');
const fs = require('fs'); const path = require('path');
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:3001';
const fixtures = [
 ['tax-erp-v2-single-rtl','tax_invoice','tax-invoice-erp-v2','single','rtl'],
 ['tax-erp-v2-multipage-rtl','tax_invoice','tax-invoice-erp-v2','multipage','rtl'],
 ['tax-classic-v2-twenty-ltr','tax_invoice','tax-invoice-classic-v2','twenty','ltr'],
 ['tax-modern-v2-long-rtl','tax_invoice','tax-invoice-modern-v2','long_content','rtl'],
 ['simplified-retail-v2-three-rtl','simplified_tax_invoice','tax-invoice-retail-v2','three','rtl'],
 ['quotation-five-rtl','quotation','quotation-proposal','five','rtl'],
 ['purchase-order-twenty-ltr','purchase_order','purchase-order-formal','twenty','ltr'],
];
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  for (const [name, type, template, scenario, direction] of fixtures) {
    for (const vp of ['desktop', 'iphone13']) {
      const ctx = await b.newContext(vp === 'iphone13' ? { ...devices['iPhone 13'], acceptDownloads: true } : { viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
      await ctx.addCookies([{ name: 'locale', value: direction === 'ltr' ? 'en' : 'ar', url: BASE }]);
      const p = await ctx.newPage();
      await p.goto(`${BASE}/document-qa?${new URLSearchParams({ type, template, scenario, direction, qr: 'on', logo: 'on', assets: 'on' })}`, { waitUntil: 'networkidle', timeout: 120000 });
      await p.waitForSelector('#qa-print-root'); await p.evaluate(() => document.fonts.ready);
      const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), p.getByTestId('qa-download-pdf').click()]);
      await dl.saveAs(path.join(OUT, `${name}__${vp}.pdf`));
      await ctx.close();
    }
    console.log('done', name);
  }
  await b.close();
})();
