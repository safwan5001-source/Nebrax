import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { EMP_A, EMP_B, mockStationLoginApi, type Locale } from './support/fuel-ops-station-login-mock';

/**
 * STATION-PIN — رحلة الدخول والخروج وتبديل الموظف على جوال بمقاسات iPhone (390 و SE 320) × عربي/إنجليزي × فاتح/داكن، على نسخة إنتاج
 * وخادم مُعترَض ببيانات اختبار موسومة. ملاحظة صدق: المحرك Chromium بإعدادات جوال (لمس، حجم، DPR)، لا Safari/جهاز iPhone حقيقي؛ الاختبار على جهاز
 * فعلي شرط قبل أي تفعيل (انظر تقرير الشريحة).
 *
 *   npx next start -p 3012 &
 *   VQA_OUT=/tmp/vqa-pin PLAYWRIGHT_BASE_URL=http://127.0.0.1:3012 npx playwright test -c playwright.visual-qa.config.ts e2e/fuel-ops-station-login.spec.ts
 */
const OUT = process.env.VQA_OUT;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3012';
test.skip(!OUT, 'VQA_OUT is required');

const SIZES = { iphone: { width: 390, height: 844 }, se: { width: 320, height: 568 } } as const;
const HOME = '/fuel-stations/ops';
const LOGIN = '/fuel-stations/ops/login';
const MATRIX: Array<{ size: keyof typeof SIZES; locale: Locale; theme: 'light' | 'dark' }> = [
  { size: 'iphone', locale: 'ar', theme: 'light' },
  { size: 'iphone', locale: 'en', theme: 'dark' },
  { size: 'se', locale: 'ar', theme: 'dark' },
  { size: 'se', locale: 'en', theme: 'light' },
];

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

async function shot(page: Page, rel: string) {
  const file = join(OUT!, `${rel}.png`);
  mkdirSync(join(file, '..'), { recursive: true });
  await page.screenshot({ path: file, fullPage: true });
}

async function audit(page: Page, label: string) {
  const result = await page.evaluate(() => {
    const doc = document.documentElement;
    const small = [...document.querySelectorAll<HTMLElement>('main input, main button, nav a')]
      .filter((el) => el.getClientRects().length > 0 && !el.classList.contains('sr-only')).map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ r }) => r.height < 44 || r.width < 44)
      .map(({ el, r }) => `${el.tagName.toLowerCase()}[${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24)}] ${Math.round(r.width)}x${Math.round(r.height)}`);
    const fonts = [...document.querySelectorAll<HTMLInputElement>('main input')].filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16).map((el) => el.name);
    return { overflow: doc.scrollWidth - doc.clientWidth, small, fonts, dir: doc.dir };
  });
  expect.soft(result.overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(0);
  expect.soft(result.small, `${label}: touch targets under 44px`).toEqual([]);
  expect.soft(result.fonts, `${label}: input font < 16px (iOS zoom)`).toEqual([]);
}

const label = (locale: Locale) => ({
  emp: locale === 'ar' ? /رقم الموظف/ : /Employee number/i,
  pin: locale === 'ar' ? /^رمز PIN$/ : /^PIN$/,
  submit: locale === 'ar' ? 'دخول' : 'Sign in',
  switchEmp: locale === 'ar' ? 'تبديل الموظف' : 'Switch employee',
  logout: locale === 'ar' ? 'تسجيل الخروج' : 'Sign out',
  profile: locale === 'ar' ? 'حسابي' : 'Profile',
});

