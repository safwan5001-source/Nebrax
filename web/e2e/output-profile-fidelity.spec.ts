import { devices, expect, test, webkit, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectPdf } from '../src/lib/__tests__/helpers/pdf-inspect';
import { makeDocumentQaModel } from '../src/modules/documents/qa/document-qa-fixtures';
import arMessages from '../src/messages/ar.json';
import enMessages from '../src/messages/en.json';

/**
 * AWJ-DOC-V2-PR3B — Output Profile عبر المعاينة والطباعة وتنزيل PDF في Chromium حقيقي.
 *
 * يستعمل `/document-qa` (بيانات اصطناعية، بلا Backend) وطبقة الحلّ نفسها التي تستعملها الصفحات الحقيقية
 * (`resolveDocumentOutputSpec`). لكل مقاس يقارن المستند نفسه في ثلاثة مسارات:
 *  1) المعاينة (DOM): ورقة بأبعاد المقاس وجذر بعرض المحتوى، ولا فيضان/تداخل/كسر كلمات.
 *  2) الطباعة: `printDocument` ← `@page` ← `page.pdf` بوسائط print (يلتزم Chromium بـ`@page` كحوار الطباعة).
 *  3) التنزيل: `documentExporter` (html2canvas + jsPDF) — PDF صوري.
 * والمقارنة: مقاس الصفحة، عدد الصفحات، وحدود الحبر داخل منطقة الهوامش (pdftoppm).
 *
 * حدود صريحة:
 *  • **لا طابعة حقيقية**: الطباعة محاكاة بـ`page.pdf()`؛ لا تثبت سلوك سائق/ورق فعلي. الاختبار المادي: غير منفَّذ.
 *  • iPhone = محاكاة Chromium، **ليس Safari**. WebKit إن لم يكن مثبّتاً يُتخطّى اختباره صراحةً.
 *  • يتطلب `pdftoppm` (poppler-utils) لفحص حدود الحبر؛ غيابه يُتخطّى به ذلك الفحص فقط.
 * لا يعمل في Web CI (لا Playwright هناك): `npx playwright test e2e/output-profile-fidelity.spec.ts --project=desktop`.
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const evidenceDir = path.resolve(process.cwd(), 'test-results/output-profile');
const PT_PER_MM = 72 / 25.4;
const SIZE_TOLERANCE_MM = 0.8;
const INK_TOLERANCE_MM = 1.6;

type Direction = 'rtl' | 'ltr';
type Scenario = 'single' | 'three' | 'five' | 'twenty' | 'multipage';
type Orientation = 'portrait' | 'landscape';

interface Paper { key: string; paper: string; orientation: Orientation; widthMm: number; heightMm: number; margin: number }
const A4: Paper = { key: 'a4', paper: 'a4', orientation: 'portrait', widthMm: 210, heightMm: 297, margin: 14 };
const A4L: Paper = { key: 'a4-landscape', paper: 'a4', orientation: 'landscape', widthMm: 297, heightMm: 210, margin: 14 };
const A5L: Paper = { key: 'a5-landscape', paper: 'a5', orientation: 'landscape', widthMm: 210, heightMm: 148, margin: 10 };
const A5: Paper = { key: 'a5', paper: 'a5', orientation: 'portrait', widthMm: 148, heightMm: 210, margin: 10 };
const A6L: Paper = { key: 'a6-landscape', paper: 'a6', orientation: 'landscape', widthMm: 148, heightMm: 105, margin: 8 };
const LETTER: Paper = { key: 'letter', paper: 'letter', orientation: 'portrait', widthMm: 216, heightMm: 279, margin: 14 };
const LEGAL: Paper = { key: 'legal', paper: 'legal', orientation: 'portrait', widthMm: 216, heightMm: 356, margin: 14 };

const TEMPLATES = [
  ['tax-invoice-classic', 'tax_invoice'], ['tax-invoice-classic-v2', 'tax_invoice'], ['tax-invoice-modern', 'tax_invoice'], ['tax-invoice-modern-v2', 'tax_invoice'],
  ['tax-invoice-erp', 'tax_invoice'], ['tax-invoice-erp-v2', 'tax_invoice'], ['tax-invoice-minimal', 'tax_invoice'], ['tax-invoice-minimal-v2', 'tax_invoice'],
  ['tax-invoice-retail', 'tax_invoice'], ['tax-invoice-retail-v2', 'tax_invoice'], ['quotation-proposal', 'quotation'], ['purchase-order-formal', 'purchase_order'],
] as const;

/** الضيّق: مقاسات أُثبتت لقوالب بعينها (نفس جدول الأدلة في output-spec.test.ts). */
const NARROW: Array<{ template: string; type: string; paper: Paper }> = [
  { template: 'tax-invoice-classic-v2', type: 'tax_invoice', paper: A5 },
  { template: 'tax-invoice-classic-v2', type: 'tax_invoice', paper: A6L },
  { template: 'tax-invoice-erp-v2', type: 'tax_invoice', paper: A6L },
  { template: 'tax-invoice-minimal', type: 'tax_invoice', paper: A6L },
  { template: 'tax-invoice-minimal-v2', type: 'tax_invoice', paper: A6L },
];

