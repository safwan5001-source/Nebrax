import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { mockUi2Api, type Locale, type Seed } from './support/fuel-ops-ui2-mock';

/**
 * FUEL-OPS UI-2 — رحلة البائع الكاملة داخل تطبيق «محطات أَوْج» في متصفح حقيقي (Chromium بمقاس آيفون 390×844 + سطح المكتب):
 * فتح الوردية ← قراءات البداية (عدادات + خزانات) ← قراءات النهاية ← حركة نقد ← عدّ النقد والتسليم.
 * الخادم مُعترَض بالكامل ببيانات اختبار موسومة وبحالة تحاكي قواعد الخادم (انظر `support/fuel-ops-ui2-mock.ts`)؛ لا خلفية ولا بيانات حقيقية.
 * يتحقق من: الطلبات الفعلية (القائمة البيضاء، الحمولات الصحيحة، لا غيرها)، الحالات الصادقة (ردّ ضائع، رفض، انقطاع)، وسلامة التخطيط على الجوال
 * (تجاوز أفقي، أهداف اللمس ≥ 44px، خط الحقول ≥ 16px، شريط الإجراء فوق التنقل السفلي، روابط داخل التطبيق فقط).
 * هذا لا يغني عن اختبار Safari/iPhone الحقيقي (انظر VISUAL_QA_REPORT_UI_2.md).
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const WHITELIST = /^\/fuel-stations\/shifts\/(open|[\w-]+\/(staff|meter-readings|tank-readings|cash-movements|close))$/;

type Tree = { [key: string]: string | Tree };
const MESSAGES: Record<Locale, Tree> = {
  en: (JSON.parse(readFileSync(join(process.cwd(), 'src/messages/en.json'), 'utf8')) as { stationOps: Tree }).stationOps,
  ar: (JSON.parse(readFileSync(join(process.cwd(), 'src/messages/ar.json'), 'utf8')) as { stationOps: Tree }).stationOps,
};
/** النص كما في ملف الرسائل نفسه (فيبقى الاختبار مرتبطاً بالنسخة المعتمدة في اللغتين). */
function t(locale: Locale, key: string, vars: Record<string, string> = {}): string {
  let node: string | Tree = MESSAGES[locale];
  for (const part of key.split('.')) node = (node as Tree)[part];
  if (typeof node !== 'string') throw new Error(`missing message ${key}`);
  return Object.entries(vars).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), node);
}

async function go(page: Page, path: string, opts: { locale?: Locale; theme?: 'light' | 'dark'; seed?: Seed; permissions?: string[]; policy?: Record<string, boolean> } = {}) {
  const mock = await mockUi2Api(page, { baseUrl, locale: opts.locale ?? 'en', theme: opts.theme ?? 'light', seed: opts.seed, permissions: opts.permissions, policy: opts.policy });
  await page.goto(`${baseUrl}/fuel-stations/ops${path}`, { waitUntil: 'domcontentloaded' });
  return mock;
}

