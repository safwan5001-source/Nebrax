import { devices, expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectPdf } from '../src/lib/__tests__/helpers/pdf-inspect';
import { makeDocumentQaModel } from '../src/modules/documents/qa/document-qa-fixtures';

/**
 * AWJ-DOC-V2-PR5 — السند المدمج `voucher-compact` (قبض/صرف) في Chromium حقيقي (حاضنة `/document-qa`).
 *
 * المنهج نفسه في PR3-B/PR4: معاينة + طباعة `@page` + PDF فعلي + حدود الحبر + سلامة المبالغ، بمبالغ كبيرة (≈ 24.7 مليون ريال
 * لكل تخصيص). المقاسات المعلنة: A4 وA4 أفقي وA5 بالاتجاهين وA6 أفقي. A6 عمودي وLetter/Legal غير معلنة فتُختبر كرفض.
 *
 * حدود صريحة: لا طابعة حقيقية (محاكاة `page.pdf`)، iPhone = محاكاة Chromium لا Safari، ولا Web CI لـPlaywright.
 * التشغيل: `npx playwright test e2e/voucher-compact-pr5-harness.spec.ts --project=desktop`.
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const evidenceDir = path.resolve(process.cwd(), 'test-results/voucher-compact-pr5');
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



const TEMPLATE = 'voucher-compact';
const TYPES = ['receipt_voucher', 'payment_voucher'] as const;
type Kind = (typeof TYPES)[number];

const amountsOf = (kind: Kind, scenario: Scenario, direction: Direction): number[] => {
  const model = makeDocumentQaModel({ documentType: kind, scenario, direction, showQr: false, showAssets: true });
  return [...model.voucher!.allocations!.map((row) => row.amount), model.voucher!.amount];
};

/** نص صفحات PDF (pdftotext) — لسلامة المحتوى عبر الصفحات المتعددة. */
function pdfPagesText(buffer: Buffer): string[] {
  const dir = path.join(tmpdir(), `vc-txt-${process.pid}-${Math.random().toString(36).slice(2)}`);
  execFileSync('mkdir', ['-p', dir]);
  try {
    const file = path.join(dir, 'in.pdf');
    execFileSync('sh', ['-c', 'cat > "$0"', file], { input: buffer });
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }).split('\f').filter((page) => page.trim() !== '');
  } finally {
    execFileSync('rm', ['-rf', dir]);
  }
}

