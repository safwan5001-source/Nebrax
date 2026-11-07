import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FINANCE, mockOpeningApi, type Locale } from './support/fuel-ops-opening-mock';

/**
 * PR-2 — الفحص البصري والسلوكي لمعالج الرصيد الافتتاحي على نسخة إنتاج (خادم مُعترَض ببيانات اختبار موسومة، لا اتصال بأي بيئة حية):
 *   npx next start -p 3012 &
 *   VQA_OUT=/tmp/vqa-opening PLAYWRIGHT_BASE_URL=http://127.0.0.1:3012 npx playwright test -c playwright.visual-qa.config.ts e2e/fuel-ops-opening-visual.spec.ts
 * لقطات: الخطوة × المقاس (iPhone 390×844، iPhone SE 320×568) × الثيم × اللغة. فحوص آلية: التجاوز الأفقي، تغطية شريط الإجراء بالتنقل السفلي، أخطاء الكونسول،
 * وأن الكتابات هي المتوقعة فقط (حفظ الحساب ← مسودة ← ترحيل). الحكم البصري يكتبه المراجع بعد فتح اللقطات.
 */
const OUT = process.env.VQA_OUT;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3012';
test.skip(!OUT, 'VQA_OUT is required');
const SIZES = { iphone: { width: 390, height: 844 }, se: { width: 320, height: 568 } } as const;
const PAGE = '/fuel-stations/ops/opening-balance';

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
    const bar = document.querySelector('[data-action-bar]')?.getBoundingClientRect();
    const nav = document.querySelector('nav[aria-label]:not([aria-label*="step" i])')?.getBoundingClientRect();
    return { overflow: doc.scrollWidth - doc.clientWidth, barOverlapsNav: bar && nav ? bar.bottom > nav.top + 1 : false, easternDigits: /[٠-٩]/.test(document.querySelector('main')?.textContent ?? '') };
  });
  expect.soft(result.overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(0);
  expect.soft(result.barOverlapsNav, `${label}: action bar overlaps bottom nav`).toBe(false);
  expect.soft(result.easternDigits, `${label}: Eastern Arabic digits`).toBe(false);
}

const MATRIX: Array<{ size: keyof typeof SIZES; locale: Locale; theme: 'light' | 'dark' }> = [
  { size: 'iphone', locale: 'ar', theme: 'light' },
  { size: 'iphone', locale: 'en', theme: 'dark' },
  { size: 'se', locale: 'ar', theme: 'dark' },
  { size: 'se', locale: 'en', theme: 'light' },
];

for (const cell of MATRIX) {
  test.describe(`${cell.size}-${cell.locale}-${cell.theme}`, () => {
    test.use({ viewport: SIZES[cell.size], isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test('wizard: tanks · cost · review · approve', async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      const mock = await mockOpeningApi(page, { baseUrl, locale: cell.locale, theme: cell.theme, permissions: FINANCE });
      const tag = `${cell.size}-${cell.locale}-${cell.theme}`;
      const at = (name: string) => `${tag}/${name}`;

      await page.goto(`${baseUrl}${PAGE}`);
      await settle(page);
      await shot(page, at('01-tanks-empty'));
      await audit(page, `${tag} tanks`);

      const inputs = page.locator('[data-testid^="qty-"]');
      await inputs.nth(0).fill('30000');
      await inputs.nth(1).fill('15555');
      await inputs.nth(2).fill('34000.5'); // يتجاوز السعة ⇒ خطأ
      await shot(page, at('02-tanks-error'));
      await audit(page, `${tag} tanks-error`);
      await inputs.nth(2).fill('31000');
      await page.locator('[data-action-bar] button[data-primary-action]').click();

      await page.locator('[data-testid^="cost-"]').first().waitFor();
      await shot(page, at('03-cost-empty'));
      await audit(page, `${tag} cost`);
      const costs = page.locator('[data-testid^="cost-"]');
      await costs.nth(0).fill('2.18');
      await costs.nth(1).fill('2.33');
      await costs.nth(2).fill('1.66');
      await page.locator('#op-account').selectOption({ index: 1 });
      await page.locator('summary').first().click();
      await shot(page, at('04-cost-filled-advanced'));
      await audit(page, `${tag} cost-filled`);
      await page.locator('[data-action-bar] button[data-primary-action]').click();

      await page.locator('[data-journal]').waitFor();
      await shot(page, at('05-review'));
      await audit(page, `${tag} review`);

      await page.locator('[data-action-bar] button[data-primary-action]').click();
      await page.getByRole('dialog').waitFor();
      await page.waitForTimeout(300);
      await shot(page, at('06-confirm'));
      await audit(page, `${tag} confirm`);
      await page.getByRole('dialog').locator('button[data-primary-action]').click();
      await page.locator('[data-posted]').waitFor();
      await shot(page, at('07-posted'));
      await audit(page, `${tag} posted`);

      const writes = mock.requests.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/, '{id}')}`);
      expect(writes).toEqual(['PUT /fuel-stations/stations/sa/settings', 'POST /fuel-stations/opening-balances', 'POST /fuel-stations/opening-balances/{id}/post']);
      expect(mock.issues).toEqual([]);
      expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
    });

    test('blockers and unavailable states', async ({ page }) => {
      const mock = await mockOpeningApi(page, { baseUrl, locale: cell.locale, theme: cell.theme, permissions: FINANCE, poolNotEmpty: true });
      const tag = `${cell.size}-${cell.locale}-${cell.theme}`;
      await page.goto(`${baseUrl}${PAGE}`);
      await settle(page);
      await page.locator('[data-testid="qty-ta"]').fill('30000');
      await page.locator('[data-action-bar] button[data-primary-action]').click();
      await page.locator('[data-testid="cost-pa"]').fill('2.18');
      await page.locator('#op-account').selectOption({ index: 1 });
      await page.locator('[data-action-bar] button[data-primary-action]').click();
      await page.locator('[data-blockers="negative"]').waitFor();
      await shot(page, `${tag}/08-blocked`);
      await audit(page, `${tag} blocked`);
      await expect(page.locator('[data-action-bar] button[data-primary-action]')).toBeDisabled();
      expect(mock.requests.some((r) => r.path.endsWith('/post'))).toBe(false);

      const closed = await page.context().newPage();
      await mockOpeningApi(closed, { baseUrl, locale: cell.locale, theme: cell.theme, permissions: FINANCE, gateOpen: false });
      await closed.goto(`${baseUrl}${PAGE}`);
      await settle(closed);
      await shot(closed, `${tag}/09-unavailable`);
      await audit(closed, `${tag} unavailable`);
      expect(await closed.locator('[data-testid^="qty-"]').count()).toBe(0);
    });
  });
}