/** فحص تخطيط الشاشة الحالية؛ يعيد قائمة المخالفات (فارغة = سليمة). */
async function layoutProblems(page: Page, isMobile: boolean): Promise<string[]> {
  return page.evaluate((mobile) => {
    const problems: string[] = [];
    if (document.documentElement.scrollWidth - document.documentElement.clientWidth > 1) problems.push('horizontal overflow');
    for (const el of document.querySelectorAll('nav a, header a, header select, main a, main button, main select, main summary, [role=dialog] button, [role=dialog] label:has(input[type=checkbox]), [role=dialog] label:has(input[type=radio])')) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width > 0 && (r.height < 43.5 || r.width < 43.5)) problems.push(`target ${el.tagName.toLowerCase()}:${(el.textContent ?? '').trim().slice(0, 24)}:${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    for (const el of document.querySelectorAll('main input[type=text], main textarea, [role=dialog] input[type=text], [role=dialog] textarea')) {
      const style = getComputedStyle(el);
      if (parseFloat(style.fontSize) < 16) problems.push(`font ${parseFloat(style.fontSize)}px on ${(el as HTMLElement).dataset.testid ?? el.tagName}`);
      if ((el as HTMLElement).getBoundingClientRect().height < 43.5) problems.push(`input height ${(el as HTMLElement).dataset.testid}`);
    }
    const bar = document.querySelector('[data-action-bar]') as HTMLElement | null;
    const nav = document.querySelector('nav[aria-label]') as HTMLElement | null;
    if (mobile && bar && nav && bar.getBoundingClientRect().bottom > nav.getBoundingClientRect().top + 1) problems.push('action bar is covered by the bottom navigation');
    if (document.querySelector('nextjs-portal, [data-next-toast], [data-nextjs-toast]')) problems.push('dev overlay');
    const dialogs = document.querySelectorAll('[role=dialog]');
    const visiblePrimary = [...document.querySelectorAll('[data-primary-action]')].filter((el) => (el as HTMLElement).getBoundingClientRect().width > 0 && (dialogs.length === 0 ? true : !!el.closest('[role=dialog]')));
    if (visiblePrimary.length > 1) problems.push(`more than one primary action (${visiblePrimary.length})`);
    return problems;
  }, isMobile);
}

async function appLinksOnly(page: Page): Promise<string[]> {
  const hrefs = await page.locator('a').evaluateAll((anchors) => anchors.map((a) => a.getAttribute('href') ?? ''));
  return hrefs.filter((href) => !href.startsWith('#') && !href.startsWith('/fuel-stations/ops'));
}

const openingOf = (i: number) => 125_430 + i * 13_700 + i * 0.25; // يطابق خادم الاختبار: آخر إغلاق مسجّل في الوردية السابقة
const delta = (i: number) => 640 + i * 37 + 0.5;

for (const locale of ['en', 'ar'] as const) {
  test.describe(`seller journey — ${locale}`, () => {
    test('open → starting readings → ending readings → cash entry → handover, all inside the app, nothing but the six allowed writes', async ({ page }, info) => {
      const mobile = info.project.name === 'mobile';
      const mock = await go(page, '', { locale });
      expect(await page.evaluate(() => document.documentElement.dir)).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      const check = async (label: string) => {
        expect(await layoutProblems(page, mobile), label).toEqual([]);
        expect(await appLinksOnly(page), `${label}: links leaving the app`).toEqual([]);
      };

      // 1) الرئيسية: لا وردية مفتوحة ⇒ زر أساسي واحد لفتحها
      const home = page.locator('[data-primary-action]');
      await expect(home).toHaveCount(1);
      await expect(home).toHaveText(t(locale, 'next.kind.open_shift'));
      await check('home');
      await home.click();

      // 2) فتح الوردية: لا افتراض لعهدة الافتتاح، ثم تأكيد صريح
      await expect(page).toHaveURL(/\/fuel-stations\/ops\/shifts\/open$/);
      const float = page.getByTestId('open-float');
      await expect(float).toHaveValue('');
      await expect(page.getByRole('button', { name: t(locale, 'openShift.review') })).toBeDisabled();
      await float.fill('500');
      await check('open form');
      await page.getByRole('button', { name: t(locale, 'openShift.review') }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      expect(mock.posts).toHaveLength(0);
      await check('open confirm');
      await dialog.getByRole('button', { name: t(locale, 'openShift.confirm') }).click();
      await expect(page.getByText(t(locale, 'openShift.success', { number: 'SH-NEW-1' }))).toBeVisible();
      await expect(page.getByText(t(locale, 'openShift.staff.done'))).toBeVisible();
      await check('open success');
      expect(mock.posts.map((p) => p.path)).toEqual(['/fuel-stations/shifts/open', '/fuel-stations/shifts/new-1/staff']);
      expect(mock.posts[0].body).toMatchObject({ fuel_station_id: 'sa', opening_float_minor: 50_000 });

      // 3) قراءات البداية: 6 فوهات + 3 خزانات، Enter ينقل للحقل التالي
      await page.getByRole('link', { name: t(locale, 'openShift.goReadings') }).click();
      await expect(page).toHaveURL(/\/readings\/opening$/);
      const inputs = page.locator('[data-entry-input]');
      await expect(inputs).toHaveCount(9);
      await expect(page.getByText(t(locale, 'entry.previous', { value: '125,430.000', shift: 'SH-0999' }))).toBeVisible();
      await check('opening readings (empty)');
      for (let i = 0; i < 6; i += 1) await inputs.nth(i).fill(String(openingOf(i)));
      for (let i = 0; i < 3; i += 1) await inputs.nth(6 + i).fill(String(24_000 - i * 1_000));
      await inputs.first().press('Enter');
      expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe(await inputs.nth(1).getAttribute('data-testid'));
      await check('opening readings (filled)');
      await page.getByRole('button', { name: t(locale, 'entry.footer.review', { count: '9' }) }).click();
      await expect(page.getByRole('dialog').getByText(t(locale, 'entry.review.intro'))).toBeVisible();
      await check('opening review');
      await page.getByRole('dialog').getByRole('button', { name: t(locale, 'entry.review.confirm') }).click();
      await expect(page.getByText(t(locale, 'entry.done.title.opening'))).toBeVisible();
      await check('opening done');
      expect(mock.posts.filter((p) => p.path.endsWith('/meter-readings'))).toHaveLength(6);
      expect(mock.posts.filter((p) => p.path.endsWith('/tank-readings'))).toHaveLength(3);
      expect(mock.posts.find((p) => p.path.endsWith('/meter-readings'))!.body).toMatchObject({ reading_stage: 'opening', meter_milliliters: 125_430_000, evidence_key: 'awj-ops:m:new-1:n01:opening' });

      // 4) الوردية: الخطوة التالية صارت قراءات النهاية، بزر أساسي واحد
      await page.getByRole('link', { name: t(locale, 'entry.done.next.opening') }).click();
      await expect(page).toHaveURL(/\/fuel-stations\/ops\/shifts\/new-1$/);
      const next = page.locator('[data-next-step]');
      await expect(next).toHaveAttribute('data-next-step', 'closing_readings');
      await expect(page.locator('[data-primary-action]')).toHaveCount(1);
      await check('shift details');
      await next.getByRole('link').click();

      // 5) قراءات النهاية: إغلاق < افتتاح يُحجب قبل أي إرسال، ثم القيم الصحيحة
      await expect(page).toHaveURL(/\/readings\/closing$/);
      await inputs.first().fill('1');
      await expect(page.getByText(t(locale, 'entry.error.closing_below_opening', { opening: '125,430.000' }))).toBeVisible();
      await expect(page.locator('[data-action-bar] button')).toBeDisabled();
      const before = mock.posts.length;
      await check('closing blocked');
      for (let i = 0; i < 6; i += 1) await inputs.nth(i).fill(String(openingOf(i) + delta(i)));
      for (let i = 0; i < 3; i += 1) await inputs.nth(6 + i).fill(String(21_300 - i * 500));
      await page.getByRole('button', { name: t(locale, 'entry.footer.review', { count: '9' }) }).click();
      await page.getByRole('dialog').getByRole('button', { name: t(locale, 'entry.review.confirm') }).click();
      await expect(page.getByText(t(locale, 'entry.done.title.closing'))).toBeVisible();
      expect(mock.posts.length - before).toBe(9);
      await page.getByRole('link', { name: t(locale, 'entry.done.next.closing') }).click();

      // 6) التسليم: جاهزية ← حركة نقد ← عدّ ← تأكيد محمي
      await expect(page).toHaveURL(/\/handover$/);
      await expect(page.getByText(t(locale, 'handover.readiness.ok'))).toBeVisible();
      await expect(page.locator('[data-network-blocked]')).toContainText(t(locale, 'handover.network.body'));
      await check('handover');
      await page.locator('[data-open-movement]').click();
      const sheet = page.getByRole('dialog');
      await sheet.getByLabel(t(locale, 'handover.movement.types.cash_out')).check({ force: true });
      await sheet.getByTestId('movement-amount').fill('10');
      await sheet.getByLabel(t(locale, 'handover.movement.reason')).fill('Change for the drawer');
      await check('cash movement');
      await sheet.getByRole('button', { name: t(locale, 'handover.movement.confirm') }).click();
      await expect(page.getByText(t(locale, 'handover.movement.saved'))).toBeVisible();
      await expect(page.locator('[data-expected]')).toContainText('490.00');
      await page.getByTestId('counted-cash').fill('490');
      await expect(page.locator('[data-variance-preview]')).toContainText(t(locale, 'handover.summary.direction.none'));
      await check('handover counted');
      await page.getByRole('button', { name: t(locale, 'handover.review') }).click();
      const confirm = page.getByRole('dialog');
      await expect(confirm.getByRole('button', { name: t(locale, 'handover.confirm.cta') })).toBeDisabled();
      await check('handover confirm');
      await confirm.getByRole('checkbox').check();
      await confirm.getByRole('button', { name: t(locale, 'handover.confirm.cta') }).click();
      await expect(page.getByText(t(locale, 'handover.done.title'))).toBeVisible();
      await check('handover done');

      // 7) الحصيلة: GET/POST فقط، كل POST ضمن القائمة البيضاء، بلا اعتماد/مبيعات، ولا أخطاء كونسول
      expect(mock.requests.filter((r) => r.method !== 'GET' && r.method !== 'POST')).toEqual([]);
      for (const post of mock.posts) expect(post.path, post.path).toMatch(WHITELIST);
      expect(mock.posts.filter((p) => p.path.endsWith('/close'))).toHaveLength(1);
      expect(mock.posts.find((p) => p.path.endsWith('/close'))!.body).toEqual({ counted_cash_minor: 49_000 });
      expect(mock.posts.some((p) => /approve|sales|payments/.test(p.path))).toBe(false);
      expect(mock.shifts.get('new-1')!.status).toBe('closed');
      expect(mock.issues).toEqual([]);
      if (locale === 'ar') expect(await page.locator('#fo-main').innerText()).not.toMatch(/[٠-٩]/);
    });
  });
}

test.describe('honest states', () => {
  test('a lost reply on opening is not success: it is flagged, "check" finds the shift, and nothing is sent twice', async ({ page }) => {
    const mock = await go(page, '/shifts/open');
    mock.controls.fault = { match: /\/open$/, mode: 'lost_reply', times: 1 };
    await page.getByTestId('open-float').fill('500');
    await page.getByRole('button', { name: t('en', 'openShift.review') }).click();
    await page.getByRole('dialog').getByRole('button', { name: t('en', 'openShift.confirm') }).click();
    await expect(page.getByText(t('en', 'write.unknown.network'))).toBeVisible();
    await expect(page.getByText(t('en', 'openShift.success', { number: 'SH-NEW-1' }))).toHaveCount(0);
    await page.getByRole('button', { name: t('en', 'write.check') }).click();
    await expect(page.getByText(t('en', 'openShift.alreadyOpen.title'))).toBeVisible();
    expect(mock.posts.filter((p) => p.path.endsWith('/open'))).toHaveLength(1);
  });

  test('a forbidden write and a server refusal each get their own plain message', async ({ page }) => {
    const mock = await go(page, '/shifts/open');
    mock.controls.fault = { match: /\/open$/, mode: 'forbidden', times: 1 };
    await page.getByTestId('open-float').fill('500');
    await page.getByRole('button', { name: t('en', 'openShift.review') }).click();
    await page.getByRole('dialog').getByRole('button', { name: t('en', 'openShift.confirm') }).click();
    await expect(page.getByText(t('en', 'write.reject.forbidden'))).toBeVisible();
    mock.controls.fault = { match: /\/open$/, mode: 'reject', message: 'توجد وردية وقود مفتوحة للمحطة؛ يجب إغلاقها أو تصحيحها عبر المسار المدقق أولاً.', times: 1 };
    await page.getByRole('button', { name: t('en', 'openShift.review') }).click();
    await page.getByRole('dialog').getByRole('button', { name: t('en', 'openShift.confirm') }).click();
    await expect(page.getByText(t('en', 'write.reject.shift_already_open'))).toBeVisible();
  });

  test('offline: the confirmation sends nothing and says so; the offline banner is visible', async ({ page, context }) => {
    const mock = await go(page, '/shifts/open');
    await page.getByTestId('open-float').fill('500');
    await page.getByRole('button', { name: t('en', 'openShift.review') }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.getByRole('dialog').getByRole('button', { name: t('en', 'openShift.confirm') }).click();
    await expect(page.getByText(t('en', 'write.notSent.offline'))).toBeVisible();
    await expect(page.getByText(t('en', 'offlineBanner'))).toBeVisible();
    expect(mock.posts).toHaveLength(0);
    await context.setOffline(false);
  });

  test('closing a shift whose reply was lost is never re-sent: "check" shows it handed over', async ({ page }) => {
    const mock = await go(page, '/shifts/s-open/handover', { seed: 'ready' });
    mock.controls.fault = { match: /\/close$/, mode: 'lost_reply', times: 1 };
    await page.getByTestId('counted-cash').fill('500');
    await page.getByRole('button', { name: t('en', 'handover.review') }).click();
    await page.getByRole('dialog').getByRole('checkbox').check();
    await page.getByRole('dialog').getByRole('button', { name: t('en', 'handover.confirm.cta') }).click();
    await expect(page.getByText(t('en', 'write.unknown.network'))).toBeVisible();
    await expect(page.getByText(t('en', 'handover.done.title'))).toHaveCount(0);
    await page.getByRole('button', { name: t('en', 'write.check') }).click();
    await expect(page.getByText(t('en', 'handover.done.alreadyTitle'))).toBeVisible();
    expect(mock.posts.filter((p) => p.path.endsWith('/close'))).toHaveLength(1);
  });

  test('a server policy refusal on handover keeps the shift open and explains it', async ({ page }) => {
    const mock = await go(page, '/shifts/s-open/handover', { seed: 'ready' });
    mock.controls.fault = { match: /\/close$/, mode: 'reject', message: 'سياسة المحطة تتطلب إسناد عامل واحد على الأقل قبل إغلاق الشفت.', times: 1 };
    await page.getByTestId('counted-cash').fill('500');
    await page.getByRole('button', { name: t('en', 'handover.review') }).click();
    await page.getByRole('dialog').getByRole('checkbox').check();
    await page.getByRole('dialog').getByRole('button', { name: t('en', 'handover.confirm.cta') }).click();
    await expect(page.getByText(t('en', 'write.reject.close_needs_staff'))).toBeVisible();
    expect(mock.shifts.get('s-open')!.status).toBe('open');
  });

  test('missing readings block the handover and point to where they are recorded', async ({ page }) => {
    const mock = await go(page, '/shifts/s-open/handover', { seed: 'open-opened' });
    await expect(page.getByText(t('en', 'handover.readiness.meterClosing'))).toBeVisible();
    await page.getByTestId('counted-cash').fill('500');
    await expect(page.getByRole('button', { name: t('en', 'handover.review') })).toBeDisabled();
    await expect(page.getByRole('link', { name: t('en', 'handover.readiness.fix') }).first()).toHaveAttribute('href', /\/readings\/closing$/);
    expect(mock.posts).toHaveLength(0);
  });

  test('a user without the permissions sees why, and the home offers no write action', async ({ page }) => {
    const mock = await go(page, '/shifts/open', { permissions: ['fuel_stations.view', 'fuel.shift.view'] });
    await expect(page.getByText(t('en', 'openShift.noPermission.title'))).toBeVisible();
    await go(page, '', { permissions: ['fuel_stations.view', 'fuel.shift.view'] });
    await expect(page.locator('[data-primary-action]')).toHaveCount(0);
    expect(mock.posts).toHaveLength(0);
  });
});
