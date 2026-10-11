// AWJ-TAX-REM-02-PRINT-02 — visual verification driver (standalone; not part of the Playwright test run).
//
//   Needs the QA page: copy credit-note-qa-page.tsx.txt to src/app/document-qa/credit-note/page.tsx (temporary, not committed) — see README.md
//   cd web && npm run dev -- -p 3001      # in another shell
//   node e2e/credit-note-visual/capture.mjs [outDir]
//
// Renders the real <CreditNoteDocument> through that temporary /document-qa/credit-note page in Chromium, screenshots #print-root at the
// document's natural size, runs DOM checks (clipping, overlap, equations), and produces browser-print PDFs and the
// app's own html2canvas/jsPDF PDF for a subset. Writes results.json next to the images.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE_URL ?? 'http://127.0.0.1:3001';
const OUT = path.resolve(process.argv[2] ?? 'qa-output');
const CHROME = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });

const SCENARIOS = ['inclusive', 'exclusive', 'line_discount', 'header_discount', 'rounding', 'vat5', 'mixed_rates', 'partial', 'historical', 'long_names', 'many_lines'];
const OTHER_A4 = ['tax-invoice-classic-v2', 'tax-invoice-modern', 'tax-invoice-modern-v2', 'tax-invoice-erp', 'tax-invoice-erp-v2', 'tax-invoice-minimal', 'tax-invoice-minimal-v2', 'tax-invoice-retail', 'tax-invoice-retail-v2', 'quotation-proposal', 'purchase-order-formal'];
const PAPERS = {
  a4: { template: 'tax-invoice-classic', paper: 'a4', widthMm: 210, heightMm: 297 },
  thermal_80: { template: 'tax-invoice-thermal80', paper: 'thermal_80', widthMm: 80, heightMm: 0 },
  thermal_58: { template: 'tax-invoice-thermal58', paper: 'thermal_58', widthMm: 58, heightMm: 0 },
};

/** كل حالة: اسم الملف، البارامترات، الفحوصات المطلوبة. */
const cases = [];
for (const lang of ['ar', 'en']) {
  for (const scenario of SCENARIOS) cases.push({ group: 'a4', lang, scenario, ...PAPERS.a4 });
  for (const template of OTHER_A4) for (const scenario of ['line_discount', 'header_discount']) cases.push({ group: 'a4-compositions', lang, scenario, ...PAPERS.a4, template });
  for (const key of ['thermal_80', 'thermal_58']) for (const scenario of SCENARIOS) cases.push({ group: key, lang, scenario, ...PAPERS[key] });
  for (const layout of ['saved-generic', 'saved-price']) for (const scenario of ['line_discount', 'header_discount', 'rounding']) cases.push({ group: 'saved-layout', lang, scenario, layout, ...PAPERS.a4 });
}

const digits = (s) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0)).replace(/٫/g, '.').replace(/٬/g, ',');
const nums = (s) => (digits(s).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
const slug = (c) => [c.group, c.paper, c.template.replace('tax-invoice-', ''), c.layout ?? 'default', c.scenario, c.lang].join('__');

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const results = [];

async function inspect(page) {
  return page.evaluate(() => {
    const root = document.getElementById('print-root');
    const r = root.getBoundingClientRect();
    const cells = [...root.querySelectorAll('th, td')];
    const clipped = cells.filter((c) => c.scrollWidth > c.clientWidth + 1).map((c) => (c.textContent ?? '').trim().slice(0, 40));
    const outside = [...root.querySelectorAll('*')].filter((e) => {
      const b = e.getBoundingClientRect();
      return b.width > 0 && (b.right > r.right + 1 || b.left < r.left - 1);
    }).map((e) => `${e.tagName}:${(e.textContent ?? '').trim().slice(0, 30)}`).slice(0, 6);
    // كلمة أعرض من محتوى خليتها تنكسر وسط الحرف (break-words): تُقاس كل كلمة في موضعها بخطّ الخلية الفعلي.
    const wordTooWide = [...root.querySelectorAll('thead th')].flatMap((th) => {
      const cs = getComputedStyle(th);
      const avail = th.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const label = (th.textContent ?? '').trim();
      return label.split(/\s+/).filter((w) => w.length > 1).filter((w) => {
        const span = document.createElement('span');
        span.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
        span.textContent = w;
        th.appendChild(span);
        const width = span.getBoundingClientRect().width;
        th.removeChild(span);
        return width > avail + 0.5;
      }).map((w) => `${label}→${w}`);
    });
    const overlaps = [];
    root.querySelectorAll('tr').forEach((tr) => {
      const rects = [...tr.children].map((c) => c.getBoundingClientRect());
      for (let i = 1; i < rects.length; i += 1) {
        const a = rects[i - 1]; const b = rects[i];
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1.5) overlaps.push((tr.textContent ?? '').trim().slice(0, 40));
      }
    });
    const headers = [...root.querySelectorAll('thead th')].map((t) => (t.textContent ?? '').trim());
    const rows = [...root.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((c) => (c.textContent ?? '').trim()));
    const totals = (root.querySelector('[data-doc-totals]')?.innerText ?? '').trim();
    const note = root.querySelector('[data-doc-rounding-note]')?.textContent ?? null;
    const discountNote = root.querySelector('[data-doc-discount-note]')?.textContent ?? null;
    return {
      width: Math.round(r.width), height: Math.round(r.height), scrollW: root.scrollWidth, clientW: root.clientWidth,
      clipped, outside, overlaps, wordTooWide, headers, rows, totals, note, discountNote, text: root.innerText,
      dir: root.getAttribute('dir') ?? getComputedStyle(root).direction,
      fontFamily: getComputedStyle(root).fontFamily,
      arabicFontLoaded: document.fonts.check('12px "IBM Plex Sans Arabic"'),
    };
  });
}

