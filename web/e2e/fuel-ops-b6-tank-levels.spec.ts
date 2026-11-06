import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { RECORDER, TANK_EMPTY, TANK_OK, TANK_REVIEW, VIEWER, mockB6Api, type Locale } from './support/fuel-ops-b6-mock';

/**
 * FUEL-B6 — الفحص البصري والسلوكي لمراقبة الخزانات وتسجيل القراءات المستقلة على نسخة إنتاج (خادم مُعترَض ببيانات اختبار موسومة، لا خلفية):
 *   npx next start -p 3012 &
 *   VQA_OUT=/tmp/vqa-b6 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3012 npx playwright test -c playwright.visual-qa.config.ts e2e/fuel-ops-b6-tank-levels.spec.ts
 * لقطات: الحالة × المقاس (iPhone 390×844، iPhone SE 320×568) × الثيم × اللغة. فحوص آلية: التجاوز الأفقي، تغطية التنقل، أهداف اللمس، تغطية الحوار،
 * وأن الكتابة الوحيدة هي POST /fuel-stations/readings بلا أي ساعة عميل.
 */
const OUT = process.env.VQA_OUT;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3012';
test.skip(!OUT, 'VQA_OUT is required');

const SIZES = { iphone: { width: 390, height: 844 }, se: { width: 320, height: 568 } } as const;
type SizeKey = keyof typeof SIZES;
const TANKS = '/fuel-stations/ops/tanks';

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
    const small = [...document.querySelectorAll<HTMLElement>('main a, main button, main [role="radio"], main input, main textarea, [role="dialog"] button, nav a')]
      .filter((el) => el.getClientRects().length > 0 && !el.classList.contains('sr-only')).map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ r }) => r.height < 40 || r.width < 40)
      .map(({ el, r }) => `${el.tagName.toLowerCase()}[${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24)}] ${Math.round(r.width)}x${Math.round(r.height)}`);
    const bar = document.querySelector('[data-action-bar]')?.getBoundingClientRect();
    const nav = document.querySelector('nav[aria-label]')?.getBoundingClientRect();
    const labels = [...document.querySelectorAll<HTMLElement>('nav[aria-label] li a span')].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent?.trim());
    return { overflow: doc.scrollWidth - doc.clientWidth, small, barOverlapsNav: bar && nav ? bar.bottom > nav.top + 1 : false, clippedNavLabels: labels };
  });
  expect.soft(result.overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(0);
  expect.soft(result.barOverlapsNav, `${label}: action bar overlaps bottom nav`).toBe(false);
  expect.soft(result.small, `${label}: touch targets under 40px`).toEqual([]);
  expect.soft(result.clippedNavLabels, `${label}: bottom-nav labels clipped`).toEqual([]);
}

const MATRIX: Array<{ size: SizeKey; locale: Locale; theme: 'light' | 'dark' }> = [
  { size: 'iphone', locale: 'ar', theme: 'light' },
  { size: 'iphone', locale: 'en', theme: 'dark' },
  { size: 'se', locale: 'ar', theme: 'dark' },
  { size: 'se', locale: 'en', theme: 'light' },
];

