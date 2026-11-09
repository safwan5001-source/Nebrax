import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { inspectPdf } from '../src/lib/__tests__/helpers/pdf-inspect';
import { CLOSE_PERMS, EXPECTED, SALES_PERMS, mockPr7Api, type Locale } from './support/fuel-ops-pr7-mock';

/**
 * AWJ-DOC-V2-PR7 — تقرير إغلاق وتسليم الوردية في Chromium حقيقي على الشاشات الفعلية (`/fuel-stations/ops/shifts/{id}` و`/handover`) بخادم مُعترَض:
 * الإغلاق ← إجراءات التقرير في الصفحة نفسها ← معاينة/طباعة/تنزيل؛ إعادة فتح وردية مغلقة؛ وPDF يُرسم فعلاً بـjsPDF ويُفحص (المقاس، الصفحات، النص).
 *
 * حدود صريحة: لا طابعة حقيقية (الطباعة تُثبَت بفتح نافذة PDF فقط)؛ iPhone = محاكاة Chromium لا Safari؛ ليس ضمن Web CI.
 * التشغيل (خادم تطوير على 3001): npx playwright test -c <config> e2e/fuel-ops-pr7-shift-report.spec.ts --project=desktop
 * أدلة الصور: PR7_OUT=/path يحفظ PDF/PNG ولقطات الشاشة.
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const OUT = process.env.PR7_OUT;
const PT_PER_MM = 72 / 25.4;
const hasPdftotext = (() => { try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const hasPoppler = (() => { try { execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const HIDE = 'nextjs-portal, #next-logo, [data-nextjs-dev-tools-button] { display: none !important; }';

const sizeMm = (info: ReturnType<typeof inspectPdf>, i = 0) => ({ w: info.mediaBoxes[i].widthPt / PT_PER_MM, h: info.mediaBoxes[i].heightPt / PT_PER_MM });
function pdfText(buffer: Buffer): string {
  const file = join(tmpdir(), `pr7-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`);
  writeFileSync(file, buffer);
  return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
}
function keep(name: string, buffer: Buffer) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.pdf`), buffer);
  if (hasPoppler) execFileSync('pdftoppm', ['-png', '-r', '100', join(OUT, `${name}.pdf`), join(OUT, name)]);
}
async function shot(page: Page, name: string) { if (OUT) { mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false }); } }
async function downloadPdf(page: Page, selector = '[data-report-action="download"]') {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.locator(selector).first().click()]);
  const buffer = readFileSync((await download.path())!);
  return { name: download.suggestedFilename(), buffer, info: inspectPdf(buffer) };
}
async function ready(page: Page) {
  await page.addStyleTag({ content: HIDE }).catch(() => {});
  await page.locator('[data-shift-report-actions]').waitFor({ timeout: 90_000 });
  await expect(page.locator('[data-report-action="print"]')).toBeEnabled({ timeout: 60_000 });
  await page.addStyleTag({ content: HIDE });
}

test.describe.configure({ mode: 'serial' });

for (const locale of ['en', 'ar'] as Locale[]) {
  test.describe(`shift closing report · ${locale}`, () => {
    test('(1/11/12) iPhone: close the shift on the handover page → report actions appear in the same page → A4 + A5 PDFs download and match the data', async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'يعمل بمحاكاة iPhone داخلياً');
      test.setTimeout(240_000);
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true });
      const page = await context.newPage();
      try {
        const api = await mockPr7Api(page, { baseUrl, locale, permissions: SALES_PERMS, status: 'open', collection: 'frozen' });
        await page.goto(`${baseUrl}/fuel-stations/ops/shifts/s1/handover`, { waitUntil: 'domcontentloaded' });
        await page.locator('[data-testid="counted-cash"]').waitFor({ timeout: 90_000 });
        await expect(page.locator('[data-shift-report-actions]')).toHaveCount(0); // قبل الإغلاق: لا تقرير
        await page.locator('[data-testid="counted-cash"]').fill('250');
        await page.getByRole('button').filter({ hasText: locale === 'ar' ? /مراجعة|تسليم/ : /Review and hand over/ }).first().click();
        await page.getByRole('dialog').getByRole('checkbox').check();
        await page.locator('[data-confirm-close]').click();

        await ready(page);
        await expect(page.locator('[data-shift-report-actions]')).toHaveAttribute('data-just-closed', 'true');
        await page.locator('[data-shift-report-actions]').scrollIntoViewIfNeeded();
        await shot(page, `iphone-just-closed-${locale}`);
        // لمس مريح وبلا تجاوز أفقي.
        const boxes = await page.locator('[data-report-action], [data-paper]').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; }));
        for (const box of boxes) { expect(box.h).toBeGreaterThanOrEqual(44); expect(box.w).toBeGreaterThanOrEqual(44); }
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
        expect(api.posts.map((p) => p.path)).toEqual(['/fuel-stations/shifts/s1/close']);

        const a4 = await downloadPdf(page);
        expect(a4.name).toMatch(/^shift-report-FX-SH-0100-a4-\d{4}-\d{2}-\d{2}\.pdf$/);
        expect(Math.abs(sizeMm(a4.info).w - 210)).toBeLessThan(0.5);
        expect(Math.abs(sizeMm(a4.info).h - 297)).toBeLessThan(0.5);
        expect(a4.info.pageCount).toBe(1);
        expect(a4.info.hasTextLayer).toBe(true);
        expect(a4.info.images).toHaveLength(0);
        keep(`a4-${locale}`, a4.buffer);
        if (hasPdftotext) {
          const text = pdfText(a4.buffer);
          for (const expected of ['FX-SH-0100', EXPECTED.total, EXPECTED.perNozzle, EXPECTED.productLiters, '2026-11-03']) expect(text, `مفقود من A4: ${expected}`).toContain(expected);
          expect(text).not.toMatch(/[٠-٩]/);
        }

        await page.locator('[data-paper="a5"]').click();
        const a5 = await downloadPdf(page);
        expect(a5.name).toMatch(/-a5-/);
        expect(Math.abs(sizeMm(a5.info).w - 210)).toBeLessThan(0.5);
        expect(Math.abs(sizeMm(a5.info).h - 148)).toBeLessThan(0.5);
        expect(a5.info.pageCount).toBeLessThanOrEqual(2);
        keep(`a5-${locale}`, a5.buffer);
        if (hasPdftotext) expect(pdfText(a5.buffer)).toContain(EXPECTED.total);

        // لا كتابة إضافية من التنزيل (لا إعادة إغلاق).
        expect(api.posts.map((p) => p.path)).toEqual(['/fuel-stations/shifts/s1/close']);
      } finally {
        await context.close();
      }
    });

    test('(3/11) reopening a closed shift: preview dialog fits the phone, print opens the system PDF viewer tab, no write calls', async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'يعمل بمحاكاة iPhone داخلياً');
      test.setTimeout(240_000);
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true });
      const page = await context.newPage();
      try {
        const api = await mockPr7Api(page, { baseUrl, locale, permissions: SALES_PERMS, status: 'closed', collection: 'frozen' });
        await page.goto(`${baseUrl}/fuel-stations/ops/shifts/s1`, { waitUntil: 'domcontentloaded' });
        await ready(page);
        await expect(page.locator('[data-shift-report-actions]')).toHaveAttribute('data-just-closed', 'false');

        await page.locator('[data-report-action="preview"]').click();
        const dialog = page.getByRole('dialog');
        await dialog.locator('[data-shift-report-preview]').waitFor();
        await page.addStyleTag({ content: HIDE });
        await shot(page, `iphone-preview-${locale}`);
        for (const section of ['shift', 'sales', 'readings', 'collection', 'reconciliation', 'cash', 'handover']) await expect(dialog.locator(`[data-report-section="${section}"]`)).toHaveCount(1);
        // لا تجاوز أفقي للصفحة ولا للحوار.
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
        expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
        await dialog.getByRole('button').filter({ hasText: locale === 'ar' ? 'طباعة' : 'Print report' }).click();
        const popup = await page.waitForEvent('popup', { timeout: 30_000 });
        expect(popup.url().startsWith('blob:')).toBe(true);
        await popup.close();
        expect(api.posts).toHaveLength(0);
      } finally {
        await context.close();
      }
    });
  });
}

test('(8/9) a viewer without sales permission gets a PDF with litres only (no price/amount/difference) and no data from other collection states', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
  test.setTimeout(180_000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  try {
    await mockPr7Api(page, { baseUrl, locale: 'en', permissions: CLOSE_PERMS, status: 'closed', collection: 'hidden' });
    await page.goto(`${baseUrl}/fuel-stations/ops/shifts/s1`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    const pdf = await downloadPdf(page);
    keep('a4-no-sales-permission', pdf.buffer);
    if (hasPdftotext) {
      const text = pdfText(pdf.buffer);
      expect(text).toContain(EXPECTED.total);
      for (const forbidden of ['Price per litre', 'Sales due', 'Shortage', 'Overage']) expect(text).not.toContain(forbidden);
    }
  } finally {
    await context.close();
  }
});

test('(2/4) an open shift has no report actions; a snapshot failure shows retry instead of printing partial data', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
  test.setTimeout(180_000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await mockPr7Api(page, { baseUrl, locale: 'en', permissions: SALES_PERMS, status: 'open', collection: 'frozen' });
    await page.goto(`${baseUrl}/fuel-stations/ops/shifts/s1`, { waitUntil: 'domcontentloaded' });
    await page.getByText('FX-SH-0100').first().waitFor({ timeout: 90_000 });
    await expect(page.locator('[data-shift-report-actions]')).toHaveCount(0);
  } finally {
    await context.close();
  }
  const failing = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const failPage = await failing.newPage();
  try {
    await mockPr7Api(failPage, { baseUrl, locale: 'en', permissions: SALES_PERMS, status: 'closed', collection: 'error' });
    await failPage.goto(`${baseUrl}/fuel-stations/ops/shifts/s1`, { waitUntil: 'domcontentloaded' });
    await failPage.locator('[data-report-load-failed]').waitFor({ timeout: 90_000 });
    await expect(failPage.locator('[data-report-action="print"]')).toBeDisabled();
  } finally {
    await failing.close();
  }
});
