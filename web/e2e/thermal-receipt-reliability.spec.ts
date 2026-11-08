import { devices, expect, test, webkit, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inkRatioInRegion, inspectPdf, stitchImages } from '../src/lib/__tests__/helpers/pdf-inspect';
import { makeDocumentQaModel } from '../src/modules/documents/qa/document-qa-fixtures';

/**
 * AWJ-DOC-V2-PR2 — موثوقية إخراج الإيصال الحراري (58/80mm) في Chromium حقيقي.
 *
 * يستعمل `/document-qa` (بيانات اصطناعية، بلا Backend) بالقوالب الحرارية الحقيقية، ويفحص ثلاثة مسارات للمستند
 * نفسه: المعاينة، الطباعة (`printDocument` ← `@page` ← `page.pdf` بوسائط print)، وتنزيل PDF (`documentExporter`).
 *
 * حدود صريحة:
 *  • **لا طابعة حرارية حقيقية** هنا: الطباعة تُحاكى بـ `page.pdf()` في Chromium (يلتزم بـ `@page` كما يفعل حوار
 *    الطباعة)، ولا يثبت ذلك سلوك سائق/ورق/قاطع طابعة فعلية. الاختبار المادي: غير منفَّذ.
 *  • iPhone = محاكاة Chromium (viewport/DPR/touch)، **ليست Safari**. WebKit إن وُجد يُفحص هندسة المعاينة فقط
 *    (`page.pdf` غير متاح في WebKit).
 * لا يعمل في Web CI (لا Playwright هناك): `npx playwright test e2e/thermal-receipt-reliability.spec.ts --project=desktop`.
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const evidenceDir = path.resolve(process.cwd(), 'test-results/thermal-reliability');
const PT_PER_MM = 72 / 25.4;
const WIDTH_TOLERANCE_MM = 0.7;

type Scenario = 'single' | 'five' | 'twenty' | 'long_content';
type Direction = 'rtl' | 'ltr';
type Mm = 58 | 80;

const widths: Mm[] = [58, 80];
const scenarios: Scenario[] = ['single', 'five', 'twenty', 'long_content'];
const directions: Direction[] = ['rtl', 'ltr'];

function qaUrl(width: Mm | null, scenario: Scenario, direction: Direction) {
  const query = new URLSearchParams({
    type: 'simplified_tax_invoice',
    template: width ? `tax-invoice-thermal${width}` : 'tax-invoice-erp-v2',
    scenario,
    direction,
    qr: 'on',
    logo: 'on',
    assets: 'on',
  });
  return `${baseUrl}/document-qa?${query}`;
}

async function openQa(browser: Browser, width: Mm | null, scenario: Scenario, direction: Direction, mobile = false) {
  const context: BrowserContext = await browser.newContext(
    mobile ? { ...devices['iPhone 13'], acceptDownloads: true } : { viewport: { width: 1280, height: 1000 }, acceptDownloads: true },
  );
  await context.addCookies([{ name: 'locale', value: direction === 'ltr' ? 'en' : 'ar', url: baseUrl }]);
  const page = await context.newPage();
  // window.print لا يفتح حواراً في headless؛ نسجّل ما حُقن من @page ثم نطبع بـ page.pdf بنفس الوسائط.
  await page.addInitScript(() => {
    (window as unknown as { __printStyle: string | null }).__printStyle = null;
    window.print = () => {
      (window as unknown as { __printStyle: string | null }).__printStyle = document.getElementById('nebrax-doc-print-page')?.textContent ?? null;
    };
  });
  await page.goto(qaUrl(width, scenario, direction), { waitUntil: 'networkidle', timeout: 120_000 });
  await expect(page.locator('#qa-print-root')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return { context, page };
}

/** هندسة المعاينة: عرض/ارتفاع الجذر، الخروج عن الحدود، الاقتطاع، التفاف المبالغ، موضع QR. */
async function previewGeometry(page: Page) {
  return page.evaluate(() => {
    const root = document.getElementById('qa-print-root') as HTMLElement;
    const rootRect = root.getBoundingClientRect();
    const all = [...root.querySelectorAll<HTMLElement>('*')];
    const ellipsis = all.filter((e) => getComputedStyle(e).textOverflow === 'ellipsis');
    const outside = all.filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && (r.right > rootRect.right + 1 || r.left < rootRect.left - 1);
    }).length;
    const spread = (e: Element) => {
      const tops = [...e.getClientRects()].map((r) => r.top);
      return tops.length ? Math.max(...tops) - Math.min(...tops) : 0;
    };
    const amounts = [...root.querySelectorAll<HTMLElement>('span.num[dir="ltr"]')].filter((e) => /\d/.test(e.textContent ?? ''));
    const qr = root.querySelector('svg') as SVGElement | null;
    const qrRect = qr?.getBoundingClientRect();
    const mm = (px: number) => (px * 25.4) / 96;
    return {
      widthMm: mm(rootRect.width),
      heightMm: mm(rootRect.height),
      rootPx: { width: rootRect.width, height: rootRect.height },
      ellipsisCount: ellipsis.length,
      clippedEllipsis: ellipsis.filter((e) => e.scrollWidth > e.clientWidth + 1).length,
      outsideCount: outside,
      scrollOverflow: root.scrollWidth > root.clientWidth + 1,
      amountCount: amounts.length,
      wrappedAmounts: amounts.filter((e) => spread(e) > 4).length,
      qr: qrRect ? {
        widthPx: qrRect.width,
        inside: qrRect.left >= rootRect.left - 0.5 && qrRect.right <= rootRect.right + 0.5,
        rel: { x: qrRect.left - rootRect.left, y: qrRect.top - rootRect.top, w: qrRect.width, h: qrRect.height },
      } : null,
      text: root.innerText,
    };
  });
}

