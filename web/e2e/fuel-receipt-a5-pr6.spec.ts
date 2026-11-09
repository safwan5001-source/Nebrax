import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { inspectPdf } from '../src/lib/__tests__/helpers/pdf-inspect';
import { COSTED_ID, CREATOR, FINANCE, mockB5Api, type Locale } from './support/fuel-ops-b5-mock';

/**
 * AWJ-DOC-V2-PR6 — سند استلام الوقود A5 أفقي في Chromium حقيقي: الشاشة الفعلية `/fuel-stations/ops/receiving/{id}` بخادم مُعترَض (لا خلفية)،
 * وPDF يُرسم فعلاً في المتصفح بـjsPDF والخط العربي الحقيقي ثم يُنزَّل ويُفحص (مقاس الصفحة، عدد الصفحات، طبقة النص الحقيقية، حدود الحبر).
 *
 * حدود صريحة: لا طابعة حقيقية؛ iPhone = محاكاة Chromium لا Safari؛ ليس ضمن Web CI.
 * التشغيل (خادم تطوير على 3001): npx playwright test -c <config> e2e/fuel-receipt-a5-pr6.spec.ts --project=desktop
 * أدلة الصور: PR6_OUT=/path يحفظ PDF/PNG المنزَّلة.
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const OUT = process.env.PR6_OUT;
const PT_PER_MM = 72 / 25.4;
const RCV = '/fuel-stations/ops/receiving';
const COST_TEXT = /Total cost|Average cost|12,500\.00|إجمالي التكلفة/;
const hasPdftotext = (() => { try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const hasPoppler = (() => { try { execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();

async function openDetail(page: Page, locale: Locale, permissions: string[], canSeeCost: boolean) {
  await mockB5Api(page, { baseUrl, locale, theme: 'light', permissions, canSeeCost });
  await page.addStyleTag({ content: 'nextjs-portal, #next-logo, [data-nextjs-dev-tools-button] { display: none !important; }' }).catch(() => {});
  await page.goto(`${baseUrl}${RCV}/${COSTED_ID}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-doc-actions]').waitFor({ timeout: 60_000 });
  await page.addStyleTag({ content: 'nextjs-portal, #next-logo, [data-nextjs-dev-tools-button] { display: none !important; }' });
}

async function downloadPdf(page: Page) {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.locator('[data-doc-action="pdf-download"]').click()]);
  const path = (await download.path())!;
  const buffer = readFileSync(path);
  return { name: download.suggestedFilename(), buffer, info: inspectPdf(buffer) };
}

function pdfText(buffer: Buffer): string {
  const file = join(tmpdir(), `pr6-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`);
  writeFileSync(file, buffer);
  return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
}

const sizeMm = (info: ReturnType<typeof inspectPdf>, i = 0) => ({ w: info.mediaBoxes[i].widthPt / PT_PER_MM, h: info.mediaBoxes[i].heightPt / PT_PER_MM });

function keep(name: string, buffer: Buffer) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.pdf`), buffer);
  if (hasPoppler) execFileSync('pdftoppm', ['-png', '-r', '110', join(OUT, `${name}.pdf`), join(OUT, name)]);
}

test.describe.configure({ mode: 'serial' });

for (const locale of ['en', 'ar'] as const) {
  test.describe(`A5 landscape fuel receiving voucher · ${locale}`, () => {
    test('default stays A4 portrait; choosing A5 downloads a real 210×148 vector PDF with the receiving data', async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
      test.setTimeout(180_000);
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
      const page = await context.newPage();
      try {
        await openDetail(page, locale, CREATOR, false);
        await expect(page.locator('[data-paper="a4"]')).toHaveAttribute('aria-checked', 'true');

        const a4 = await downloadPdf(page);
        expect(a4.name).not.toMatch(/-a5-/);
        expect(a4.info.pageCount).toBe(1);
        expect(Math.abs(sizeMm(a4.info).w - 210)).toBeLessThan(0.5);
        expect(Math.abs(sizeMm(a4.info).h - 297)).toBeLessThan(0.5);
        keep(`a4-${locale}`, a4.buffer);

        await page.locator('[data-paper="a5"]').click();
        const a5 = await downloadPdf(page);
        expect(a5.name).toMatch(/-operational-a5-.*\.pdf$/);
        expect(a5.info.pageCount).toBe(1);
        expect(Math.abs(sizeMm(a5.info).w - 210)).toBeLessThan(0.5);
        expect(Math.abs(sizeMm(a5.info).h - 148)).toBeLessThan(0.5);
        expect(a5.info.hasTextLayer).toBe(true);
        expect(a5.info.images).toHaveLength(0);
        keep(`a5-${locale}`, a5.buffer);

        if (hasPdftotext) {
          // pdftotext يعيد الترتيب البصري للعربية (العلامة − تظهر بعد الرقم)؛ الإشارة تُفحص نصاً في الإنجليزية وبصرياً في الصور.
          const text = pdfText(a5.buffer);
          for (const expected of ['FD-00000000', 'DN-FX-102', 'PO-FX-1', '10,000.000', '9,950.000', locale === 'en' ? '-50.000' : '50.000', '1,200.000', '11,150.000', '2026-11-06']) expect(text, `مفقود: ${expected}`).toContain(expected);
          expect(text).not.toMatch(COST_TEXT); // النسخة التشغيلية بلا أي مبلغ
        }
        // التفضيل يبقى على الجهاز: إعادة فتح الشاشة تبدأ بـA5.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('[data-doc-actions]').waitFor({ timeout: 60_000 });
        await expect(page.locator('[data-paper="a5"]')).toHaveAttribute('aria-checked', 'true');
      } finally {
        await context.close();
      }
    });

    test('financial A5 carries the cost for the authorised user; a server 403 yields no file', async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
      test.setTimeout(180_000);
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
      const page = await context.newPage();
      try {
        await openDetail(page, locale, FINANCE, true);
        await page.locator('[data-paper="a5"]').click();
        await page.locator('[data-variant="financial"]').click();
        const pdf = await downloadPdf(page);
        expect(pdf.name).toMatch(/-financial-a5-/);
        expect(Math.abs(sizeMm(pdf.info).h - 148)).toBeLessThan(0.5);
        expect(pdf.info.pageCount, 'السند المالي المعتاد في صفحة واحدة').toBe(1);
        keep(`a5-financial-${locale}`, pdf.buffer);
        if (hasPdftotext) expect(pdfText(pdf.buffer)).toMatch(/12,500\.00/);
      } finally {
        await context.close();
      }

      // الخادم هو السلطة: واجهة تعرض الخيار لكن الخادم يردّ 403 ⇒ رسالة صريحة وبلا ملف.
      const denied = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
      const deniedPage = await denied.newPage();
      try {
        await openDetail(deniedPage, locale, FINANCE, false);
        await deniedPage.locator('[data-paper="a5"]').click();
        await deniedPage.locator('[data-variant="financial"]').click();
        let downloaded = false;
        deniedPage.on('download', () => { downloaded = true; });
        await deniedPage.locator('[data-doc-action="pdf-download"]').click();
        await expect(deniedPage.locator('[data-doc-message="error"]')).toBeVisible({ timeout: 30_000 });
        expect(downloaded).toBe(false);
      } finally {
        await denied.close();
      }
    });
  });
}

test('mobile: the paper choice is touch-sized and the page has no horizontal overflow', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
  const page = await context.newPage();
  try {
    await openDetail(page, 'ar', CREATOR, false);
    const boxes = await page.locator('[data-paper]').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; }));
    expect(boxes).toHaveLength(2);
    for (const box of boxes) { expect(box.h).toBeGreaterThanOrEqual(44); expect(box.w).toBeGreaterThanOrEqual(44); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  } finally {
    await context.close();
  }
});
