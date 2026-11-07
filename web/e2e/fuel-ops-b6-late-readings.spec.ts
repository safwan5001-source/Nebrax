import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { APPROVER, GOVERNOR, RECORDER, REQ_OWN, REQ_PENDING, TANK_OK, mockB6Api, type Locale } from './support/fuel-ops-b6-mock';

/**
 * FUEL-B6 (تعديل) — الفحص البصري والسلوكي لسياسة القراءات المتأخرة على نسخة إنتاج (خادم مُعترَض ببيانات اختبار موسومة):
 *   npx next start -p 3012 &
 *   VQA_OUT=/tmp/vqa-b6a PLAYWRIGHT_BASE_URL=http://127.0.0.1:3012 npx playwright test -c playwright.visual-qa.config.ts e2e/fuel-ops-b6-late-readings.spec.ts
 * ثلاثة مسارات: (1) موظف يقدّم قراءة متأخرة (اختيار الوقت + السبب + حالة «بانتظار الموافقة»)، (2) مشرف يراجع الطلبات ويعتمد/يرفض بتأكيد،
 * (3) محرر السياسة في الإدارة. المقاسات: iPhone 390 وSE 320 × عربي/إنجليزي × فاتح/داكن. الساعة مثبّتة (2026-11-06 12:00Z) كي يطابق التقييم الإرشادي الخادم الوهمي.
 */
const OUT = process.env.VQA_OUT;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3012';
test.skip(!OUT, 'VQA_OUT is required');

