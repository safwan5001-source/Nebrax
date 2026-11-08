import { devices, expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectPdf } from '../src/lib/__tests__/helpers/pdf-inspect';
import { makeDocumentQaModel } from '../src/modules/documents/qa/document-qa-fixtures';

/**
 * AWJ-DOC-V2-PR4 — Output Profile لفواتير المشتريات وسندات القبض/الصرف في Chromium حقيقي (حاضنة `/document-qa`).
 *
 * يعيد استعمال طريقة PR3-B نفسها (معاينة + طباعة `@page` + PDF فعلي + حدود الحبر) على الأنواع الثلاثة:
 * `purchase_invoice` و`receipt_voucher` و`payment_voucher`، بمبالغ كبيرة (≈ 24.7 مليون ريال لكل تخصيص) وحتى 40 تخصيصاً.
 * إعلان الدعم لم يُوسَّع: يُثبَت هنا أن الأزواج المعلنة (قالب × مقاس) تصمد لهذه الأنواع.
 *
 * حدود صريحة: لا طابعة حقيقية (محاكاة `page.pdf`)، iPhone = محاكاة Chromium لا Safari، ولا Web CI لـPlaywright.
 * التشغيل: `npx playwright test e2e/output-profile-pr4-harness.spec.ts --project=desktop`.
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const evidenceDir = path.resolve(process.cwd(), 'test-results/output-profile-pr4');
const PT_PER_MM = 72 / 25.4;
const SIZE_TOLERANCE_MM = 0.8;
const INK_TOLERANCE_MM = 1.6;

type Direction = 'rtl' | 'ltr';
type Scenario = 'single' | 'three' | 'five' | 'twenty' | 'multipage' | 'long_content';
type Orientation = 'portrait' | 'landscape';

interface Paper { key: string; paper: string; orientation: Orientation; widthMm: number; heightMm: number; margin: number }
const A4: Paper = { key: 'a4', paper: 'a4', orientation: 'portrait', widthMm: 210, heightMm: 297, margin: 14 };
const A4L: Paper = { key: 'a4-landscape', paper: 'a4', orientation: 'landscape', widthMm: 297, heightMm: 210, margin: 14 };
const A5L: Paper = { key: 'a5-landscape', paper: 'a5', orientation: 'landscape', widthMm: 210, heightMm: 148, margin: 10 };
const A5: Paper = { key: 'a5', paper: 'a5', orientation: 'portrait', widthMm: 148, heightMm: 210, margin: 10 };
const A6L: Paper = { key: 'a6-landscape', paper: 'a6', orientation: 'landscape', widthMm: 148, heightMm: 105, margin: 8 };
const LETTER: Paper = { key: 'letter', paper: 'letter', orientation: 'portrait', widthMm: 216, heightMm: 279, margin: 14 };
const LEGAL: Paper = { key: 'legal', paper: 'legal', orientation: 'portrait', widthMm: 216, heightMm: 356, margin: 14 };

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


// ───────────────────────── الأنواع والقوالب ─────────────────────────
const TYPES = ['purchase_invoice', 'receipt_voucher', 'payment_voucher'] as const;
type Kind = (typeof TYPES)[number];
const TPL_IDS = [
  'tax-invoice-classic', 'tax-invoice-classic-v2', 'tax-invoice-modern', 'tax-invoice-modern-v2', 'tax-invoice-erp',
  'tax-invoice-erp-v2', 'tax-invoice-minimal', 'tax-invoice-minimal-v2', 'tax-invoice-retail', 'tax-invoice-retail-v2',
] as const;

/** الأزواج الضيّقة المعلنة في السجل (دليل PR3-B) — لم تُوسَّع في PR4. */
const NARROW: Array<{ template: string; paper: Paper }> = [
  { template: 'tax-invoice-classic-v2', paper: A5 },
  { template: 'tax-invoice-classic-v2', paper: A6L },
  { template: 'tax-invoice-erp-v2', paper: A6L },
  { template: 'tax-invoice-minimal', paper: A6L },
  { template: 'tax-invoice-minimal-v2', paper: A6L },
];

/** كل مبلغ يجب أن يظهر في المعاينة بلا فقد (إجماليات البنود/التخصيصات والإجمالي). */
function amountsOf(kind: Kind, scenario: Scenario, direction: Direction): number[] {
  const model = makeDocumentQaModel({ documentType: kind, scenario, direction, showQr: false, showAssets: true });
  if (model.voucher) return [...model.voucher.allocations.map((row) => row.amount), model.voucher.amount];
  return [...model.lines.map((line) => line.total), model.totals.total];
}

