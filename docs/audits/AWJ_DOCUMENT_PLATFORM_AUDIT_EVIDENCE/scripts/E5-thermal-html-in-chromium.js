// Experiment 5: thermal HTML + real app CSS in Chromium. measure overflow / truncation / print to roll widths
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
const IN = process.argv[2]; const OUT = process.argv[3]; fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:3001';
function info(f) { const i = execSync(`pdfinfo "${f}"`).toString(); return { pages: /Pages:\s+(\d+)/.exec(i)?.[1], size: /Page size:\s+(.*)/.exec(i)?.[1] }; }
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  // harvest compiled CSS + font links from a real app page
  const hp = await browser.newPage();
  await hp.goto(`${BASE}/document-qa`, { waitUntil: 'networkidle', timeout: 120000 });
  const head = await hp.evaluate(() => Array.from(document.querySelectorAll('link[rel=stylesheet]')).map((l) => l.href));
  const htmlAttrs = await hp.evaluate(() => document.documentElement.className);
  await hp.close();
  console.log('css links', head.length, 'html class', htmlAttrs.slice(0, 80));
  const files = fs.readdirSync(IN).filter((f) => f.endsWith('.html')).sort();
  const rows = [];
  for (const f of files) {
    const [, w, locale, scenario] = /thermal_(\d+)_(\w+)_(\w+)\.html/.exec(f);
    const page = await browser.newPage({ viewport: { width: 600, height: 900 } });
    const body = fs.readFileSync(path.join(IN, f), 'utf8');
    const dir = locale === 'ar' ? 'rtl' : 'ltr';
    await page.setContent(`<!doctype html><html lang="${locale}" dir="${dir}" class="${htmlAttrs}"><head>${head.map((h) => `<link rel="stylesheet" href="${h}">`).join('')}</head><body><main>${body}</main></body></html>`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(() => {
      const r = document.getElementById('print-root');
      const b = r.getBoundingClientRect();
      const trunc = Array.from(r.querySelectorAll('.truncate')).filter((e) => e.scrollWidth > e.clientWidth + 1).length;
      const overflowEls = Array.from(r.querySelectorAll('*')).filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow === 'visible' && e.getBoundingClientRect().right > b.right + 1).length;
      const qr = r.querySelector('svg');
      const q = qr ? qr.getBoundingClientRect() : null;
      return { wPx: Math.round(b.width), hPx: Math.round(b.height), wMm: +(b.width / 96 * 25.4).toFixed(1), truncatedLines: trunc, overflowRight: overflowEls, qrPx: q ? Math.round(q.width) : null, scrollW: r.scrollWidth };
    });
    await page.locator('#print-root').screenshot({ path: path.join(OUT, f.replace('.html', '.png')) });
    // print as the app does: global A4 14mm vs forced roll width
    await page.emulateMedia({ media: 'print' });
    const pdfA = path.join(OUT, f.replace('.html', '.A4default.pdf'));
    await page.pdf({ path: pdfA, printBackground: true, preferCSSPageSize: true });
    const pdfR = path.join(OUT, f.replace('.html', '.roll.pdf'));
    await page.pdf({ path: pdfR, printBackground: true, width: `${w}mm`, height: '600mm', margin: { top: '0', bottom: '0', left: '0', right: '0' } });
    const row = { f, ...m, a4default: info(pdfA), roll: info(pdfR) };
    rows.push(row); console.log(JSON.stringify(row));
    await page.close();
  }
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(rows, null, 2));
  await browser.close();
})();
