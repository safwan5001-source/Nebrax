import { devices, expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inkRatioInRegion, inspectPdf, stitchImages, type InspectedPdf } from '../src/lib/__tests__/helpers/pdf-inspect';
import { makeDocumentQaModel } from '../src/modules/documents/qa/document-qa-fixtures';

/**
 * AWJ-DOC-V2-PR1 — موثوقية تصدير PDF في متصفح حقيقي (Chromium).
 *
 * يصدّر PDF عبر زر `documentExporter` الفعلي في صفحة `/document-qa` (بيانات اصطناعية، بلا Backend)
 * على سطح مكتب وعلى «iPhone 13» **محاكى داخل Chromium** (viewport/DPR/touch فقط) — **ليس Safari**:
 * محرك WebKit وحدود ذاكرة canvas في iOS خارج هذا الاختبار.
 *
 * يفحص الملف المكتوب فعلاً: الحجم، عدد الصفحات ومقاسها، تغطية المحتوى، وجود التذييل/التوقيع/QR/
 * الشعار/الإجماليات داخل بكسلات الصفحات، وثبات عدد الصفحات بين الجهازين.
 * لا يشغَّل في Web CI (لا Playwright هناك)؛ يُشغَّل يدوياً: `npx playwright test e2e/pdf-export-reliability.spec.ts`.
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const evidenceDir = path.resolve(process.cwd(), 'test-results/pdf-reliability');

/** ميزانية الحجم لكل صفحة (بايت). خط الأساس قبل الإصلاح: 5.6–6.7 MB للصفحة (غير مضغوط). */
const MAX_BYTES_PER_PAGE = 1_200_000;
const A4_PT = { width: 595.28, height: 841.89 };
/** أقل ارتفاع مقبول لصفحة أخيرة غير يتيمة، نسبة من ارتفاع الصفحة. */
const MIN_LAST_PAGE_RATIO = 0.08;

type Fixture = {
  name: string;
  type: 'tax_invoice' | 'simplified_tax_invoice' | 'quotation' | 'purchase_order' | 'delivery_note';
  template: string;
  scenario: 'single' | 'three' | 'five' | 'twenty' | 'multipage' | 'long_content';
  direction: 'rtl' | 'ltr';
};

const fixtures: Fixture[] = [
  { name: 'tax-erp-v2-single-rtl', type: 'tax_invoice', template: 'tax-invoice-erp-v2', scenario: 'single', direction: 'rtl' },
  { name: 'tax-erp-v2-multipage-rtl', type: 'tax_invoice', template: 'tax-invoice-erp-v2', scenario: 'multipage', direction: 'rtl' },
  { name: 'tax-classic-v2-twenty-ltr', type: 'tax_invoice', template: 'tax-invoice-classic-v2', scenario: 'twenty', direction: 'ltr' },
  { name: 'tax-modern-v2-long-rtl', type: 'tax_invoice', template: 'tax-invoice-modern-v2', scenario: 'long_content', direction: 'rtl' },
  { name: 'simplified-retail-v2-three-rtl', type: 'simplified_tax_invoice', template: 'tax-invoice-retail-v2', scenario: 'three', direction: 'rtl' },
  { name: 'quotation-five-rtl', type: 'quotation', template: 'quotation-proposal', scenario: 'five', direction: 'rtl' },
  { name: 'purchase-order-twenty-ltr', type: 'purchase_order', template: 'purchase-order-formal', scenario: 'twenty', direction: 'ltr' },
];

type Landmark = { name: string; x: number; y: number; w: number; h: number; minInk: number };
type Capture = {
  pdf: InspectedPdf;
  rootWidth: number;
  scrollHeight: number;
  landmarks: Landmark[];
  totalsText: string;
  qrCount: number;
  htmlBefore: number;
  htmlAfter: number;
};

function qaUrl(f: Fixture) {
  return `${baseUrl}/document-qa?${new URLSearchParams({ type: f.type, template: f.template, scenario: f.scenario, direction: f.direction, qr: 'on', logo: 'on', assets: 'on' })}`;
}

async function openContext(browser: Browser, mobile: boolean, f: Fixture): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(
    mobile
      ? { ...devices['iPhone 13'], acceptDownloads: true }
      : { viewport: { width: 1280, height: 1000 }, acceptDownloads: true },
  );
  await context.addCookies([{ name: 'locale', value: f.direction === 'ltr' ? 'en' : 'ar', url: baseUrl }]);
  const page = await context.newPage();
  await page.goto(qaUrl(f), { waitUntil: 'networkidle', timeout: 120_000 });
  await expect(page.locator('#qa-print-root')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return { context, page };
}