// ───────────────────────── 1) بلا ملف = السلوك السابق حرفياً ─────────────────────────
for (const kind of TYPES) {
  for (const template of ['tax-invoice-classic', 'tax-invoice-modern-v2']) {
    test(`بلا ملف إخراج · ${kind} · ${template}: A4 كما كان`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
      test.setTimeout(120_000);
      const { context, page } = await openQa(browser, { template, type: kind });
      try {
        const g = await geometry(page);
        expect(g.applied).toBe(false);
        expect(g.hasSheet, 'لا ورقة معاينة بلا ملف').toBe(false);
        expect(Math.abs(g.rootWmm - 210)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
        const print = await printPdf(page);
        expect(print.style).toBe('@media print { @page { size: 210mm 297mm; } }');
        const exported = await exportPdf(page);
        expect(Math.abs(pageSizeMm(exported.info).w - 210)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
        expect(Math.abs(pageSizeMm(exported.info).h - 297)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
      } finally {
        await context.close();
      }
    });
  }
}

// ───────────────────────── 2) صفحات بعرض محتوى ≥ 182mm: كل القوالب × الأنواع الثلاثة ─────────────────────────
for (const kind of TYPES) {
  for (const template of TPL_IDS) {
    // retail/retail-v2 لا يعلنان Legal ⇒ يُختبر في قسم الاحتياط.
    const papers = template.startsWith('tax-invoice-retail') ? [A4, A4L, A5L, LETTER] : [A4, A4L, A5L, LETTER, LEGAL];
    for (const paper of papers) {
      test(`${kind} · ${template} · ${paper.key}: معاينة + طباعة + PDF بالمقاس والهوامش`, async ({ browser }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
        test.setTimeout(180_000);
        const { g } = await verifyProfile(browser, { template, type: kind, paper, scenario: 'five' }, `${kind}-${template}-${paper.key}`);
        const text = squash(g.text);
        for (const amount of amountsOf(kind, 'five', 'rtl')) expect(text, `مبلغ مفقود ${money(amount)}`).toContain(squash(money(amount)));
      });
    }
  }
}

// ───────────────────────── 3) الإطار الضيّق: الأزواج المعلنة × الأنواع × الاتجاهان ─────────────────────────
for (const kind of TYPES) {
  for (const { template, paper } of NARROW) {
    for (const direction of ['rtl', 'ltr'] as const) {
      test(`ضيّق · ${kind} · ${template} · ${paper.key} · ${direction}: بلا تداخل ولا فقد مبالغ`, async ({ browser }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
        test.setTimeout(180_000);
        const { g } = await verifyProfile(browser, { template, type: kind, paper, direction, scenario: 'five', strictWords: true }, `narrow-${kind}-${template}-${paper.key}-${direction}`);
        expect(g.narrow, 'إطار ضيّق').toBe(true);
        const text = squash(g.text);
        for (const amount of amountsOf(kind, 'five', direction)) expect(text, `مبلغ مفقود ${money(amount)}`).toContain(squash(money(amount)));
      });
    }
  }
}

// ───────────────────────── 4) مستند طويل (40 سطراً/تخصيصاً): صفحات متعددة بلا فقد ─────────────────────────
for (const kind of TYPES) {
  for (const paper of [A4, A5L, A5, A6L]) {
    test(`طويل · ${kind} · classic-v2 · ${paper.key}: يُقسَّم على صفحات وكل المبالغ في الطباعة`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
      test.setTimeout(300_000);
      const { g, print, exported } = await verifyProfile(browser, { template: 'tax-invoice-classic-v2', type: kind, paper, scenario: 'multipage' }, `multipage-${kind}-${paper.key}`);
      expect(print.info.pageCount, 'الطباعة').toBeGreaterThanOrEqual(2);
      expect(exported.info.pageCount, 'PDF').toBeGreaterThanOrEqual(2);
      const text = squash(g.text);
      const amounts = amountsOf(kind, 'multipage', 'rtl');
      for (const amount of amounts) expect(text, 'مبلغ مفقود من المعاينة').toContain(squash(money(amount)));
      const dir = path.join(tmpdir(), `op4-text-${process.pid}-${Date.now()}`);
      await mkdir(dir, { recursive: true });
      try {
        const file = path.join(dir, 'p.pdf');
        await writeFile(file, print.buffer);
        // لا فقد محتوى: كل بند/تخصيص والإجمالي موجود في نص PDF المطبوع عبر كل الصفحات. موضع الإجمالي يتبع تصميم النوع
        // (السند: في كتلة السند أعلى المستند؛ المشتريات: بعد الجدول وقبل الشروط/الملاحظات الطويلة) فلا يُشترط في الصفحة الأخيرة.
        const whole = squash(execFileSync('pdftotext', [file, '-']).toString());
        for (const amount of amounts) expect(whole, `مبلغ مفقود من الطباعة ${money(amount)}`).toContain(squash(money(amount)));
        const last = execFileSync('pdftotext', ['-f', String(print.info.pageCount), '-l', String(print.info.pageCount), file, '-']).toString();
        expect(last.trim().length, 'صفحة أخيرة فارغة').toBeGreaterThan(20);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
}

// ───────────────────────── 5) غير المدعوم يرجع للسلوك السابق ─────────────────────────
for (const kind of TYPES) {
  for (const [template, paper] of [
    ['tax-invoice-classic', { paper: 'a6', orientation: 'portrait' as const }],
    ['tax-invoice-classic', { paper: 'a5', orientation: 'portrait' as const }],
    ['tax-invoice-retail', { paper: 'legal', orientation: 'portrait' as const }],
    ['tax-invoice-erp-v2', { paper: 'a6', orientation: 'portrait' as const }],
  ] as const) {
    test(`غير مدعوم · ${kind} · ${template} · ${paper.paper}-${paper.orientation}: يُعامل كغائب (A4)`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
      test.setTimeout(120_000);
      const { context, page } = await openQa(browser, { template, type: kind, paper });
      try {
        const g = await geometry(page);
        expect(g.applied).toBe(false);
        expect(g.hasSheet).toBe(false);
        expect(Math.abs(g.rootWmm - 210)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
        expect((await printPdf(page)).style).toBe('@media print { @page { size: 210mm 297mm; } }');
      } finally {
        await context.close();
      }
    });
  }
}
