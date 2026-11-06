import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, EMP1, SELLER_USER, mockB4Api, type Locale } from './support/fuel-ops-b4-mock';

/**
 * FUEL-B4 — الفحص البصري والسلوكي لمساحة «الإدارة» على نسخة إنتاج (خادم مُعترَض ببيانات اختبار موسومة):
 *   npx next start -p 3012 &
 *   VQA_OUT=/tmp/vqa-b4 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3012 npx playwright test -c playwright.visual-qa.config.ts e2e/fuel-ops-b4-manage.spec.ts
 * لقطات: الحالة × المقاس (iPhone 390×844، iPhone SE 320×568) × الثيم × اللغة. وفحوص آلية: التجاوز الأفقي، أهداف اللمس، تغطية شريط الإجراء بالتنقل السفلي،
 * أخطاء الكونسول، وأي طلب كتابة غير PUT staff الوحيد. الحكم البصري يكتبه المراجع بعد فتح اللقطات.
 */
const OUT = process.env.VQA_OUT;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3012';
test.skip(!OUT, 'VQA_OUT is required');

const SIZES = { iphone: { width: 390, height: 844 }, se: { width: 320, height: 568 } } as const;
type SizeKey = keyof typeof SIZES;
const MANAGE = '/fuel-stations/ops/manage';

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

async function audit(page: Page, label: string, extra: Record<string, unknown> = {}) {
  const result = await page.evaluate(() => {
    const doc = document.documentElement;
    const small = [...document.querySelectorAll<HTMLElement>('main a, main button, main [role="switch"], main [role="radio"], main [role="checkbox"], main summary, main input, main textarea, [role="dialog"] button, nav a')]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.height < 40 || r.width < 40)
      .map(({ el, r }) => `${el.tagName.toLowerCase()}[${(el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 28)}] ${Math.round(r.width)}x${Math.round(r.height)}`);
    const bar = document.querySelector('[data-action-bar]')?.getBoundingClientRect();
    const nav = document.querySelector('nav[aria-label]')?.getBoundingClientRect();
    return {
      overflow: doc.scrollWidth - doc.clientWidth,
      small,
      barOverlapsNav: bar && nav ? bar.bottom > nav.top + 1 : false,
      easternDigits: /[٠-٩]/.test(document.querySelector('main')?.textContent ?? '') ? 'present' : 'none',
    };
  });
  expect.soft(result.overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(0);
  expect.soft(result.barOverlapsNav, `${label}: action bar overlaps bottom nav`).toBe(false);
  if (result.small.length > 0) test.info().annotations.push({ type: 'small-targets', description: `${label}: ${result.small.join(' | ')}` });
  test.info().annotations.push({ type: 'audit', description: `${label}: ${JSON.stringify({ ...extra, easternDigits: result.easternDigits })}` });
}

const MATRIX: Array<{ size: SizeKey; locale: Locale; theme: 'light' | 'dark' }> = [
  { size: 'iphone', locale: 'ar', theme: 'light' },
  { size: 'iphone', locale: 'en', theme: 'dark' },
  { size: 'se', locale: 'ar', theme: 'dark' },
  { size: 'se', locale: 'en', theme: 'light' },
];

for (const cell of MATRIX) {
  test.describe(`${cell.size}-${cell.locale}-${cell.theme}`, () => {
    test.use({ viewport: SIZES[cell.size], isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test('hub · staff · editor flows · reference · audit', async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      page.on('pageerror', (e) => consoleErrors.push(String(e)));
      const mock = await mockB4Api(page, { baseUrl, locale: cell.locale, theme: cell.theme, permissions: ADMIN });
      const tag = `${cell.size}-${cell.locale}-${cell.theme}`;
      const at = (name: string) => `${tag}/${name}`;

      await page.goto(`${baseUrl}${MANAGE}`);
      await settle(page);
      await shot(page, at('01-hub'));
      await audit(page, `${tag} hub`);

      await page.goto(`${baseUrl}${MANAGE}/staff`);
      await settle(page);
      await shot(page, at('02-staff-list'));
      await audit(page, `${tag} staff`);
      await page.locator('main button[data-primary-action]').click();
      await page.getByRole('dialog').waitFor();
      await page.waitForTimeout(300);
      await shot(page, at('03-add-dialog'));
      await page.keyboard.press('Escape');

      await page.goto(`${baseUrl}${MANAGE}/staff/${EMP1}`);
      await settle(page);
      await shot(page, at('04-editor'));
      await audit(page, `${tag} editor`);
      await page.getByRole('radio').nth(1).click(); // مشرف
      await page.locator('summary').first().click();
      await shot(page, at('05-editor-edited'));
      await audit(page, `${tag} editor-edited`);
      await page.locator('[data-action-bar] button[data-primary-action]').click();
      await page.getByRole('dialog').waitFor();
      await page.waitForTimeout(300);
      await shot(page, at('06-review'));
      await audit(page, `${tag} review`);

      // تعارض 409 يُحقن لمرة واحدة، ثم تُعاد المحاولة.
      mock.controls.fault = 'conflict';
      mock.controls.faultTimes = 1;
      await page.getByRole('dialog').locator('button[data-primary-action]').click();
      await page.locator('[data-notice="conflict"]').waitFor();
      await shot(page, at('07-conflict'));
      await audit(page, `${tag} conflict`);
      await page.locator('[data-notice="conflict"] button').first().click();
      await page.locator('[data-notice="conflict"]').waitFor({ state: 'detached' });
      await page.locator('[data-action-bar] button[data-primary-action]').click();
      await page.getByRole('dialog').waitFor();
      await page.getByRole('dialog').locator('button[data-primary-action]').click();
      await page.locator('[data-notice="saved"]').waitFor();
      await shot(page, at('08-saved'));

      await page.goto(`${baseUrl}${MANAGE}/permissions`);
      await settle(page);
      await page.locator('summary').first().click();
      await shot(page, at('09-permissions-reference'));
      await audit(page, `${tag} permissions`);

      await page.goto(`${baseUrl}${MANAGE}/audit`);
      await settle(page);
      await shot(page, at('10-audit'));
      await audit(page, `${tag} audit`);

      const writes = mock.requests.filter((r) => r.method !== 'GET');
      expect(writes.every((r) => r.method === 'PUT' && /^\/fuel-stations\/staff\/[0-9a-f-]{36}$/.test(r.path)), JSON.stringify(writes)).toBe(true);
      expect(mock.issues).toEqual([]);
      expect(consoleErrors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
    });
  });
}

test.describe('no access', () => {
  test.use({ viewport: SIZES.iphone, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  test('a seller has no Manage entry, and the hub is an honest empty state', async ({ page }) => {
    const mock = await mockB4Api(page, { baseUrl, locale: 'ar', theme: 'light', permissions: SELLER_USER });
    await page.goto(`${baseUrl}/fuel-stations/ops`);
    await settle(page);
    await expect(page.locator('nav[aria-label] a[href$="/manage"]')).toHaveCount(0);
    await page.goto(`${baseUrl}${MANAGE}`);
    await settle(page);
    await shot(page, 'seller/01-hub-no-access');
    await page.goto(`${baseUrl}${MANAGE}/staff`);
    await settle(page);
    await shot(page, 'seller/02-staff-forbidden');
    expect(mock.requests.filter((r) => r.path.startsWith('/fuel-stations/staff'))).toEqual([]);
  });
});