/** مواضع معالم المستند (إحداثيات CSS نسبية للجذر، مُطبَّعة من أي تصغير) + نص الإجماليات. */
async function measureLandmarks(page: Page) {
  return page.evaluate(() => {
    const root = document.getElementById('qa-print-root') as HTMLElement;
    // المُصدِّر يلتقط والجذر بلا min-height (فيصعد التذييل المثبَّت للأسفل): نقيس بالحالة نفسها ثم نعيدها.
    const savedStyle = root.getAttribute('style');
    root.style.minHeight = 'auto';
    const rootRect = root.getBoundingClientRect();
    const k = rootRect.width / root.offsetWidth; // معامل DocumentScaler على الجوال
    const rel = (element: Element) => {
      const r = element.getBoundingClientRect();
      return { x: (r.left - rootRect.left) / k, y: (r.top - rootRect.top) / k, w: r.width / k, h: r.height / k };
    };
    const out: Array<{ name: string; x: number; y: number; w: number; h: number; minInk: number }> = [];
    const header = root.querySelector('header');
    if (header) out.push({ name: 'header', ...rel(header), minInk: 0.01 });
    const logo = root.querySelector('img');
    if (logo) out.push({ name: 'logo', ...rel(logo), minInk: 0.02 });
    const summary = root.querySelector('[data-doc-keep="summary"]');
    if (summary) out.push({ name: 'summary', ...rel(summary), minInk: 0.01 });
    const lastRow = [...root.querySelectorAll('tbody tr')].at(-1);
    if (lastRow) out.push({ name: 'last-row', ...rel(lastRow), minInk: 0.01 });
    const signature = [...root.querySelectorAll('img')].find((img) => /توقيع|signature/i.test(img.alt));
    if (signature) out.push({ name: 'signature', ...rel(signature), minInk: 0.01 });
    const qr = root.querySelector('svg');
    if (qr) out.push({ name: 'qr', ...rel(qr), minInk: 0.25 });
    const footer = root.querySelector('footer');
    if (footer) out.push({ name: 'footer', ...rel(footer), minInk: 0.005 });
    const measured = {
      landmarks: out,
      scrollHeight: root.scrollHeight,
      rootWidth: root.offsetWidth,
      totalsText: (summary as HTMLElement | null)?.innerText ?? '',
      qrCount: root.querySelectorAll('svg').length,
    };
    if (savedStyle === null) root.removeAttribute('style');
    else root.setAttribute('style', savedStyle);
    return { ...measured, htmlHash: root.outerHTML.length };
  });
}

async function exportPdf(page: Page): Promise<Capture> {
  const before = await measureLandmarks(page);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120_000 }),
    page.getByTestId('qa-download-pdf').click(),
  ]);
  const file = await download.path();
  const { readFile } = await import('node:fs/promises');
  const pdf = inspectPdf(await readFile(file));
  const after = await measureLandmarks(page);
  return {
    pdf,
    rootWidth: before.rootWidth,
    scrollHeight: before.scrollHeight,
    landmarks: before.landmarks,
    totalsText: before.totalsText,
    qrCount: before.qrCount,
    htmlBefore: before.htmlHash,
    htmlAfter: after.htmlHash,
  };
}