const SIZES = { iphone: { width: 390, height: 844 }, se: { width: 320, height: 568 } } as const;
type SizeKey = keyof typeof SIZES;
const TANKS = '/fuel-stations/ops/tanks';
const POLICY = { policy: 'supervisor_approval', max_hours: 24, reason_required: true } as const;
const FIXED = new Date('2026-11-06T12:00:00Z');

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
    const small = [...document.querySelectorAll<HTMLElement>('main a, main button, main [role="radio"], main input:not([type="radio"]):not([type="checkbox"]), main textarea, main [role="switch"], [role="dialog"] button, [role="dialog"] textarea, nav a')]
      .filter((el) => el.getClientRects().length > 0 && !el.classList.contains('sr-only')).map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ r }) => r.height < 40 || r.width < 40)
      .map(({ el, r }) => `${el.tagName.toLowerCase()}[${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24)}] ${Math.round(r.width)}x${Math.round(r.height)}`);
    const clipped = [...document.querySelectorAll<HTMLElement>('nav[aria-label] li a span')].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent?.trim());
    return { overflow: doc.scrollWidth - doc.clientWidth, small, clipped };
  });
  expect.soft(result.overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(0);
  expect.soft(result.small, `${label}: touch targets under 40px`).toEqual([]);
  expect.soft(result.clipped, `${label}: bottom-nav labels clipped`).toEqual([]);
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

  test.describe(`${tag} late readings`, () => {
    test.use(use);

    test('employee: earlier-date option · time · reason · review · pending request', async ({ page }) => {
      await page.clock.setFixedTime(FIXED);
      const mock = await mockB6Api(page, { baseUrl, locale: cell.locale, theme: cell.theme, permissions: RECORDER, policy: POLICY });
      const at = (name: string) => `${tag}/employee/${name}`;
      await page.goto(`${baseUrl}${TANKS}/${TANK_OK}`);
      await settle(page);
      await expect(page.locator('[data-late-section]')).toBeVisible();
      await page.getByTestId('tank-quantity').fill('16200');
      await page.locator('[data-late-section] [role="switch"], [data-late-section] input[type="checkbox"]').first().click();
      await page.locator('[data-late-time]').fill('2026-11-06T09:00');
      await shot(page, at('01-late-form-no-reason'));
      await audit(page, `${tag} late form`);
      await expect(page.locator('[data-review-button]')).toBeDisabled(); // السبب إلزامي

      await page.locator('[data-late-time]').fill('2026-11-03T09:00'); // أبعد من 24 ساعة
      await expect(page.locator('[data-late-error="too_old"]')).toBeVisible();
      await shot(page, at('02-too-old'));
      await audit(page, `${tag} too old`);
      await page.locator('[data-late-time]').fill('2026-11-06T09:00');
      await page.locator('[data-late-reason]').fill(cell.locale === 'ar' ? 'انقطعت الشبكة أثناء القياس' : 'The network was down while measuring');
      await expect(page.locator('[data-review-button]')).toBeEnabled();
      await page.locator('[data-review-button]').click();
      await page.getByRole('dialog').waitFor();
      await expect(page.locator('[data-approval-note]')).toBeVisible();
      await shot(page, at('03-confirm'));
      await audit(page, `${tag} confirm`);
      await page.locator('[data-confirm-save]').dblclick(); // نقرة مزدوجة ⇒ طلب واحد
      await page.locator('[data-pending-sent]').waitFor();
      await expect(page.locator('[data-saved]')).toHaveCount(0);
      await shot(page, at('04-pending-sent'));
      await audit(page, `${tag} pending`);

      const writes = mock.requests.filter((r) => r.method !== 'GET');
      expect(writes).toEqual([{ method: 'POST', path: '/fuel-stations/readings' }]);
      expect(mock.posts[0].body).toMatchObject({ fuel_tank_id: TANK_OK, quantity_liters: '16200', measured_at: '2026-11-06T06:00:00.000Z' });
      expect(mock.issues).toEqual([]);
    });

    test('supervisor: queue · approve with confirmation · reject with a reason · own request locked', async ({ page }) => {
      await page.clock.setFixedTime(FIXED);
      const mock = await mockB6Api(page, { baseUrl, locale: cell.locale, theme: cell.theme, permissions: APPROVER, policy: POLICY });
      const at = (name: string) => `${tag}/supervisor/${name}`;
      await page.goto(`${baseUrl}${TANKS}/requests`);
      await settle(page);
      await expect(page.locator(`[data-request-card="${REQ_PENDING}"]`)).toBeVisible();
      await expect(page.locator(`[data-request-card="${REQ_OWN}"] [data-approve]`)).toHaveCount(0); // طلبك: لا اعتماد ذاتي
      await expect(page.locator(`[data-request-card="${REQ_OWN}"] [data-self-note]`)).toBeVisible();
      await shot(page, at('01-queue'));
      await audit(page, `${tag} queue`);

      await page.locator(`[data-request-card="${REQ_PENDING}"] [data-approve]`).click();
      await page.getByRole('dialog').waitFor();
      await shot(page, at('02-approve-confirm'));
      await audit(page, `${tag} approve dialog`);
      await page.locator('[data-decision-confirm]').click();
      await expect(page.locator(`[data-request-card="${REQ_PENDING}"]`)).toHaveCount(0); // خرج من «بانتظار الموافقة»
      expect(mock.posts.some((p) => p.path === `/fuel-stations/reading-requests/${REQ_PENDING}/approve`)).toBe(true);

      await page.locator(`[data-request-card="${REQ_OWN}"]`).waitFor();
      await page.getByRole('radio').last().click(); // «الكل»
      await expect(page.locator('[data-decision]').first()).toBeVisible();
      await shot(page, at('03-all-decided'));
      await audit(page, `${tag} decided`);

      expect(mock.requests.filter((r) => r.method !== 'GET')).toEqual([{ method: 'POST', path: `/fuel-stations/reading-requests/${REQ_PENDING}/approve` }]);
      expect(mock.issues).toEqual([]);
    });

    test('governor: policy editor · invalid hours blocked · confirmed save · read-only for others', async ({ page }) => {
      await page.clock.setFixedTime(FIXED);
      const mock = await mockB6Api(page, { baseUrl, locale: cell.locale, theme: cell.theme, permissions: GOVERNOR, canGovern: true });
      const at = (name: string) => `${tag}/governor/${name}`;
      await page.goto(`${baseUrl}/fuel-stations/ops/manage`);
      await settle(page);
      await shot(page, at('01-manage-link'));
      await audit(page, `${tag} manage`);
      await page.goto(`${baseUrl}/fuel-stations/ops/manage/reading-policy`);
      await settle(page);
      await expect(page.locator('[data-policy-editor]')).toBeVisible();
      await shot(page, at('02-policy-default-deny'));
      await audit(page, `${tag} policy`);

      await page.getByRole('radio').nth(1).check({ force: true }); // بموافقة المشرف
      await page.locator('[data-policy-hours]').fill('0');
      await expect(page.locator('[data-policy-save]')).toBeDisabled();
      await page.locator('[data-policy-hours]').fill('24');
      await shot(page, at('03-policy-edited'));
      await audit(page, `${tag} policy edited`);
      await page.locator('[data-policy-save]').click();
      await page.getByRole('dialog').waitFor();
      await shot(page, at('04-policy-confirm'));
      await audit(page, `${tag} policy confirm`);
      await page.locator('[data-policy-confirm]').click();
      await page.locator('[data-policy-saved]').waitFor();
      await shot(page, at('05-policy-saved'));
      await audit(page, `${tag} policy saved`);
      expect(mock.getPolicy()).toEqual({ policy: 'supervisor_approval', max_hours: 24, reason_required: true });
      expect(mock.requests.filter((r) => r.method !== 'GET')).toEqual([{ method: 'PUT', path: expect.stringMatching(/\/fuel-stations\/stations\/[\w-]{36}\/settings/) }]);
      expect(mock.issues).toEqual([]);
    });
  });
}
