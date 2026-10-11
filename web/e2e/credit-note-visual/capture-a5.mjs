// معلوماتي فقط: لا يوجد مقاس A5 في المنتج (PAPER_SIZES) ولا قالب يدعمه. يوضّح ما يحدث لو طُبع قالب A4 على ورق A5
// (بلا تحجيم، ثم «ملاءمة الصفحة»). لا يُحتسب تحققاً من سلوك منتج.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const BASE = process.env.QA_BASE_URL ?? 'http://127.0.0.1:3001';
const OUT = path.resolve(process.argv[2] ?? 'qa-output-a5'); mkdirSync(OUT, { recursive: true });
const CHROME = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
for (const lang of ['ar', 'en']) for (const scenario of ['line_discount', 'header_discount']) for (const mode of ['unscaled', 'fit']) {
  const ctx = await b.newContext({ viewport: { width: 900, height: 1200 } });
  await ctx.addCookies([{ name: 'locale', value: lang, url: BASE }]);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/document-qa/credit-note?scenario=${scenario}&template=tax-invoice-classic`, { waitUntil: 'networkidle', timeout: 90_000 });
  await p.waitForSelector('#print-root'); await p.evaluate(() => document.fonts.ready);
  await p.evaluate(() => { document.getElementById('print-root').setAttribute('data-print-target', ''); const s = document.createElement('style'); s.textContent = '@media print { @page { size: 148mm 210mm; margin: 0 } }'; document.head.appendChild(s); });
  await p.emulateMedia({ media: 'print' });
  const pdf = path.join(OUT, `a5-informational__${scenario}__${lang}__${mode}.pdf`);
  await p.pdf({ path: pdf, width: '148mm', height: '210mm', printBackground: true, scale: mode === 'fit' ? 148 / 210 : 1, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
  execFileSync('pdftoppm', ['-r', '80', '-jpeg', '-jpegopt', 'quality=80', '-f', '1', '-l', '1', pdf, pdf.replace(/\.pdf$/, '')]);
  const pages = /Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [pdf]).toString())[1];
  console.log(path.basename(pdf), 'pages', pages);
  await ctx.close();
}
await b.close();
