// Experiment 6: A4-designed documents forced onto A5 / A6 / Letter via browser print (what a user choosing another paper in the dialog gets)
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:3001';
const papers = { A4: { format: 'A4' }, A5: { format: 'A5' }, A6: { format: 'A6' }, Letter: { format: 'Letter' }, A4L: { format: 'A4', landscape: true } };
const cases = [['tax_invoice', 'tax-invoice-erp-v2', 'three', 'rtl'], ['tax_invoice', 'tax-invoice-modern-v2', 'three', 'ltr']];
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  for (const [type, template, scenario, direction] of cases) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await ctx.addCookies([{ name: 'locale', value: direction === 'ltr' ? 'en' : 'ar', url: BASE }]);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/document-qa?${new URLSearchParams({ type, template, scenario, direction, qr: 'on', logo: 'on', assets: 'on' })}`, { waitUntil: 'networkidle', timeout: 120000 });
    await page.waitForSelector('#qa-print-root'); await page.evaluate(() => document.fonts.ready);
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => document.getElementById('qa-print-root').setAttribute('data-print-target', ''));
    for (const [name, opt] of Object.entries(papers)) {
      const f = path.join(OUT, `${template}_${direction}_${name}.pdf`);
      // preferCSSPageSize:false => the dialog's chosen paper wins over the global @page A4 (simulates user picking another paper)
      await page.pdf({ path: f, printBackground: true, preferCSSPageSize: false, ...opt, margin: { top: '14mm', bottom: '14mm', left: '14mm', right: '14mm' } });
      const i = execSync(`pdfinfo "${f}"`).toString();
      const t = execSync(`pdftotext -layout "${f}" -`).toString();
      // does the document's grand total survive on-page? look for total figure
      const hasTotal = /2541\.25|68\.75|\b2,?541/.test(t) || /إجمالي|Total/.test(t);
      // bbox: any word beyond page width?
      const bbox = execSync(`pdftotext -bbox "${f}" - | grep -o 'xMax="[0-9.]*"' | sed 's/[^0-9.]//g' | sort -n | tail -1`).toString().trim();
      const pw = /Page size:\s+([\d.]+) x/.exec(i)[1];
      console.log(`${template} ${direction} ${name.padEnd(7)} pages=${/Pages:\s+(\d+)/.exec(i)[1]} pageW=${pw} maxWordX=${bbox} totalsPresent=${hasTotal}`);
      execSync(`pdftoppm -r 45 -png -f 1 -l 1 "${f}" "${f}.p"`);
    }
    await ctx.close();
  }
  await browser.close();
})();