function expectedStrings(width: Mm, scenario: Scenario, direction: Direction) {
  const model = makeDocumentQaModel({ documentType: 'simplified_tax_invoice', scenario, direction, showQr: true, showAssets: true });
  const money = (minor: number) => (minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return { model, money, width };
}

const squash = (value: string) => value.replace(/[\s٬،,]+/g, '');

for (const width of widths) {
  for (const scenario of scenarios) {
    for (const direction of directions) {
      test(`حراري ${width}mm · ${scenario} · ${direction}: معاينة + طباعة + PDF`, async ({ browser }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'المحاكاة المحمولة تُدار في اختبارات مستقلة');
        test.setTimeout(120_000);
        await mkdir(evidenceDir, { recursive: true });
        const { context, page } = await openQa(browser, width, scenario, direction);
        const tag = `${width}-${scenario}-${direction}`;
        try {
          // ───────────── 1) المعاينة ─────────────
          const preview = await previewGeometry(page);
          expect(Math.abs(preview.widthMm - width), `عرض الجذر ${preview.widthMm}mm`).toBeLessThanOrEqual(WIDTH_TOLERANCE_MM);
          expect(preview.outsideCount, 'عناصر خارج حدود الإيصال').toBe(0);
          expect(preview.scrollOverflow, 'تمرير أفقي داخل الإيصال').toBe(false);
          expect(preview.ellipsisCount, 'لا اقتطاع بـ ellipsis (truncate)').toBe(0);
          expect(preview.clippedEllipsis).toBe(0);
          expect(preview.wrappedAmounts, 'مبلغ انقسم على سطرين').toBe(0);
          expect(preview.qr, 'QR مفقود').not.toBeNull();
          expect(preview.qr!.inside, 'QR خارج الإيصال').toBe(true);
          expect(preview.qr!.widthPx, 'QR أصغر من الحد المقروء').toBeGreaterThanOrEqual(80);

          // اكتمال المحتوى: كل وصف بند + المبالغ كما في النموذج (لا إخفاء ولا اقتطاع)
          const { model, money } = expectedStrings(width, scenario, direction);
          const text = squash(preview.text);
          for (const line of model.lines) expect(text, `وصف مفقود: ${line.description}`).toContain(squash(line.description ?? ''));
          for (const value of [model.totals.total, model.totals.tax, model.totals.subtotal]) expect(text).toContain(squash(money(value)));
          for (const line of model.lines) expect(text).toContain(squash(money(line.total)));
          await page.locator('#qa-print-root').screenshot({ path: path.join(evidenceDir, `preview-${tag}.png`) });

          // ───────────── 2) الطباعة (@page صالح + page.pdf) ─────────────
          await page.getByTestId('qa-print').click();
          const style = await page.evaluate(() => (window as unknown as { __printStyle: string | null }).__printStyle);
          expect(style, 'لم يُحقن @page').not.toBeNull();
          const sizeMatch = /@page\s*\{\s*size:\s*([\d.]+)mm\s+([\d.]+)mm;\s*margin:\s*0;/.exec(style!);
          expect(sizeMatch, `@page غير صالح: ${style}`).not.toBeNull();
          expect(Number(sizeMatch![1])).toBe(width);
          expect(style).not.toMatch(/\bauto\b/);
          const injectedHeight = Number(sizeMatch![2]);
          // الارتفاع = ارتفاع المعاينة + تغذية ≤ 4.5mm (ceil + 2mm)
          expect(injectedHeight - preview.heightMm).toBeGreaterThanOrEqual(0);
          expect(injectedHeight - preview.heightMm).toBeLessThanOrEqual(4.5);

          await page.emulateMedia({ media: 'print' });
          const printPath = path.join(evidenceDir, `print-${tag}.pdf`);
          const printBuffer = await page.pdf({ path: printPath, preferCSSPageSize: true, printBackground: true });
          await page.emulateMedia({ media: 'screen' });
          const print = inspectPdf(printBuffer);
          expect(print.pageCount, 'الإيصال يجب أن يُطبع في صفحة رول واحدة').toBe(1);
          expect(print.mediaBoxes[0].widthPt).toBeCloseTo(width * PT_PER_MM, 0);
          expect(print.mediaBoxes[0].heightPt / PT_PER_MM).toBeCloseTo(injectedHeight, 0);
          expect(print.mediaBoxes[0].widthPt / PT_PER_MM, 'الورق ليس A4').toBeLessThan(100);

          // ───────────── 3) تنزيل PDF (documentExporter بمقاس الرول) ─────────────
          const [download] = await Promise.all([page.waitForEvent('download', { timeout: 90_000 }), page.getByTestId('qa-download-pdf').click()]);
          const exported = inspectPdf(await readFile((await download.path())!));
          expect(exported.pageCount).toBe(1);
          expect(exported.hasUncompressedImages).toBe(false);
          expect(exported.mediaBoxes[0].widthPt / PT_PER_MM).toBeCloseTo(width, 0);
          const exportHeightMm = exported.mediaBoxes[0].heightPt / PT_PER_MM;
          // ───────────── 4) مقارنة المعاينة/الطباعة/PDF ─────────────
          // تسامح: 1.2mm أو 0.6% من الارتفاع (تقريب بكسل التقاط scale:2 على إيصال طوله نصف متر)
          expect(Math.abs(exportHeightMm - preview.heightMm), 'ارتفاع PDF ≠ المعاينة').toBeLessThanOrEqual(Math.max(1.2, preview.heightMm * 0.006));
          expect(Math.abs(print.mediaBoxes[0].heightPt / PT_PER_MM - exportHeightMm)).toBeLessThanOrEqual(5);

          // QR والإجماليات داخل بكسلات PDF (التقاط صوري)
          const stitched = stitchImages(exported.images);
          const factor = stitched.width / preview.rootPx.width;
          const qr = preview.qr!.rel;
          expect(inkRatioInRegion(stitched, qr.x * factor, qr.y * factor, qr.w * factor, qr.h * factor), 'QR غير ظاهر في PDF').toBeGreaterThan(0.25);
          expect(inkRatioInRegion(stitched, 0, 0, stitched.width, stitched.height)).toBeGreaterThan(0.005);

          await writeFile(path.join(evidenceDir, `${tag}.json`), JSON.stringify({
            preview: { widthMm: preview.widthMm, heightMm: preview.heightMm, amounts: preview.amountCount },
            injectedStyle: style,
            printPdf: { pages: print.pageCount, widthMm: print.mediaBoxes[0].widthPt / PT_PER_MM, heightMm: print.mediaBoxes[0].heightPt / PT_PER_MM, bytes: print.bytes },
            exportPdf: { pages: exported.pageCount, widthMm: exported.mediaBoxes[0].widthPt / PT_PER_MM, heightMm: exportHeightMm, bytes: exported.bytes },
          }, null, 2));
        } finally {
          await context.close();
        }
      });
    }
  }
}

test('حراري على iPhone 13 (محاكاة Chromium): نفس الهندسة والطباعة؛ ليس Safari', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'المحاكاة المحمولة تُدار داخل الاختبار');
  test.setTimeout(120_000);
  for (const width of widths) {
    const { context, page } = await openQa(browser, width, 'twenty', 'rtl', true);
    try {
      const preview = await previewGeometry(page);
      expect(Math.abs(preview.widthMm - width)).toBeLessThanOrEqual(WIDTH_TOLERANCE_MM);
      expect(preview.outsideCount).toBe(0);
      expect(preview.ellipsisCount).toBe(0);
      expect(preview.wrappedAmounts).toBe(0);
      await page.getByTestId('qa-print').click();
      const style = await page.evaluate(() => (window as unknown as { __printStyle: string | null }).__printStyle);
      const m = /size:\s*([\d.]+)mm\s+([\d.]+)mm/.exec(style ?? '');
      expect(Number(m?.[1])).toBe(width);
      // القياس خارج DocumentScaler: الارتفاع لا يتأثر بتصغير الجوال
      expect(Number(m?.[2]) - preview.heightMm).toBeGreaterThanOrEqual(0);
      expect(Number(m?.[2]) - preview.heightMm).toBeLessThanOrEqual(4.5);
    } finally {
      await context.close();
    }
  }
});