const FILTER = process.env.QA_FILTER;
for (const c of cases.filter((x) => !FILTER || slug(x).includes(FILTER))) {
  const widthPx = Math.ceil((c.widthMm / 25.4) * 96) + 40;
  const context = await browser.newContext({ viewport: { width: widthPx, height: 1200 }, deviceScaleFactor: c.paper === 'a4' ? 1.5 : 3 });
  await context.addCookies([{ name: 'locale', value: c.lang, url: BASE }]);
  const page = await context.newPage();
  const url = `${BASE}/document-qa/credit-note?scenario=${c.scenario}&template=${c.template}&layout=${c.layout ?? 'default'}&paper=${c.paper}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.waitForSelector('#print-root');
  await page.evaluate(() => document.fonts.ready);
  const info = await inspect(page);
  const file = `${slug(c)}.jpg`;
  await page.locator('#print-root').screenshot({ path: path.join(OUT, file), type: 'jpeg', quality: 82 });
  const entry = { ...c, file, ...info };

  // طباعة المتصفح (نفس حقن @page في printDocument) → عدد الصفحات.
  if (['a4', 'thermal_80', 'thermal_58'].includes(c.group) && (c.group !== 'a4' || ['line_discount', 'many_lines', 'long_names', 'header_discount'].includes(c.scenario))) {
    await page.evaluate((p) => {
      document.getElementById('print-root').setAttribute('data-print-target', '');
      const style = document.createElement('style');
      style.textContent = p.heightMm > 0 ? `@media print { @page { size: ${p.widthMm}mm ${p.heightMm}mm; } }` : `@media print { @page { size: ${p.widthMm}mm auto; margin: 4mm; } }`;
      document.head.appendChild(style);
    }, c);
    await page.emulateMedia({ media: 'print' });
    const pdfPath = path.join(OUT, `${slug(c)}__browser-print.pdf`);
    await page.pdf(c.heightMm > 0
      ? { path: pdfPath, width: `${c.widthMm}mm`, height: `${c.heightMm}mm`, printBackground: true, preferCSSPageSize: true }
      : { path: pdfPath, width: `${c.widthMm}mm`, printBackground: true, preferCSSPageSize: true });
    entry.printPages = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [pdfPath]).toString())?.[1] ?? 0);
    entry.printPdf = path.basename(pdfPath);
    await page.emulateMedia({ media: 'screen' });
  }

  // PDF التطبيق الفعلي (documentExporter → html2canvas + jsPDF) لمجموعة جزئية.
  if (c.lang && ['inclusive', 'line_discount', 'many_lines'].includes(c.scenario) && ['a4', 'thermal_80', 'thermal_58'].includes(c.group)) {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      page.evaluate(() => document.querySelector('[data-testid="qa-export-pdf"]').click()),
    ]);
    const appPdf = path.join(OUT, `${slug(c)}__app-pdf.pdf`);
    await download.saveAs(appPdf);
    entry.appPdf = path.basename(appPdf);
    entry.appPdfPages = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [appPdf]).toString())?.[1] ?? 0);
    execFileSync('pdftoppm', ['-r', '70', '-jpeg', '-jpegopt', 'quality=80', appPdf, appPdf.replace(/\.pdf$/, '')]);
  }

  results.push(entry);
  await context.close();
  process.stdout.write('.');
}
await browser.close();
writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results.map(({ text, ...rest }) => rest), null, 1));
writeFileSync(path.join(OUT, 'texts.json'), JSON.stringify(Object.fromEntries(results.map((r) => [r.file, r.text])), null, 1));
console.log(`\n${results.length} cases → ${OUT}`);