for (const cell of MATRIX) {
  const tag = `${cell.size}-${cell.locale}-${cell.theme}`;
  const use = { viewport: SIZES[cell.size], isMobile: true, hasTouch: true, deviceScaleFactor: 2 } as const;

  test.describe(`${tag} supervisor (records readings)`, () => {
    test.use(use);

    test('monitor · detail · review · save · log', async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      const mock = await mockB6Api(page, { baseUrl, locale: cell.locale, theme: cell.theme, permissions: RECORDER, staleAfter: 120 });
      const at = (name: string) => `${tag}/supervisor/${name}`;
      const n = mock.names;

      await page.goto(`${baseUrl}${TANKS}`);
      await settle(page);
      await expect(page.locator('[data-tank-card]')).toHaveCount(3);
      await expect(page.locator(`[data-tank-card="${TANK_REVIEW}"]`)).toHaveAttribute('data-review', 'true');
      await expect(page.locator(`[data-tank-card="${TANK_OK}"]`)).not.toHaveAttribute('data-review', 'true');
      await shot(page, at('01-monitor'));
      await audit(page, `${tag} monitor`);

      await page.locator(`[data-tank-card="${TANK_OK}"]`).click();
      await settle(page);
      await expect(page.getByText(n.tanks[0]).first()).toBeVisible();
      await shot(page, at('02-detail'));
      await audit(page, `${tag} detail`);

      await page.getByTestId('tank-quantity').fill('290000');
      await expect(page.locator('[data-review-button]')).toBeDisabled(); // فوق السعة
      await shot(page, at('03-over-capacity'));
      await audit(page, `${tag} over`);

      await page.getByTestId('tank-quantity').fill('20500.5');
      await expect(page.locator('[data-preview]')).toBeVisible();
      await page.locator('textarea').fill(cell.locale === 'ar' ? 'بعد التفريغ' : 'after unloading');
      await shot(page, at('04-form-filled'));
      await audit(page, `${tag} form`);

      await page.locator('[data-review-button]').click();
      await page.getByRole('dialog').waitFor();
      await shot(page, at('05-confirm'));
      await audit(page, `${tag} confirm`);
      await page.locator('[data-confirm-save]').dblclick(); // نقرة مزدوجة ⇒ طلب واحد
      await page.locator('[data-saved]').waitFor();
      await shot(page, at('06-saved'));
      await audit(page, `${tag} saved`);

      const writes = mock.requests.filter((r) => r.method !== 'GET');
      expect(writes).toEqual([{ method: 'POST', path: '/fuel-stations/readings' }]);
      expect(mock.posts[0].body).toMatchObject({ fuel_tank_id: TANK_OK, reading_type: 'physical', quantity_liters: '20500.5', evidence: { method: 'dipstick' } });
      expect(mock.posts[0].body).not.toHaveProperty('measured_at');
      expect(mock.issues).toEqual([]);

      await page.goto(`${baseUrl}${TANKS}/${TANK_REVIEW}`);
      await settle(page);
      await shot(page, at('07-detail-review-stale'));
      await audit(page, `${tag} review-detail`);

      await page.goto(`${baseUrl}${TANKS}/${TANK_EMPTY}`);
      await settle(page);
      await shot(page, at('08-detail-no-reading'));
      await audit(page, `${tag} empty-detail`);

      // RTL/LTR: لا خصائص فيزيائية تُفسد الاتجاه، والصفحة بالاتجاه المطلوب
      expect(await page.evaluate(() => document.documentElement.dir)).toBe(cell.locale === 'ar' ? 'rtl' : 'ltr');
      expect(errors.filter((e) => !/Failed to load resource|favicon/i.test(e))).toEqual([]);
    });
  });

  test.describe(`${tag} seller (view only)`, () => {
    test.use(use);

    test('monitor and log without a recording form', async ({ page }) => {
      const mock = await mockB6Api(page, { baseUrl, locale: cell.locale, theme: cell.theme, permissions: VIEWER });
      const at = (name: string) => `${tag}/seller/${name}`;
      await page.goto(`${baseUrl}${TANKS}`);
      await settle(page);
      await shot(page, at('01-monitor'));
      await audit(page, `${tag} seller monitor`);
      await page.locator(`[data-tank-card="${TANK_OK}"]`).click();
      await settle(page);
      await expect(page.locator('[data-view-only]')).toBeVisible();
      await expect(page.locator('[data-record-form]')).toHaveCount(0);
      await shot(page, at('02-detail-view-only'));
      await audit(page, `${tag} seller detail`);
      expect(mock.requests.filter((r) => r.method !== 'GET')).toEqual([]);
    });
  });
}