for (const cell of MATRIX) {
  const tag = `${cell.size}-${cell.locale}-${cell.theme}`;
  test.describe(`${tag} station login`, () => {
    test.use({ viewport: SIZES[cell.size], isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const L = label(cell.locale);

    async function fill(page: Page, no: string, pin: string) {
      await page.getByLabel(L.emp).fill(no);
      await page.getByLabel(L.pin).fill(pin);
    }

    test('unauthenticated → login screen; validation; wrong PIN; success opens the app directly; no ERP call is made', async ({ page }) => {
      const mock = await mockStationLoginApi(page, { baseUrl, locale: cell.locale, theme: cell.theme });
      await page.goto(`${baseUrl}${HOME}`);
      await page.waitForURL(`**${LOGIN}`);
      await settle(page);
      expect(await page.evaluate(() => document.documentElement.dir)).toBe(cell.locale === 'ar' ? 'rtl' : 'ltr');
      await shot(page, `${tag}/01-login`);
      await audit(page, `${tag} login`);
      // لوحة أرقام أصلية + الحقول لا تكبّر الصفحة.
      await expect(page.getByLabel(L.pin)).toHaveAttribute('inputmode', 'numeric');

      await page.getByRole('button', { name: L.submit }).click();
      await expect(page.getByRole('alert').first()).toBeVisible();
      await shot(page, `${tag}/02-validation`);
      expect(mock.logins).toHaveLength(0);

      await fill(page, EMP_A.no, '111111');
      await page.getByRole('button', { name: L.submit }).click();
      await expect(page.locator('[data-login-failure="invalid"]')).toBeVisible();
      await expect(page.getByLabel(L.pin)).toHaveValue('');
      await expect(page.getByLabel(L.emp)).toHaveValue(EMP_A.no);
      await shot(page, `${tag}/03-wrong-pin`);
      await audit(page, `${tag} wrong pin`);

      await page.getByLabel(L.pin).fill(EMP_A.pin);
      await page.getByRole('button', { name: L.submit }).click();
      await page.waitForURL(`**${HOME}`);
      await expect(page.locator('#fo-main')).toBeAttached();
      await settle(page);
      await shot(page, `${tag}/04-home`);
      await audit(page, `${tag} home`);

      expect(mock.forbidden, 'the station session must never call an ERP endpoint').toEqual([]);
      const stored = await page.evaluate(() => ({ user: JSON.parse(localStorage.getItem('station_user') ?? 'null'), dump: JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) }));
      expect(stored.user.station_session).toBe(true);
      expect(stored.dump).not.toContain(EMP_A.pin);
      expect(stored.dump).not.toContain('111111');
    });

    test('shared device: switch employee revokes the first session, signs in the second, and back/ERP URLs do not restore the first', async ({ page }) => {
      const mock = await mockStationLoginApi(page, { baseUrl, locale: cell.locale, theme: cell.theme });
      await page.goto(`${baseUrl}${LOGIN}`);
      await settle(page);
      await fill(page, EMP_A.no, EMP_A.pin);
      await page.getByRole('button', { name: L.submit }).click();
      await page.waitForURL(`**${HOME}`);
      const tokenA = await page.evaluate(() => localStorage.getItem('station_token'));
      expect(tokenA).toBeTruthy();

      await page.goto(`${baseUrl}${HOME}/profile`);
      await settle(page);
      await shot(page, `${tag}/05-profile`);
      await audit(page, `${tag} profile`);
      await page.getByRole('button', { name: L.switchEmp }).click();
      await page.waitForURL(`**${LOGIN}`);
      await settle(page);

      // الجلسة الأولى أُبطلت في الخادم ومُسح الجهاز.
      expect(mock.tokens.has(tokenA as string)).toBe(false);
      expect(mock.calls.some((c) => c.path === '/logout' && c.auth === `Bearer ${tokenA}`)).toBe(true);
      expect(await page.evaluate(() => [localStorage.getItem('station_token'), localStorage.getItem('station_user')])).toEqual([null, null]);
      await shot(page, `${tag}/06-after-switch`);

      // زر الرجوع لا يعيد الموظف الأول.
      await page.goBack();
      await page.waitForURL(`**${LOGIN}`);

      await fill(page, EMP_B.no, EMP_B.pin);
      await page.getByRole('button', { name: L.submit }).click();
      await page.waitForURL(`**${HOME}`);
      await settle(page);
      await expect(page.getByText(mock.names.b).first()).toBeVisible();
      await expect(page.getByText(mock.names.a)).toHaveCount(0);

      // الخروج النهائي.
      await page.goto(`${baseUrl}${HOME}/profile`);
      await settle(page);
      await page.getByRole('button', { name: L.logout }).click();
      await page.waitForURL(`**${LOGIN}`);
      expect(await page.evaluate(() => localStorage.getItem('station_token'))).toBeNull();
      expect(mock.tokens.size).toBe(0);
      expect(mock.forbidden).toEqual([]);
    });

    test('same browser origin: an open AWJ session is neither overwritten nor signed out by PIN login/logout, and is never used implicitly', async ({ page }) => {
      const mock = await mockStationLoginApi(page, { baseUrl, locale: cell.locale, theme: cell.theme });
      const erpUser = JSON.stringify({ id: 'erp-1', name: 'ERP Owner', email: 'o@example.test', role: 'owner', permissions: ['*'], tenant_id: 'FX' });
      await page.addInitScript((u) => { localStorage.setItem('token', 'erp-token'); localStorage.setItem('user', u); localStorage.setItem('nibras_active_branch', 'br-erp'); }, erpUser);

      // لا استعمال ضمني لجلسة أَوْج داخل التطبيق: تبقى شاشة الدخول، مع خيار «المتابعة» الصريح.
      await page.goto(`${baseUrl}${HOME}`);
      await page.waitForURL(`**${LOGIN}`);
      await settle(page);
      await expect(page.getByRole('button', { name: /ERP Owner/ })).toBeVisible();
      await shot(page, `${tag}/08-with-erp-session`);
      await audit(page, `${tag} login with erp hint`);
      expect(mock.calls.filter((c) => c.auth === 'Bearer erp-token')).toEqual([]); // لم يُرسَل توكن أَوْج إلى أي طلب

      await fill(page, EMP_A.no, EMP_A.pin);
      await page.getByRole('button', { name: L.submit }).click();
      await page.waitForURL(`**${HOME}`);
      const afterLogin = await page.evaluate(() => [localStorage.getItem('token'), localStorage.getItem('nibras_active_branch'), JSON.parse(localStorage.getItem('user') ?? 'null')?.id]);
      expect(afterLogin).toEqual(['erp-token', 'br-erp', 'erp-1']);
      expect(mock.calls.filter((c) => c.auth === 'Bearer erp-token')).toEqual([]);

      await page.goto(`${baseUrl}${HOME}/profile`);
      await settle(page);
      await page.getByRole('button', { name: L.logout }).click();
      await page.waitForURL(`**${LOGIN}`);
      const afterLogout = await page.evaluate(() => [localStorage.getItem('station_token'), localStorage.getItem('token'), JSON.parse(localStorage.getItem('user') ?? 'null')?.id]);
      expect(afterLogout).toEqual([null, 'erp-token', 'erp-1']);
      expect(mock.forbidden).toEqual([]);
    });

    test('a station session is not an ERP session: ERP pages see no login and never send the station token', async ({ page }) => {
      const mock = await mockStationLoginApi(page, { baseUrl, locale: cell.locale, theme: cell.theme });
      await page.goto(`${baseUrl}${LOGIN}`);
      await fill(page, EMP_A.no, EMP_A.pin);
      await page.getByRole('button', { name: L.submit }).click();
      await page.waitForURL(`**${HOME}`);

      for (const erp of ['/dashboard', '/invoices', '/pos']) {
        await page.goto(`${baseUrl}${erp}`);
        await page.waitForURL('**/login');
      }
      // التوكن لم يُرسَل من أي صفحة ERP (الخادم الحقيقي يردّه 403 أيضاً)، وجلسة المحطات باقية.
      const sent = mock.calls.filter((c) => c.auth && !c.path.startsWith('/fuel-stations') && !['/me', '/logout', '/station/login'].includes(c.path));
      expect(sent).toEqual([]);
      expect(await page.evaluate(() => localStorage.getItem('station_token'))).not.toBeNull();
    });

    test('too many wrong attempts shows a wait message — never a locked account — and the right PIN still works for another employee', async ({ page }) => {
      const mock = await mockStationLoginApi(page, { baseUrl, locale: cell.locale, theme: cell.theme });
      await page.goto(`${baseUrl}${LOGIN}`);
      await settle(page);
      for (let i = 0; i < 7; i += 1) {
        await fill(page, EMP_A.no, '000111');
        await page.getByRole('button', { name: L.submit }).click();
        await expect(page.locator('[data-login-failure]')).toBeVisible();
      }
      await expect(page.locator('[data-login-failure="throttled"]')).toBeVisible();
      await shot(page, `${tag}/07-throttled`);
      await audit(page, `${tag} throttled`);
      expect(mock.logins).toHaveLength(7);

      await fill(page, EMP_B.no, EMP_B.pin);
      await page.getByRole('button', { name: L.submit }).click();
      await page.waitForURL(`**${HOME}`);
    });
  });
}