test('بقية عناصر الصفحة لا تُنتج صفحات رول فارغة إضافية', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
  test.setTimeout(120_000);
  const { context, page } = await openQa(browser, 80, 'five', 'rtl');
  try {
    // يحاكي صفحة تطبيق حقيقية (ترويسة/قوائم) أطول بكثير من الإيصال، وتخفيها قواعد الطباعة بصرياً فقط
    await page.evaluate(() => {
      const chrome = document.createElement('div');
      chrome.id = 'fake-app-chrome';
      chrome.style.height = '6000px';
      chrome.textContent = 'app chrome';
      document.body.appendChild(chrome);
    });
    await page.getByTestId('qa-print').click();
    await page.emulateMedia({ media: 'print' });
    const pdf = inspectPdf(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
    expect(pdf.pageCount).toBe(1);
    expect(pdf.mediaBoxes[0].widthPt / PT_PER_MM).toBeCloseTo(80, 0);
  } finally {
    await context.close();
  }
});

test('انحدار A4: الطباعة تحقن @page القديم حرفياً وPDF بمقاس A4', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
  test.setTimeout(120_000);
  const { context, page } = await openQa(browser, null, 'single', 'rtl');
  try {
    await page.getByTestId('qa-print').click();
    const style = await page.evaluate(() => (window as unknown as { __printStyle: string | null }).__printStyle);
    expect(style).toBe('@media print { @page { size: 210mm 297mm; } }');
    await page.emulateMedia({ media: 'print' });
    const pdf = inspectPdf(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
    expect(pdf.mediaBoxes[0].widthPt).toBeCloseTo(595.28, 0);
    expect(pdf.mediaBoxes[0].heightPt).toBeCloseTo(841.89, 0);
  } finally {
    await context.close();
  }
});

test('WebKit (إن كان مثبّتاً): هندسة معاينة الحراري — ليس اختبار Safari الحقيقي', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
  let browser: Browser | null = null;
  try {
    browser = await webkit.launch();
  } catch {
    test.skip(true, 'WebKit غير مثبّت في هذه البيئة؛ الاختبار على Safari/iOS الحقيقي غير منفَّذ');
    return;
  }
  try {
    for (const width of widths) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await context.addCookies([{ name: 'locale', value: 'ar', url: baseUrl }]);
      const page = await context.newPage();
      await page.goto(qaUrl(width, 'twenty', 'rtl'), { waitUntil: 'networkidle', timeout: 120_000 });
      await expect(page.locator('#qa-print-root')).toBeVisible();
      const preview = await previewGeometry(page);
      expect(Math.abs(preview.widthMm - width)).toBeLessThanOrEqual(WIDTH_TOLERANCE_MM);
      expect(preview.outsideCount).toBe(0);
      expect(preview.ellipsisCount).toBe(0);
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