interface QaOptions {
  template: string;
  type: string;
  scenario?: Scenario;
  direction?: Direction;
  paper?: Paper | { paper: string; orientation?: Orientation; margins?: string; customW?: number; customH?: number } | null;
}

function qaUrl({ template, type, scenario = 'three', direction = 'rtl', paper = null }: QaOptions) {
  const query = new URLSearchParams({ type, template, scenario, direction, qr: 'on', logo: 'on', assets: 'on' });
  if (paper) {
    query.set('paper', paper.paper);
    if (paper.orientation) query.set('orientation', paper.orientation);
    if ('margins' in paper && paper.margins) query.set('margins', paper.margins);
    if ('customW' in paper && paper.customW) query.set('custom_w', String(paper.customW));
    if ('customH' in paper && paper.customH) query.set('custom_h', String(paper.customH));
  }
  return `${baseUrl}/document-qa?${query}`;
}

async function openQa(browser: Browser, options: QaOptions, mobile = false) {
  const direction = options.direction ?? 'rtl';
  const context: BrowserContext = await browser.newContext(
    mobile ? { ...devices['iPhone 13'], acceptDownloads: true } : { viewport: { width: 1600, height: 1000 }, acceptDownloads: true },
  );
  await context.addCookies([{ name: 'locale', value: direction === 'ltr' ? 'en' : 'ar', url: baseUrl }]);
  const page = await context.newPage();
  await page.addInitScript(() => {
    (window as unknown as { __printStyle: string | null }).__printStyle = null;
    window.print = () => {
      (window as unknown as { __printStyle: string | null }).__printStyle = document.getElementById('nebrax-doc-print-page')?.textContent ?? null;
    };
  });
  await page.goto(qaUrl(options), { waitUntil: 'networkidle', timeout: 120_000 });
  // شارة أدوات Next الخاصة بوضع التطوير (ثابتة أسفل-يسار) تظهر في ناتج `page.pdf` وتلوّث قياس الحبر؛ ليست من المنتج.
  await page.addStyleTag({ content: 'nextjs-portal, #next-logo, [data-nextjs-dev-tools-button], [data-nextjs-toast] { display: none !important; }' });
  await expect(page.locator('#qa-print-root')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return { context, page };
}

/** هندسة المعاينة + جودة التخطيط (فيضان، تداخل خلايا، كلمات مكسورة وسط الكلمة داخل الجداول). */
async function geometry(page: Page) {
  return page.evaluate(() => {
    const root = document.getElementById('qa-print-root') as HTMLElement;
    const rr = root.getBoundingClientRect();
    const shell = document.querySelector('[data-testid="qa-preview-shell"]') as HTMLElement;
    const sheet = shell.querySelector<HTMLElement>('[data-doc-sheet]');
    const mm = (px: number) => (px * 25.4) / 96;
    const all = [...root.querySelectorAll<HTMLElement>('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const outside = all.filter((e) => { const r = e.getBoundingClientRect(); return r.right > rr.right + 1 || r.left < rr.left - 1; }).length;

    let overlaps = 0;
    for (const tr of root.querySelectorAll('tr')) {
      const cells = [...tr.children].map((c) => c.getBoundingClientRect());
      for (let i = 0; i < cells.length; i += 1) for (let j = i + 1; j < cells.length; j += 1) {
        const a = cells[i]; const b = cells[j];
        if (a.width > 0 && b.width > 0 && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps += 1;
      }
    }

    // كلمة تمتد على أكثر من مستطيل سطر = كُسرت وسط الكلمة.
    let splitWords = 0;
    const splitSamples: string[] = [];
    for (const cell of root.querySelectorAll('th, td')) {
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        const text = node.textContent ?? '';
        for (const match of text.matchAll(/\S{2,}/g)) {
          const range = document.createRange();
          range.setStart(node, match.index ?? 0);
          range.setEnd(node, (match.index ?? 0) + match[0].length);
          const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
          if (tops.size > 1) { splitWords += 1; if (splitSamples.length < 3) splitSamples.push(match[0]); }
        }
      }
    }

    return {
      applied: shell.getAttribute('data-output-applied') === 'true',
      rootWmm: mm(rr.width),
      rootHmm: mm(rr.height),
      sheetWmm: sheet ? mm(sheet.getBoundingClientRect().width) : null,
      hasSheet: Boolean(sheet),
      narrow: root.hasAttribute('data-doc-narrow'),
      headers: root.querySelectorAll('thead th').length,
      outside,
      scrollOverflow: root.scrollWidth - root.clientWidth,
      overlaps,
      splitWords,
      splitSamples,
      text: root.innerText,
      pageScrollOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
}

async function printPdf(page: Page) {
  await page.getByTestId('qa-print').click();
  const style = await page.evaluate(() => (window as unknown as { __printStyle: string | null }).__printStyle);
  await page.emulateMedia({ media: 'print' });
  const buffer = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  return { style, buffer, info: inspectPdf(buffer) };
}

async function exportPdf(page: Page) {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.getByTestId('qa-download-pdf').click()]);
  const buffer = await readFile((await download.path())!);
  return { buffer, info: inspectPdf(buffer) };
}

const hasPoppler = (() => { try { execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();

/** حدود الحبر (مم) لصفحة PDF: تُرسَم بـpdftoppm رمادياً ويُقرأ PGM. */
async function inkBox(buffer: Buffer, pageNumber: number, widthMm: number, heightMm: number) {
  const dir = await (async () => { const d = path.join(tmpdir(), `op-ink-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`); await mkdir(d, { recursive: true }); return d; })();
  try {
    const pdfPath = path.join(dir, 'in.pdf');
    await writeFile(pdfPath, buffer);
    execFileSync('pdftoppm', ['-gray', '-r', '40', '-f', String(pageNumber), '-l', String(pageNumber), pdfPath, path.join(dir, 'p')]);
    const file = (await readdir(dir)).find((name) => name.startsWith('p-') && name.endsWith('.pgm'))!;
    const data = await readFile(path.join(dir, file));
    // P5\nW H\n255\n
    let pos = 0;
    const token = () => { while (data[pos] === 0x20 || data[pos] === 0x0a || data[pos] === 0x0d || data[pos] === 0x09) pos += 1; const start = pos; while (data[pos] > 0x20) pos += 1; return data.subarray(start, pos).toString('ascii'); };
    expect(token()).toBe('P5');
    const w = Number(token()); const h = Number(token()); token(); pos += 1;
    let minX = w; let minY = h; let maxX = -1; let maxY = -1;
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      if (data[pos + y * w + x] < 200) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    if (maxX < 0) return null;
    const sx = widthMm / w; const sy = heightMm / h;
    return { left: minX * sx, top: minY * sy, right: (maxX + 1) * sx, bottom: (maxY + 1) * sy };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function expectInsideMargins(box: { left: number; top: number; right: number; bottom: number } | null, paper: Paper, label: string) {
  expect(box, `${label}: صفحة بلا حبر`).not.toBeNull();
  expect(box!.left, `${label}: الحبر يتجاوز الهامش الأيسر`).toBeGreaterThanOrEqual(paper.margin - INK_TOLERANCE_MM);
  expect(box!.top, `${label}: الحبر يتجاوز الهامش العلوي`).toBeGreaterThanOrEqual(paper.margin - INK_TOLERANCE_MM);
  expect(box!.right, `${label}: الحبر يتجاوز الهامش الأيمن`).toBeLessThanOrEqual(paper.widthMm - paper.margin + INK_TOLERANCE_MM);
  expect(box!.bottom, `${label}: الحبر يتجاوز الهامش السفلي`).toBeLessThanOrEqual(paper.heightMm - paper.margin + INK_TOLERANCE_MM);
}

const pageSizeMm = (info: ReturnType<typeof inspectPdf>, index = 0) => ({
  w: info.mediaBoxes[index].widthPt / PT_PER_MM,
  h: info.mediaBoxes[index].heightPt / PT_PER_MM,
});
const squash = (value: string) => value.replace(/[\s٬،,]+/g, '');
const money = (minor: number) => (minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function marginCss(paper: Paper) {
  const m = paper.margin;
  return `@media print { @page { size: ${paper.widthMm}mm ${paper.heightMm}mm; margin: ${m}mm ${m}mm ${m}mm ${m}mm; } }`;
}

/** المقارنة الكاملة لمقاس مدعوم: معاينة + طباعة + PDF. */
async function verifyProfile(browser: Browser, opts: { template: string; type: string; paper: Paper; scenario?: Scenario; direction?: Direction; strictWords?: boolean }, tag: string) {
  await mkdir(evidenceDir, { recursive: true });
  const { context, page } = await openQa(browser, { template: opts.template, type: opts.type, scenario: opts.scenario ?? 'three', direction: opts.direction ?? 'rtl', paper: opts.paper });
  const { paper } = opts;
  try {
    const g = await geometry(page);
    expect(g.applied, 'الملف لم يُطبَّق رغم أنه معلَن مدعوماً').toBe(true);
    expect(g.sheetWmm, 'عرض الورقة').toBeCloseTo(paper.widthMm, 0);
    expect(Math.abs(g.rootWmm - (paper.widthMm - 2 * paper.margin)), `عرض الجذر ${g.rootWmm}mm`).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
    expect(g.outside, 'عناصر خارج الجذر').toBe(0);
    expect(g.scrollOverflow, 'تمرير أفقي داخل المستند').toBeLessThanOrEqual(0);
    expect(g.overlaps, 'خلايا متداخلة').toBe(0);
    if (opts.strictWords) expect(g.splitWords, `كلمات مكسورة وسط الكلمة: ${g.splitSamples.join(' | ')}`).toBe(0);

    const print = await printPdf(page);
    expect(print.style, 'لم يُحقن @page').toBe(marginCss(paper));
    const printSize = pageSizeMm(print.info);
    expect(Math.abs(printSize.w - paper.widthMm), `عرض صفحة الطباعة ${printSize.w}`).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
    expect(Math.abs(printSize.h - paper.heightMm), `ارتفاع صفحة الطباعة ${printSize.h}`).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);

    const exported = await exportPdf(page);
    const exportSize = pageSizeMm(exported.info);
    expect(Math.abs(exportSize.w - paper.widthMm)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
    expect(Math.abs(exportSize.h - paper.heightMm)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
    expect(exported.info.hasUncompressedImages).toBe(false);

    if (hasPoppler) {
      for (let i = 1; i <= print.info.pageCount; i += 1) expectInsideMargins(await inkBox(print.buffer, i, paper.widthMm, paper.heightMm), paper, `طباعة ص${i}`);
      for (let i = 1; i <= exported.info.pageCount; i += 1) expectInsideMargins(await inkBox(exported.buffer, i, paper.widthMm, paper.heightMm), paper, `PDF ص${i}`);
    }

    await writeFile(path.join(evidenceDir, `${tag}.json`), JSON.stringify({
      paper: paper.key, preview: { rootWmm: g.rootWmm, rootHmm: g.rootHmm, sheetWmm: g.sheetWmm, narrow: g.narrow, headers: g.headers, splitWords: g.splitWords },
      printPdf: { pages: print.info.pageCount, widthMm: printSize.w, heightMm: printSize.h },
      exportPdf: { pages: exported.info.pageCount, widthMm: exportSize.w, heightMm: exportSize.h },
    }, null, 2));
    return { g, print, exported };
  } finally {
    await context.close();
  }
}

// ───────────────────────── 1) غياب الملف = السلوك السابق حرفياً ─────────────────────────
for (const [template, type] of TEMPLATES) {
  test(`بلا ملف إخراج · ${template}: المعاينة والطباعة وPDF كما كانت (A4)`, async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
    test.setTimeout(120_000);
    const { context, page } = await openQa(browser, { template, type });
    try {
      const g = await geometry(page);
      expect(g.applied).toBe(false);
      expect(g.hasSheet, 'لا ورقة معاينة بلا ملف').toBe(false);
      expect(g.narrow).toBe(false);
      expect(Math.abs(g.rootWmm - 210)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
      const print = await printPdf(page);
      expect(print.style, 'الصياغة السابقة حرفياً (بلا هامش مُعلَن)').toBe('@media print { @page { size: 210mm 297mm; } }');
      const printSize = pageSizeMm(print.info);
      expect(Math.abs(printSize.w - 210)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
      expect(Math.abs(printSize.h - 297)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
      const exported = await exportPdf(page);
      const exportSize = pageSizeMm(exported.info);
      expect(Math.abs(exportSize.w - 210)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
      expect(Math.abs(exportSize.h - 297)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
    } finally {
      await context.close();
    }
  });
}

// ───────────────────────── 2) صفحات بعرض محتوى ≥ 182mm: كل القوالب ─────────────────────────
for (const [template, type] of TEMPLATES) {
  // retail/retail-v2 لا يعلنان Legal (لم يُثبَت تخطيطهما عليه) ⇒ يُحجب ويُختبر كاحتياط إلى السلوك القديم في قسم «غير المدعوم».
  const retail = template.startsWith('tax-invoice-retail');
  for (const paper of retail ? [A4, A4L, A5L, LETTER] : [A4, A4L, A5L, LETTER, LEGAL]) {
    test(`${template} · ${paper.key}: معاينة + طباعة + PDF بالمقاس والهوامش`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
      test.setTimeout(180_000);
      await verifyProfile(browser, { template, type, paper }, `${template}-${paper.key}`);
    });
  }
}

// ───────────────────────── 3) الإطار الضيّق: مقاسات أُثبتت لقوالب بعينها ─────────────────────────
for (const { template, type, paper } of NARROW) {
  for (const direction of ['rtl', 'ltr'] as const) {
    test(`ضيّق · ${template} · ${paper.key} · ${direction}: تدفّق مدمج بلا كلمات مكسورة ولا تداخل`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
      test.setTimeout(180_000);
      const { g } = await verifyProfile(browser, { template, type, paper, direction, strictWords: true }, `narrow-${template}-${paper.key}-${direction}`);
      expect(g.narrow, 'إطار ضيّق').toBe(true);
      expect(g.headers, 'أعمدة التعريف (#، الرمز، الباركود) تُخفى فقط').toBe(7);
      // الأعمدة المالية كلها باقية
      const text = squash(g.text);
      const model = makeDocumentQaModel({ documentType: 'tax_invoice', scenario: 'three', direction, showQr: true, showAssets: true });
      for (const line of model.lines) {
        expect(text, `إجمالي بند مفقود`).toContain(squash(money(line.total)));
        expect(text).toContain(squash(money(line.tax)));
      }
      expect(text).toContain(squash(money(model.totals.total)));
    });
  }
}

// ───────────────────────── 4) مستند طويل: صفحات متعددة ─────────────────────────
for (const paper of [A4, A4L, A5L, A5, A6L]) {
  test(`مستند طويل · classic-v2 · ${paper.key}: يُقسَّم على صفحات بالمقاس والهوامش ولا يضيع شيء`, async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
    test.setTimeout(300_000);
    const { g, print, exported } = await verifyProfile(browser, { template: 'tax-invoice-classic-v2', type: 'tax_invoice', paper, scenario: 'multipage' }, `multipage-classic-v2-${paper.key}`);
    expect(print.info.pageCount, 'الطباعة').toBeGreaterThanOrEqual(2);
    expect(exported.info.pageCount, 'PDF').toBeGreaterThanOrEqual(2);
    const model = makeDocumentQaModel({ documentType: 'tax_invoice', scenario: 'multipage', direction: 'rtl', showQr: true, showAssets: true });
    const text = squash(g.text);
    for (const line of model.lines) expect(text, 'بند مفقود من المعاينة').toContain(squash(money(line.total)));
    // آخر صفحة طباعة تحمل إجمالي الفاتورة (لا يبقى الإجمالي في صفحة ضائعة)
    const dir = path.join(tmpdir(), `op-text-${process.pid}-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    try {
      const file = path.join(dir, 'p.pdf');
      await writeFile(file, print.buffer);
      const last = execFileSync('pdftotext', ['-f', String(print.info.pageCount), '-l', String(print.info.pageCount), file, '-']).toString();
      expect(squash(last)).toContain(squash(money(model.totals.total)));
      // لا صفحة أخيرة فارغة
      expect(last.trim().length).toBeGreaterThan(20);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

// ───────────────────────── 5) ملف غير مدعوم من القالب = السلوك السابق ─────────────────────────
for (const [template, paper] of [
  ['tax-invoice-classic', { paper: 'a6', orientation: 'portrait' as const }],
  ['tax-invoice-classic', { paper: 'a5', orientation: 'portrait' as const }],
  ['tax-invoice-classic-v2', { paper: 'a6', orientation: 'portrait' as const }],
  ['tax-invoice-classic', { paper: 'a4', orientation: 'portrait' as const, margins: '20' }],
  ['tax-invoice-classic-v2', { paper: 'custom', customW: 120, customH: 200 }],
  ['tax-invoice-retail', { paper: 'legal', orientation: 'portrait' as const }],
  ['tax-invoice-retail-v2', { paper: 'legal', orientation: 'portrait' as const }],
] as const) {
  test(`غير مدعوم · ${template} · ${JSON.stringify(paper)}: يُعامل كغائب (A4 بلا تغيير)`, async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
    test.setTimeout(120_000);
    const { context, page } = await openQa(browser, { template, type: 'tax_invoice', paper });
    try {
      const g = await geometry(page);
      expect(g.applied).toBe(false);
      expect(g.hasSheet).toBe(false);
      expect(Math.abs(g.rootWmm - 210)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
      const print = await printPdf(page);
      expect(print.style).toBe('@media print { @page { size: 210mm 297mm; } }');
      const exported = await exportPdf(page);
      expect(Math.abs(pageSizeMm(exported.info).w - 210)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
    } finally {
      await context.close();
    }
  });
}

test('مقاس مخصص · classic-v2 150×210: يُطبَّق بعرض محتوى 130mm', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
  test.setTimeout(180_000);
  const { context, page } = await openQa(browser, { template: 'tax-invoice-classic-v2', type: 'tax_invoice', paper: { paper: 'custom', customW: 150, customH: 210 } });
  try {
    const g = await geometry(page);
    expect(g.applied).toBe(true);
    expect(g.sheetWmm).toBeCloseTo(150, 0);
    expect(Math.abs(g.rootWmm - 130)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
    expect(g.narrow).toBe(true);
    expect(g.overlaps).toBe(0);
    expect(g.splitWords, g.splitSamples.join(' | ')).toBe(0);
    const print = await printPdf(page);
    expect(print.style).toBe('@media print { @page { size: 150mm 210mm; margin: 10mm 10mm 10mm 10mm; } }');
    const exported = await exportPdf(page);
    expect(Math.abs(pageSizeMm(exported.info).w - 150)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
  } finally {
    await context.close();
  }
});

// ───────────────────────── 6) الحراري (PR #2068) لا ينحدر ─────────────────────────
for (const width of [58, 80] as const) {
  test(`حراري ${width}mm: مسار PR2 كما هو (رول margin:0 بارتفاع المحتوى) مع ملف مطابق وبدونه`, async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
    test.setTimeout(180_000);
    for (const paper of [null, { paper: `thermal_${width}` }] as const) {
      const { context, page } = await openQa(browser, { template: `tax-invoice-thermal${width}`, type: 'simplified_tax_invoice', scenario: 'five', paper });
      try {
        const g = await geometry(page);
        expect(g.hasSheet, 'الرول بلا ورقة صفحات').toBe(false);
        expect(Math.abs(g.rootWmm - width)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
        const print = await printPdf(page);
        expect(print.style).toMatch(new RegExp(`@page\\s*\\{\\s*size:\\s*${width}mm\\s+[\\d.]+mm;\\s*margin:\\s*0;`));
        expect(print.info.pageCount).toBe(1);
        expect(pageSizeMm(print.info).w).toBeCloseTo(width, 0);
        const exported = await exportPdf(page);
        expect(exported.info.pageCount).toBe(1);
        expect(pageSizeMm(exported.info).w).toBeCloseTo(width, 0);
      } finally {
        await context.close();
      }
    }
  });
}

// ───────────────────────── 7) iPhone (محاكاة Chromium) ─────────────────────────
test('iPhone 13 (محاكاة Chromium): A5 عمودي — بلا تمرير أفقي، وPDF بمقاس الورقة لا مقاس المعاينة المصغَّرة', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'المحاكاة المحمولة تُدار داخل الاختبار');
  test.setTimeout(180_000);
  const { context, page } = await openQa(browser, { template: 'tax-invoice-classic-v2', type: 'tax_invoice', paper: A5 }, true);
  try {
    const g = await geometry(page);
    expect(g.applied).toBe(true);
    expect(g.pageScrollOverflow, 'تمرير أفقي للصفحة على الجوال').toBeLessThanOrEqual(1);
    const scale = await page.evaluate(() => {
      const inner = document.querySelector<HTMLElement>('.doc-scaler-inner');
      const match = /scale\(([\d.]+)\)/.exec(inner?.style.transform ?? '');
      return match ? Number(match[1]) : 1;
    });
    expect(scale, 'المعاينة مصغَّرة لتملأ الشاشة').toBeLessThan(1);
    const print = await printPdf(page);
    expect(print.style).toBe(marginCss(A5));
    const exported = await exportPdf(page);
    const size = pageSizeMm(exported.info);
    expect(Math.abs(size.w - 148)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
    expect(Math.abs(size.h - 210)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
    await page.screenshot({ path: path.join(evidenceDir, 'iphone-a5.png'), fullPage: false });
  } finally {
    await context.close();
  }
});

// ───────────────────────── 8) محرر القوالب (الاستوديو) في وضع المعاينة التجريبية ─────────────────────────
interface Labels { start: string; next: string; create: string; properties: string; preview: string; family: string }
function labelsFor(locale: 'ar' | 'en'): Labels {
  const m = (locale === 'ar' ? arMessages : enMessages) as unknown as { printTemplateStudio: Record<string, string>; documentTypes: Record<string, string> };
  return {
    start: m.printTemplateStudio.library_start_template,
    next: m.printTemplateStudio.creation_next,
    create: m.printTemplateStudio.creation_confirm_draft,
    properties: m.printTemplateStudio.workspace_properties,
    preview: m.printTemplateStudio.workspace_preview,
    family: m.documentTypes.tax_invoice,
  };
}

async function openStudio(browser: Browser, locale: 'ar' | 'en', mobile: boolean) {
  const context = await browser.newContext(mobile ? { ...devices['iPhone 13'] } : { viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('demo', 'true');
    localStorage.setItem('user', JSON.stringify({ id: 'demo-user', name: 'demo', email: 'd@x.t', role: 'owner', permissions: ['*'], tenant_id: 'demo-tenant' }));
  });
  const L = labelsFor(locale);
  await page.goto(`${baseUrl}/document-design`, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.getByText(L.family, { exact: false }).first().click();
  await page.getByText(L.start).first().click();
  await page.getByRole('button', { name: L.next, exact: true }).click();
  await page.getByRole('button', { name: L.next, exact: true }).click();
  await page.locator('input[type=text]:visible, input:not([type]):visible').first().fill('Page setup QA');
  await page.getByRole('button', { name: L.create }).click();
  await page.getByRole('tab').filter({ hasText: L.properties }).first().click();
  await expect(page.getByTestId('page-setup')).toBeVisible({ timeout: 30_000 });
  return { context, page, L };
}

for (const [locale, mobile] of [['ar', false], ['en', true]] as const) {
  test(`المحرر · ${locale} · ${mobile ? 'iPhone 13 (محاكاة)' : 'سطح المكتب'}: اختيار المقاس والهوامش والتحقق والمعاينة`, async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'يُدار داخل الاختبار');
    test.setTimeout(180_000);
    await mkdir(evidenceDir, { recursive: true });
    const { context, page, L } = await openStudio(browser, locale, mobile);
    try {
      const paper = page.getByTestId('page-setup-paper');
      // خيارات القالب الكلاسيكي: بلا A6، A5 أفقي فقط
      const values = await paper.evaluate((el) => [...(el as HTMLSelectElement).options].map((o) => o.value));
      expect(values).toEqual(['default', 'a4', 'a5', 'letter', 'legal', 'custom']);

      await paper.selectOption('a5');
      await expect(page.getByTestId('page-setup-orientation-portrait')).toBeDisabled();
      await expect(page.getByTestId('page-setup-orientation-landscape')).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByTestId('page-setup-summary')).toContainText('210×148');

      // إدخال غير صالح يُمنع برسالة عند الحقل
      await page.getByTestId('page-setup-margin-top').fill('60');
      await expect(page.getByTestId('page-setup-margin-top')).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('#page-setup-margin-top-error')).toBeVisible();
      // هامش عرضي يُضيّق المحتوى عن حدّ القالب
      await page.getByTestId('page-setup-margin-top').fill('10');
      await page.getByTestId('page-setup-margin-left').fill('30');
      await expect(page.getByTestId('page-setup-error-form')).toContainText('182');
      await page.getByTestId('page-setup-margins-reset').click();
      await expect(page.getByTestId('page-setup-error-form')).toHaveCount(0);

      // المعاينة تعكس الورقة المختارة
      await page.getByRole('tab').filter({ hasText: L.preview }).first().click();
      const sheet = page.locator('#print-template-preview').locator('xpath=ancestor::*[@data-doc-sheet][1]');
      await expect(sheet).toHaveCount(1);
      const sheetMm = await sheet.evaluate((el) => (el.getBoundingClientRect().width * 25.4) / 96);
      // على الجوال تُصغَّر المعاينة؛ نقيس عرض التخطيط الأصلي
      const layoutMm = await sheet.evaluate((el) => ((el as HTMLElement).offsetWidth * 25.4) / 96);
      expect(Math.abs(layoutMm - 210)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
      if (!mobile) expect(Math.abs(sheetMm - 210)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
      await page.screenshot({ path: path.join(evidenceDir, `studio-preview-${locale}-${mobile ? 'iphone' : 'desktop'}.png`), fullPage: false });

      // العودة إلى «افتراضي القالب» تُزيل الورقة (السلوك السابق)
      await page.getByRole('tab').filter({ hasText: L.properties }).first().click();
      await page.getByTestId('page-setup-paper').selectOption('default');
      await page.getByRole('tab').filter({ hasText: L.preview }).first().click();
      await expect(page.locator('#print-template-preview').locator('xpath=ancestor::*[@data-doc-sheet][1]')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}

test('المحرر: القالب الحراري/أنواع غير مربوطة تُعلَن بلا عناصر تحكم قابلة للتعديل', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'يُدار داخل الاختبار');
  test.setTimeout(120_000);
  const { context, page } = await openStudio(browser, 'ar', false);
  try {
    await page.locator('#template-style').selectOption('tax-invoice-thermal80');
    await expect(page.getByTestId('page-setup')).toContainText('80');
    await expect(page.getByTestId('page-setup-paper')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

// ───────────────────────── 9) WebKit (إن توفّر) ─────────────────────────
test('WebKit (إن وُجد): هندسة المعاينة لـA5 — بلا page.pdf', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'يُدار داخل الاختبار');
  const executable = (() => { try { return webkit.executablePath(); } catch { return ''; } })();
  test.skip(!executable || !existsSync(executable), 'WebKit غير مثبّت في هذه البيئة — المحاكاة بـChromium ليست Safari');
  const browser = await webkit.launch();
  try {
    const { context, page } = await openQa(browser, { template: 'tax-invoice-classic-v2', type: 'tax_invoice', paper: A5 });
    const g = await geometry(page);
    expect(g.applied).toBe(true);
    expect(g.overlaps).toBe(0);
    await context.close();
  } finally {
    await browser.close();
  }
});
