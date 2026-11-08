import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { MANAGER, STAFF, mockReportsApi, type Locale } from './support/fuel-ops-reports-mock';

/**
 * HORIZON-REPORTS — الفحص البصري والسلوكي لقسم «التقارير» في تطبيق المحطة على نسخة إنتاج (خادم مُعترَض ببيانات اختبار موسومة):
 *   npx next start -p 3012 &
 *   VQA_OUT=/tmp/vqa-reports PLAYWRIGHT_BASE_URL=http://127.0.0.1:3012 npx playwright test -c playwright.visual-qa.config.ts e2e/fuel-ops-reports.spec.ts
 * لقطات: iPhone 390×844 و iPhone SE 320×568 × اللغة × الثيم. فحوص آلية: التجاوز الأفقي، أهداف اللمس، بقاء الروابط داخل التطبيق، غياب المبالغ عن موظف بلا
 * `fuel.sale.view` (DOM + لقطة + طلب)، تصدير Excel/CSV، تدقيق PDF، ملف PDF حراري حقيقي بعرض الورق.
 */
const OUT = process.env.VQA_OUT;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3012';
test.skip(!OUT, 'VQA_OUT is required');

const SIZES = { iphone: { width: 390, height: 844 }, se: { width: 320, height: 568 } } as const;
const BASE = '/fuel-stations/ops/reports';
const MONEY = /230\.00|115\.00|345\.00|34500|23000/;

async function settle(page: Page) {
  await page.locator('#fo-main').waitFor({ state: 'attached' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}
async function shot(page: Page, rel: string) {
  const file = join(OUT!, `${rel}.png`);
  mkdirSync(join(file, '..'), { recursive: true });
  await page.screenshot({ path: file, fullPage: true });
}
async function audit(page: Page, label: string) {
  const result = await page.evaluate(() => {
    const doc = document.documentElement;
    const small = [...document.querySelectorAll<HTMLElement>('main a, main button, main select, main input, nav a')]
      .filter((el) => el.getClientRects().length > 0 && !el.classList.contains('sr-only')).map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ r }) => r.height < 38 || r.width < 38)
      .map(({ el, r }) => `${el.tagName.toLowerCase()}[${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24)}] ${Math.round(r.width)}x${Math.round(r.height)}`);
    return { overflow: doc.scrollWidth - doc.clientWidth, small };
  });
  expect.soft(result.overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(0);
  expect.soft(result.small, `${label}: touch targets under 38px`).toEqual([]);
}

const MATRIX: Array<{ size: keyof typeof SIZES; locale: Locale; theme: 'light' | 'dark' }> = [
  { size: 'iphone', locale: 'ar', theme: 'light' },
  { size: 'iphone', locale: 'en', theme: 'dark' },
  { size: 'se', locale: 'ar', theme: 'dark' },
];

for (const cell of MATRIX) {
  const tag = `${cell.size}-${cell.locale}-${cell.theme}`;
  test.describe(`${tag} manager`, () => {
    test.use({ viewport: SIZES[cell.size], isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test('catalog · viewer · export · pdf audit · thermal pdf', async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      const mock = await mockReportsApi(page, { baseUrl, locale: cell.locale, theme: cell.theme, permissions: MANAGER });

      await page.goto(`${baseUrl}${BASE}`);
      await page.locator('[data-report-center]').waitFor();
      await settle(page);
      await shot(page, `${tag}/01-center`);
      await audit(page, `${tag} center`);
      const hrefs = await page.locator('a[data-report-link]').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
      expect(hrefs.length).toBe(4);
      expect(hrefs.every((h) => h?.startsWith('/fuel-stations/ops/'))).toBe(true); // لا تحويل إلى أَوْج
      await expect(page.locator('nav a[aria-current="page"]')).toHaveCount(1);

      await page.locator('a[data-report-link="sales.daily"]').click();
      await page.locator('[data-report-ready]').waitFor();
      await settle(page);
      await shot(page, `${tag}/02-viewer`);
      await audit(page, `${tag} viewer`);
      const text = await page.locator('body').innerText();
      expect(text).toMatch(/150\.000/);
      expect(text).toMatch(MONEY);
      expect(mock.requests.some((r) => r.path === '/fuel-stations/report-center/sales.daily' && r.query.includes('station_id=sa'))).toBe(true);

      // Excel / CSV: يطلبان مسار التصدير نفسه ويُنزَّلان.
      for (const format of ['xlsx', 'csv'] as const) {
        const [download] = await Promise.all([page.waitForEvent('download'), page.locator(`[data-report-action="${format}"]`).click()]);
        expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));
        await expect(page.locator('[data-report-notice="ok"]')).toBeVisible();
      }
      expect(mock.requests.some((r) => r.path.endsWith('/export') && r.query.includes('format=xlsx') && r.query.includes(`lang=${cell.locale}`))).toBe(true);

      // PDF: تنزيل ملف حقيقي A4 ثم تدقيق خادمي.
      const [pdf] = await Promise.all([page.waitForEvent('download'), page.locator('[data-report-action="pdf"]').click()]);
      const pdfPath = await pdf.path();
      const head = readFileSync(pdfPath!).subarray(0, 5).toString('latin1');
      expect(head).toBe('%PDF-');
      await expect.poll(() => mock.requests.some((r) => r.method === 'POST' && r.path.endsWith('/audit') && (r.body as { action?: string })?.action === 'pdf')).toBe(true);

      // حراري: تقرير إقفال الوردية فقط يقدّم مقاسات الورق.
      await page.goto(`${baseUrl}${BASE}/shifts.closing`);
      await page.locator('[data-report-ready]').waitFor();
      await settle(page);
      await expect(page.locator('[data-paper]')).toHaveCount(4);
      await page.locator('[data-paper="thermal_80"]').click();
      await shot(page, `${tag}/03-thermal-choice`);
      const [thermal] = await Promise.all([page.waitForEvent('download'), page.locator('[data-report-action="pdf"]').click()]);
      expect(thermal.suggestedFilename()).toContain('thermal_80');
      const body = readFileSync((await thermal.path())!).toString('latin1');
      const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(body);
      expect(box).not.toBeNull();
      expect(Math.abs(Number(box![1]) - (80 * 72) / 25.4)).toBeLessThan(2); // عرض الورق 80مم

      expect(errors.filter((e) => !/favicon|Failed to load resource/i.test(e))).toEqual([]);
    });
  });
}

test.describe('staff without sales permission (iphone-ar)', () => {
  test.use({ viewport: SIZES.iphone, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('no money anywhere: DOM, screenshot data and export request', async ({ page }) => {
    const mock = await mockReportsApi(page, { baseUrl, locale: 'ar', theme: 'light', permissions: STAFF });
    await page.goto(`${baseUrl}${BASE}/sales.daily`);
    await page.locator('[data-report-ready]').waitFor();
    await settle(page);
    await shot(page, 'staff/01-viewer-no-money');
    await audit(page, 'staff viewer');
    expect(await page.locator('body').innerText()).not.toMatch(MONEY);
    expect(await page.locator('body').innerText()).toMatch(/150\.000/);
    expect(await page.locator('[data-report-table] thead th').allInnerTexts()).not.toContain('القيمة');
    expect(mock.requests.filter((r) => r.method === 'POST' && !r.path.endsWith('/audit'))).toEqual([]);
  });
});