// ───────────────────────── 1) بلا ملف = A4 كما كان ─────────────────────────
for (const kind of TYPES) {
  test(`بلا ملف إخراج · ${kind}: A4 كما كان (لا ورقة معاينة، @page القديم)`, async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
    test.setTimeout(120_000);
    const { context, page } = await openQa(browser, { template: TEMPLATE, type: kind });
    try {
      const g = await geometry(page);
      expect(g.applied).toBe(false);
      expect(g.hasSheet).toBe(false);
      expect(Math.abs(g.rootWmm - 210)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
      const print = await printPdf(page);
      expect(print.style).toBe('@media print { @page { size: 210mm 297mm; } }');
      expect(Math.abs(pageSizeMm(print.info).h - 297)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
    } finally {
      await context.close();
    }
  });
}

// ───────────────────────── 2) المقاسات المعلنة: صفحة واحدة لما يتسع ─────────────────────────
/** (مقاس × سيناريو) الذي يجب أن يتسع في صفحة واحدة بلا قصّ — من قياسات Chromium الفعلية. */
const FITS: Array<{ paper: Paper; scenario: Scenario }> = [
  { paper: A5L, scenario: 'single' }, { paper: A5L, scenario: 'three' },
  { paper: A5, scenario: 'single' }, { paper: A5, scenario: 'three' },
  { paper: A6L, scenario: 'single' },
  { paper: A4, scenario: 'three' }, { paper: A4L, scenario: 'three' },
];
for (const kind of TYPES) {
  for (const { paper, scenario } of FITS) {
    for (const direction of ['rtl', 'ltr'] as const) {
      test(`يتسع · ${kind} · ${paper.key} · ${scenario} · ${direction}: صفحة واحدة بالمقاس والهوامش وكل المبالغ`, async ({ browser }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
        test.setTimeout(180_000);
        const { g, print, exported } = await verifyProfile(browser, { template: TEMPLATE, type: kind, paper, scenario, direction, strictWords: true }, `fits-${kind}-${paper.key}-${scenario}-${direction}`);
        const text = squash(g.text);
        for (const amount of amountsOf(kind, scenario, direction)) expect(text, `مبلغ مفقود ${money(amount)}`).toContain(squash(money(amount)));
        expect(print.info.pageCount, 'صفحات الطباعة').toBe(1);
        expect(exported.info.pageCount, 'صفحات PDF').toBe(1);
        // لا QR في السند.
        expect(g.text).not.toMatch(/ZATCA|QR/i);
      });
    }
  }
}

// ───────────────────────── 3) المحتوى الأكبر ينساب على صفحات بلا قصّ ولا فقد ─────────────────────────
for (const kind of TYPES) {
  for (const paper of [A5L, A5, A6L]) {
    test(`ينساب · ${kind} · ${paper.key} · twenty: صفحات متعددة، كل التخصيصات، والتوقيع لا يتكرر ولا ينقسم`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
      test.setTimeout(300_000);
      const { g, print } = await verifyProfile(browser, { template: TEMPLATE, type: kind, paper, scenario: 'twenty' }, `flow-${kind}-${paper.key}`);
      const text = squash(g.text);
      for (const amount of amountsOf(kind, 'twenty', 'rtl')) expect(text).toContain(squash(money(amount)));
      expect(print.info.pageCount, 'يجب أن ينساب على أكثر من صفحة').toBeGreaterThan(1);
      const pages = pdfPagesText(print.buffer);
      // كل تخصيص مطبوع (أرقام الفواتير 0001..0020) مرة واحدة على الأقل، بلا فقد.
      // pdftotext يبدّل موضع الشدّة (المسلّم ↔ المسّلم): تُحذف علامات التشكيل قبل العدّ.
      const strip = (value: string) => value.replace(/[\u064B-\u0652]/g, '');
      const all = strip(pages.join('\n'));
      for (let i = 1; i <= 20; i += 1) expect(all, `تخصيص ${i} مفقود من الطباعة`).toContain(`INV-QA-${String(i).padStart(4, '0')}`);
      // خطّا التوقيع (المسلّم/المستلم) يظهران مرة واحدة بالضبط: كتلة التوقيع لا تنقسم ولا تتكرر.
      expect(all.match(/توقيع المسلم/g)?.length ?? 0, 'توقيع المسلّم').toBe(1);
      expect(all.match(/توقيع المستلم/g)?.length ?? 0, 'توقيع المستلم').toBe(1);
      // وتقع على الصفحة الأخيرة (لا تُترك يتيمة في أولى).
      expect(strip(pages[pages.length - 1])).toContain('توقيع المستلم');
    });
  }
}

// ───────────────────────── 4) غير المعلن يُرفض (السلوك السابق: A4) ─────────────────────────
for (const paper of [{ key: 'a6-portrait', paper: 'a6', orientation: 'portrait' as Orientation }, { key: 'letter', paper: 'letter', orientation: 'portrait' as Orientation }]) {
  test(`غير معلن · ${paper.key}: لا يُطبَّق (يبقى A4) ولا ورقة معاينة`, async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
    test.setTimeout(120_000);
    const { context, page } = await openQa(browser, { template: TEMPLATE, type: 'receipt_voucher', paper });
    try {
      const g = await geometry(page);
      expect(g.applied).toBe(false);
      expect(g.hasSheet).toBe(false);
      expect(Math.abs(g.rootWmm - 210)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
    } finally {
      await context.close();
    }
  });
}

// ───────────────────────── 5) الجوال: معاينة A5/A6 بلا تمرير أفقي للصفحة ─────────────────────────
for (const paper of [A5L, A6L]) {
  test(`جوال · ${paper.key}: المعاينة مصغَّرة بلا تمرير أفقي ولا قصّ`, async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
    test.setTimeout(120_000);
    const { context, page } = await openQa(browser, { template: TEMPLATE, type: 'receipt_voucher', scenario: 'three', paper }, true);
    try {
      const g = await geometry(page);
      expect(g.applied).toBe(true);
      expect(g.pageScrollOverflow, 'تمرير أفقي للصفحة').toBeLessThanOrEqual(1);
      expect(g.outside).toBe(0);
    } finally {
      await context.close();
    }
  });
}