function expectedTotal(f: Fixture): string {
  const model = makeDocumentQaModel({ documentType: f.type, scenario: f.scenario, direction: f.direction, showQr: true, showAssets: true });
  return (model.totals.total / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

test.describe.configure({ mode: 'serial' });

for (const fixture of fixtures) {
  test(`PDF موثوق: ${fixture.name} (سطح مكتب + iPhone 13 محاكى)`, async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'المحاكاة المحمولة تُدار داخل الاختبار نفسه');
    test.setTimeout(240_000);
    await mkdir(evidenceDir, { recursive: true });

    const results: Record<'desktop' | 'iphone13', Capture> = {} as never;
    for (const [label, mobile] of [['desktop', false], ['iphone13', true]] as const) {
      const { context, page } = await openContext(browser, mobile, fixture);
      results[label] = await exportPdf(page);
      await context.close();
    }

    const summary: Record<string, unknown> = {};
    for (const [label, capture] of Object.entries(results)) {
      const { pdf } = capture;

      // 1) المقاس: A4 لكل صفحة (لا تغيير للمقاسات)
      expect(pdf.mediaBoxes).toHaveLength(pdf.pageCount);
      for (const box of pdf.mediaBoxes) {
        expect(box.widthPt).toBeCloseTo(A4_PT.width, 1);
        expect(box.heightPt).toBeCloseTo(A4_PT.height, 1);
      }

      // 2) الحجم: ضمن الميزانية، والصور مضغوطة
      expect(pdf.hasUncompressedImages).toBe(false);
      expect(pdf.bytes / pdf.pageCount).toBeLessThan(MAX_BYTES_PER_PAGE);

      // 3) التغطية: الصور المتجاورة تغطي كامل المحتوى بلا فقد (الفراغ الأبيض الختامي وحده يُقصّ)
      expect(pdf.images).toHaveLength(pdf.pageCount);
      const stitched = stitchImages(pdf.images);
      const factor = stitched.width / capture.rootWidth;
      const lastBottom = Math.max(...capture.landmarks.map((l) => l.y + l.h));
      expect(stitched.height).toBeGreaterThanOrEqual(Math.floor(lastBottom * factor) - 2);

      // 4) لا صفحة يتيمة: كل صفحة بحبر، والأخيرة بارتفاع ذي معنى حين تتعدد الصفحات
      const pagePx = Math.round((A4_PT.height / A4_PT.width) * stitched.width);
      for (const image of pdf.images) {
        expect(inkRatioInRegion(image, 0, 0, image.width, image.height)).toBeGreaterThan(0.002);
      }
      if (pdf.pageCount > 1) {
        expect(pdf.images.at(-1)!.height).toBeGreaterThanOrEqual(pagePx * MIN_LAST_PAGE_RATIO);
      }

      // 5) المعالم المالية والبصرية موجودة في بكسلات PDF (إجماليات، شعار، توقيع، QR، تذييل، آخر صف)
      const names = capture.landmarks.map((l) => l.name);
      for (const required of ['header', 'summary', 'footer']) expect(names).toContain(required);
      const missing: string[] = [];
      for (const landmark of capture.landmarks) {
        const ink = inkRatioInRegion(stitched, landmark.x * factor, landmark.y * factor, landmark.w * factor, landmark.h * factor);
        if (ink < landmark.minInk) missing.push(`${landmark.name}:${ink.toFixed(3)}`);
      }
      expect(missing, `معالم غائبة أو باهتة في PDF (${label})`).toEqual([]);

      // 6) الإجماليات في DOM المصدَّر = إجمالي النموذج؛ QR ما زال موجوداً للفاتورة الضريبية
      expect(capture.totalsText.replace(/[\s,٬،]/g, '')).toContain(expectedTotal(fixture).replace(/,/g, ''));
      if (fixture.type === 'tax_invoice' || fixture.type === 'simplified_tax_invoice') expect(capture.qrCount).toBeGreaterThan(0);

      // 7) التصدير لا يترك أثراً على المستند الحيّ (استعادة الأنماط بعد التحييد)
      expect(capture.htmlAfter).toBe(capture.htmlBefore);

      summary[label] = { pages: pdf.pageCount, bytes: pdf.bytes, bytesPerPage: Math.round(pdf.bytes / pdf.pageCount), lastPageHeightPx: pdf.images.at(-1)!.height, imageWidthPx: stitched.width, hasTextLayer: pdf.hasTextLayer };
    }

    // 8) ثبات عدد الصفحات وارتفاع المحتوى بين سطح المكتب والجوال المحاكى
    expect(results.iphone13.pdf.pageCount).toBe(results.desktop.pdf.pageCount);
    const dH = results.desktop.pdf.images.reduce((s, i) => s + i.height, 0);
    const mH = results.iphone13.pdf.images.reduce((s, i) => s + i.height, 0);
    expect(Math.abs(dH - mH)).toBeLessThanOrEqual(8);

    await writeFile(path.join(evidenceDir, `${fixture.name}.json`), JSON.stringify({ fixture, summary }, null, 2));
  });
}

test('فجوة معلنة: PDF الصورة بلا طبقة نص (الضغط لا يعالجها)', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
  test.setTimeout(120_000);
  const fixture = fixtures[0];
  const { context, page } = await openContext(browser, false, fixture);
  const capture = await exportPdf(page);
  await context.close();
  expect(capture.pdf.hasTextLayer).toBe(false);
});
