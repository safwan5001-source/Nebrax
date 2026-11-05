import { expect, test, type Page } from '@playwright/test';
import { mockOpsApi, type Locale, type Scenario } from './support/fuel-ops-ui1-mock';

/**
 * FUEL-OPS UI-1 — تفاصيل الوردية وقراءات العدادات في متصفح حقيقي (Chromium بمقاس آيفون 390×844 + سطح المكتب).
 * قراءة فقط: يتحقق من أن المساحة لا ترسل إلا GET، ومن سلامة التخطيط (تجاوز أفقي، أهداف اللمس، تغطية التنقل)، ومن الحالات الصادقة.
 * الخادم مُعترَض بالكامل ببيانات اختبار موسومة. هذا لا يغني عن اختبار Safari/iPhone الحقيقي.
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';

async function go(page: Page, path: string, opts: { locale?: Locale; theme?: 'light' | 'dark'; scenario?: Scenario } = {}) {
  const mock = await mockOpsApi(page, { baseUrl, locale: opts.locale ?? 'en', theme: opts.theme ?? 'light', scenario: opts.scenario });
  await page.goto(`${baseUrl}/fuel-stations/ops${path}`, { waitUntil: 'domcontentloaded' });
  return mock;
}

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

for (const locale of ['en', 'ar'] as const) {
  test.describe(`shift details — ${locale}`, () => {
    test('open shift: partial liters are labelled, missing readings are explicit, nothing but GET is sent', async ({ page }) => {
      const mock = await go(page, '/shifts/h1', { locale });
      await expect(page.locator('h2').filter({ hasText: 'SH-1001' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.dir)).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      expect(await noOverflow(page)).toBe(true);
      const main = page.locator('#fo-main');
      // الإجمالي المخزَّن 0 للوردية المفتوحة لا يظهر، والأرقام لاتينية.
      await expect(main).toContainText(locale === 'ar' ? 'مجموع جزئي' : 'Partial total');
      await expect(main).toContainText(locale === 'ar' ? 'لم تُسجَّل' : 'Not recorded');
      expect(await main.innerText()).not.toMatch(/[٠-٩]/);
      expect(mock.requests.filter((r) => r.method !== 'GET')).toEqual([]);
      expect(mock.requests.some((r) => r.path === '/fuel-stations/shifts/h1')).toBe(true);
      expect(mock.issues).toEqual([]);
    });

    test('closed shift: every pump and nozzle with opening, closing and computed liters; tank and cash sections', async ({ page }) => {
      await go(page, '/shifts/h2', { locale });
      await expect(page.locator('h2').filter({ hasText: 'SH-1000' })).toBeVisible();
      await expect(page.locator('h3')).toHaveCount(3); // ثلاث مضخات من إعداد المحطة لا من رقم ثابت
      const text = await page.locator('#fo-main').innerText();
      expect(text).toContain('125,430.000'); // قراءة افتتاح الفوهة الأولى بثلاث منازل
      expect(text).not.toMatch(/[٠-٩]/);
      // الأقسام الثانوية مطوية افتراضياً: النقد لا يزاحم القراءات، ويظهر بعد النقر.
      await expect(page.getByText(locale === 'ar' ? 'عجز' : 'Shortage')).toBeHidden();
      await page.locator('summary', { hasText: locale === 'ar' ? 'النقد في الوردية' : 'Cash in this shift' }).click();
      await expect(page.getByText(locale === 'ar' ? 'عجز' : 'Shortage')).toBeVisible();
      expect(await noOverflow(page)).toBe(true);
    });

    test('touch targets, the bottom navigation and the form-control font size are safe on a phone', async ({ page }, info) => {
      await go(page, '/shifts/h2', { locale });
      await expect(page.locator('h2').filter({ hasText: 'SH-1000' })).toBeVisible();
      const small = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of document.querySelectorAll('nav a, header a, header select, main a, main button')) {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.width > 0 && (r.height < 43.5 || r.width < 43.5)) out.push(`${el.tagName}:${(el.textContent ?? '').trim().slice(0, 20)}:${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        return out;
      });
      expect(small).toEqual([]);
      if (info.project.name === 'mobile') {
        const clearance = await page.evaluate(() => {
          window.scrollTo(0, document.documentElement.scrollHeight);
          const main = document.querySelector('#fo-main') as HTMLElement;
          const nav = document.querySelector('nav[aria-label]') as HTMLElement;
          const last = Math.max(...[...main.querySelectorAll('*')].filter((e) => !e.closest('details:not([open])') || e.tagName === 'SUMMARY').map((e) => (e as HTMLElement).getBoundingClientRect().bottom));
          return nav.getBoundingClientRect().top - last;
        });
        expect(clearance).toBeGreaterThanOrEqual(0);
        expect(await page.locator('#fo-station').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
      }
    });

    test('list → details → back, and the list shows no stored zero for the open shift', async ({ page }) => {
      await go(page, '/shifts', { locale });
      const card = page.locator('article').filter({ hasText: 'SH-1001' });
      await expect(card).toBeVisible();
      await expect(card).toContainText(locale === 'ar' ? 'تُحتسب عند إغلاق الوردية' : 'Computed when the shift closes');
      await card.getByRole('link').click();
      await expect(page).toHaveURL(/\/fuel-stations\/ops\/shifts\/h1$/);
      await expect(page.locator('h2').filter({ hasText: 'SH-1001' })).toBeVisible();
      await page.getByRole('link', { name: locale === 'ar' ? 'كل الورديات' : 'All shifts' }).click();
      await expect(page).toHaveURL(/\/fuel-stations\/ops\/shifts$/);
    });

    test('UX: the next step is visible without scrolling, is inert text, and every link stays in the app', async ({ page }, info) => {
      for (const path of ['', '/shifts/h1', '/shifts/h2']) {
        await go(page, path, { locale });
        const next = page.locator('[data-next-step]');
        await expect(next).toBeVisible();
        expect(await next.evaluate((el) => !!el.querySelector('a, button'))).toBe(false);
        if (info.project.name === 'mobile') {
          const box = await next.boundingBox();
          const nav = await page.locator('nav[aria-label]').first().boundingBox();
          // «الخطوة التالية» تبدأ ضمن أول شاشة آيفون وفوق التنقل السفلي (الرئيسية: ضمن أول شاشتين كحدٍّ أقصى).
          expect(box!.y, `${path || 'home'} next step top`).toBeLessThan(path === '' ? 844 * 1.4 : 844);
          expect(nav!.y).toBeGreaterThan(0);
        }
        const hrefs = await page.locator('a').evaluateAll((anchors) => anchors.map((a) => a.getAttribute('href') ?? ''));
        expect(hrefs.filter((href) => !href.startsWith('#') && !href.startsWith('/fuel-stations/ops')), path).toEqual([]);
      }
      await go(page, '', { locale });
      await expect(page.locator('[data-primary-action]')).toHaveCount(1);
    });

    test('home links to the open shift and shows liters computed from the completed nozzles', async ({ page }) => {
      await go(page, '', { locale });
      await expect(page.getByText('SH-1001').first()).toBeVisible();
      await expect(page.getByRole('link', { name: locale === 'ar' ? 'عرض الوردية الحالية' : 'View the current shift' })).toBeVisible();
      await expect(page.getByText(locale === 'ar' ? 'لترات العدادات حتى الآن' : 'Meter liters so far')).toBeVisible();
    });
  });
}

test('switching station on the details screen replaces the whole scope (no leakage)', async ({ page }) => {
  await go(page, '/shifts/h2');
  await expect(page.locator('h2').filter({ hasText: 'SH-1000' })).toBeVisible();
  await page.locator('#fo-station').selectOption('sb');
  await expect(page.getByText('Shift not available')).toBeVisible();
  await expect(page.getByText('SH-1000')).toHaveCount(0);
  await expect(page.getByText('125,430.000')).toHaveCount(0);
});

test('a missing shift, a forbidden one and a server failure each get their own honest state', async ({ page }) => {
  await go(page, '/shifts/h2', { scenario: 'not-found' });
  await expect(page.getByText('Shift not available')).toBeVisible();
  await go(page, '/shifts/h2', { scenario: 'forbidden' });
  await expect(page.getByText("You don't have permission to view this")).toBeVisible();
  await go(page, '/shifts/h2', { scenario: 'server-error' });
  await expect(page.getByText("Couldn't load data")).toBeVisible();
});

test('a failed refresh keeps the last loaded data and says so', async ({ page }) => {
  const mock = await go(page, '/shifts/h2');
  await expect(page.locator('h2').filter({ hasText: 'SH-1000' })).toBeVisible();
  mock.controls.failDetail = true;
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText(/Couldn't refresh; showing the last loaded data/)).toBeVisible();
  await expect(page.getByText('125,430.000').first()).toBeVisible();
  expect(mock.requests.filter((r) => r.method !== 'GET')).toEqual([]);
});

test('a malformed shift id never becomes a request path', async ({ page }) => {
  const mock = await go(page, '/shifts/%2e%2e%2fsales');
  await expect(page.getByText('Shift not available')).toBeVisible();
  expect(mock.requests.filter((r) => r.path.startsWith('/fuel-stations/shifts/'))).toEqual([]);
  expect(mock.requests.some((r) => r.path.includes('sales'))).toBe(false);
});

test('dark theme: the details screen stays scoped and legible', async ({ page }) => {
  await go(page, '/shifts/h2', { locale: 'ar', theme: 'dark' });
  await expect(page.locator('h2').filter({ hasText: 'SH-1000' })).toBeVisible();
  const dark = await page.evaluate(() => ({ dark: document.documentElement.classList.contains('dark'), bg: getComputedStyle(document.querySelector('[data-fuel-ops]') as HTMLElement).backgroundColor }));
  expect(dark.dark).toBe(true);
  expect(dark.bg).not.toBe('rgb(247, 248, 250)');
});

test('a user without shift permission sees why and no shift request is made', async ({ page }) => {
  const mock = await go(page, '/shifts/h2', { scenario: 'no-permission' });
  await expect(page.getByText("You don't have permission to view this")).toBeVisible();
  expect(mock.requests.filter((r) => r.path.startsWith('/fuel-stations'))).toEqual([]);
});
