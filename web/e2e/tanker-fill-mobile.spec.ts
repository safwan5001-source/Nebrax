import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  FULL, NO_PICK, NONE, OWNER_ASKAR, OWNER_BAKR, OWNER_CAMEL, TANKER_ASKAR, TANKER_CAMEL_A, VIEW_ONLY,
  mockTankerApi, type Gate, type Locale, type MockOptions, type TankerMock,
} from './support/tanker-fill-mock';

/**
 * TANKER-PR7 — اختبار الجوال الشامل لشاشات تعبئة الصهاريج (الرئيسية ← السجل ← المعالج بخطواته الأربع ← النجاح ← التفاصيل) على محاكاة iPhone 15 Pro Max.
 * يغطي: RTL/LTR، عمودي/أفقي، لوحة المفاتيح (بمحاكاة تقليص الإطار المرئي)، التمرير، الأزرار وأهداف اللمس، التحقق من المدخلات، الانقطاع وإعادة الاتصال والمحاولة المعلّقة،
 * اختلاف الصلاحيات (بما فيها جلسة PIN)، وحالات البوابة (مغلقة/ممنوعة/تعذّر) — كلها بخادم **مُعترَض بالكامل** ببيانات اختبار موسومة.
 * ملاحظة صريحة: Chromium/WebKit بمحاكاة iPhone **ليس** Safari على جهاز حقيقي (انظر `playwright.tanker-fill.config.ts` وتقرير الاختبار).
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';
const SHOTS = join(process.cwd(), 'test-results-tanker', 'shots');
const BASE = '/fuel-stations/ops/tanker-fills';

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

const isLandscape = (info: TestInfo) => info.project.name.endsWith('landscape');
const engineOf = (info: TestInfo) => (info.project.name.startsWith('webkit') ? 'webkit' : 'chromium');

async function shot(page: Page, info: TestInfo, locale: Locale, name: string, fullPage = true) {
  const dir = join(SHOTS, info.project.name);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${locale}-${name}.png`), fullPage, scale: isLandscape(info) ? 'css' : 'device', animations: 'disabled' });
}

type Setup = Partial<Omit<MockOptions, 'baseUrl' | 'locale'>> & { locale?: Locale };
async function go(page: Page, path: string, opts: Setup = {}): Promise<TankerMock> {
  const mock = await mockTankerApi(page, { baseUrl, locale: opts.locale ?? 'en', ...opts });
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
  return mock;
}

/** مشاكل التخطيط الحقيقية على الجوال: تجاوز أفقي، أهداف لمس < 44px، خط الحقول < 16px (تكبير iOS)، أزرار أساسية متعددة، اتجاه الصفحة. */
async function layoutProblems(page: Page, locale: Locale): Promise<string[]> {
  return page.evaluate((loc) => {
    const problems: string[] = [];
    const visible = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    if (document.documentElement.scrollWidth - document.documentElement.clientWidth > 1) problems.push(`horizontal overflow (${document.documentElement.scrollWidth} > ${document.documentElement.clientWidth})`);
    if (document.documentElement.dir !== (loc === 'ar' ? 'rtl' : 'ltr')) problems.push(`dir=${document.documentElement.dir}`);
    for (const el of document.querySelectorAll('nav a, header a, main a, main button, main summary, main [role=radio], main label:has(input[type=checkbox])')) {
      if (!visible(el)) continue;
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.height < 43.5 || r.width < 43.5) problems.push(`tap-target ${el.tagName.toLowerCase()}:${(el.textContent ?? '').trim().slice(0, 28)}:${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    for (const el of document.querySelectorAll('main input[type=text], main input[type=search], main textarea')) {
      if (!visible(el)) continue;
      if (parseFloat(getComputedStyle(el).fontSize) < 16) problems.push(`input font ${parseFloat(getComputedStyle(el).fontSize)}px (${(el as HTMLElement).dataset.testid})`);
    }
    const primaries = [...document.querySelectorAll('[data-primary-action], [data-next], [data-save]')].filter(visible);
    if (primaries.length > 1) problems.push(`more than one primary action (${primaries.length})`);
    for (const el of document.querySelectorAll('img')) if (visible(el) && !el.hasAttribute('alt')) problems.push('img without alt attribute'); // alt="" = زخرفية (صحيح)
    if (document.querySelector('nextjs-portal, [data-next-toast], [data-nextjs-toast]')) problems.push('dev overlay');
    return problems;
  }, locale);
}

/** روابط داخل التطبيق فقط (قاعدة «التطبيق وحده»). */
async function appLinksOnly(page: Page): Promise<string[]> {
  const hrefs = await page.locator('a').evaluateAll((anchors) => anchors.map((a) => a.getAttribute('href') ?? ''));
  return hrefs.filter((href) => !href.startsWith('#') && !href.startsWith('/fuel-stations/ops'));
}

async function check(page: Page, locale: Locale, label: string, mock?: TankerMock) {
  expect(await layoutProblems(page, locale), `layout: ${label}`).toEqual([]);
  expect(await appLinksOnly(page), `links leaving the app: ${label}`).toEqual([]);
  if (mock) expect(mock.issues, `console/page errors: ${label}`).toEqual([]);
}

/** هل الزر قابل للوصول فعلاً (غير مغطّى بالتنقل السفلي) بعد التمرير إليه؟ */
async function reachable(page: Page, selector: string): Promise<boolean> {
  const target = page.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  // المستخدم يمرّر حتى نهاية الصفحة؛ التنقل السفلي ثابت فلا يكفي «ظاهر في الإطار» (scrollIntoViewIfNeeded لا يعرف الشريط الثابت).
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  return target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    return r.bottom <= window.innerHeight + 0.5 && r.top >= -0.5 && !!top && (el === top || el.contains(top));
  });
}

// ───────────────────────── مساعدات المعالج ─────────────────────────

const next = (page: Page) => page.locator('[data-next]');
const save = (page: Page) => page.locator('[data-save]');
const step = (page: Page) => page.locator('[data-step]');

async function pickOwner(page: Page, id: string) { await page.getByTestId(`owner-${id}`).click(); }

async function toNozzleStep(page: Page, ownerId = OWNER_ASKAR, tankerId?: string | 'none') {
  await expect(page.locator('[data-tanker-wizard]')).toBeVisible();
  await pickOwner(page, ownerId);
  if (tankerId) { await expect(page.getByTestId(`tanker-${tankerId}`)).toBeVisible(); await page.getByTestId(`tanker-${tankerId}`).click(); }
  await expect(next(page)).toBeEnabled();
  await next(page).click();
  await expect(step(page)).toHaveAttribute('data-step', 'nozzle');
}

async function toQuantityStep(page: Page, ownerId = OWNER_ASKAR, tankerId?: string | 'none', nozzle = 'nz1') {
  await toNozzleStep(page, ownerId, tankerId);
  await page.getByTestId(`nozzle-${nozzle}`).click();
  await expect(next(page)).toBeEnabled();
  await next(page).click();
  await expect(step(page)).toHaveAttribute('data-step', 'quantity');
}

async function toReview(page: Page, qty: string, voucher: string, ownerId = OWNER_ASKAR, tankerId?: string | 'none') {
  await toQuantityStep(page, ownerId, tankerId);
  await page.getByTestId('quantity-input').fill(qty);
  await page.getByTestId('voucher-input').fill(voucher);
  await expect(next(page)).toBeEnabled();
  await next(page).click();
  await expect(step(page)).toHaveAttribute('data-step', 'review');
}

// ═════════════════════════════ 1) الشاشات والتنقل (الرحلة الكاملة) ═════════════════════════════

for (const locale of ['en', 'ar'] as const) {
  test.describe(`screens & navigation — ${locale}`, () => {
    test('home → list → wizard (4 steps) → success → detail → list, with a screenshot of every screen', async ({ page }, info) => {
      const mock = await go(page, '/fuel-stations/ops', { locale, fills: 3 });

      // الرئيسية: بطاقة الدخول تظهر لأن الخادم (المحاكى) فتح الميزة.
      const entry = page.getByRole('link', { name: new RegExp(t(locale, 'tankerFill.home.title')) });
      await expect(entry).toBeVisible();
      await expect(entry).toHaveAttribute('href', BASE);
      await check(page, locale, 'home', mock);
      await shot(page, info, locale, '01-home');

      await entry.click();
      await expect(page).toHaveURL(new RegExp(`${BASE}$`));
      await expect(page.locator('[data-tanker-list]')).toBeVisible();
      await expect(page.locator('[data-fill-row]')).toHaveCount(3);
      await expect(page.locator('[data-total-count]')).toHaveText('2'); // الملغى لا يُحتسب
      await check(page, locale, 'list', mock);
      await shot(page, info, locale, '02-list');

      await page.locator('[data-primary-action]').click();
      await expect(page).toHaveURL(new RegExp(`${BASE}/new$`));
      await expect(step(page)).toHaveAttribute('data-step', 'owner');
      await expect(next(page)).toBeDisabled();
      await check(page, locale, 'step 1 empty', mock);
      await shot(page, info, locale, '03-step1-owner-empty');

      await pickOwner(page, OWNER_ASKAR);
      await expect(page.getByTestId(`tanker-${TANKER_ASKAR}`)).toHaveAttribute('data-selected', 'true'); // صهريج واحد ⇒ يُختار تلقائياً
      await check(page, locale, 'step 1 picked', mock);
      await shot(page, info, locale, '04-step1-owner-picked');
      await next(page).click();

      await expect(step(page)).toHaveAttribute('data-step', 'nozzle');
      await expect(page.getByTestId('nozzle-nz2')).toBeDisabled(); // مقيَّدة بالبيع المباشر
      await expect(page.getByTestId('nozzle-nz3')).toBeDisabled(); // غير نشطة
      await expect(next(page)).toBeDisabled();
      await check(page, locale, 'step 2 empty', mock);
      await shot(page, info, locale, '05-step2-nozzle');
      await page.getByTestId('nozzle-nz1').click();
      await expect(page.locator('[data-derived]')).toBeVisible();
      await check(page, locale, 'step 2 picked', mock);
      await shot(page, info, locale, '06-step2-nozzle-picked');
      await next(page).click();

      await expect(step(page)).toHaveAttribute('data-step', 'quantity');
      await page.getByTestId('quantity-input').fill('3200.5');
      await page.getByTestId('voucher-input').fill('  04052 ');
      await expect(page.getByText(t(locale, 'tankerFill.voucher.willSave', { value: '04052' }))).toBeVisible();
      await check(page, locale, 'step 3', mock);
      await shot(page, info, locale, '07-step3-quantity');
      await next(page).click();

      await expect(step(page)).toHaveAttribute('data-step', 'review');
      await expect(page.locator('[data-review-voucher]')).toHaveText('04052'); // الأصفار البادئة محفوظة
      await expect(page.locator('[data-review-liters]')).toContainText('3200.500');
      await check(page, locale, 'step 4 review', mock);
      await shot(page, info, locale, '08-step4-review');
      expect(mock.posts).toHaveLength(0); // لا كتابة قبل «حفظ»
      await save(page).click();

      await expect(page.locator('[data-fill-success]')).toBeVisible();
      expect(mock.posts).toHaveLength(1);
      expect(mock.posts[0].body).toMatchObject({ fuel_station_id: 'sa', fuel_shift_id: 'sh1', fuel_nozzle_id: 'nz1', fuel_tanker_owner_id: OWNER_ASKAR, fuel_tanker_id: TANKER_ASKAR, quantity_milliliters: 3_200_500, voucher_number: '04052' });
      expect(Object.keys(mock.posts[0].body).sort()).toEqual(['fuel_nozzle_id', 'fuel_shift_id', 'fuel_station_id', 'fuel_tanker_id', 'fuel_tanker_owner_id', 'idempotency_key', 'quantity_milliliters', 'voucher_number']);
      await expect(page.locator('[data-no-stock-note]')).toBeVisible();
      await check(page, locale, 'success', mock);
      await shot(page, info, locale, '09-success');

      await page.getByRole('link', { name: t(locale, 'tankerFill.success.open') }).click();
      await expect(page.locator('[data-tanker-detail]')).toBeVisible();
      await expect(page.locator('[data-fill-voucher]')).toHaveText('04052');
      await expect(page.locator('[data-fill-number]')).toContainText('FTF-2026-');
      await check(page, locale, 'detail', mock);
      await shot(page, info, locale, '10-detail');

      await page.getByRole('link', { name: t(locale, 'tankerFill.backToList') }).first().click();
      await expect(page.locator('[data-fill-row]')).toHaveCount(4);
      await expect(page.locator('[data-total-count]')).toHaveText('3');
      await shot(page, info, locale, '11-list-after');
      expect(mock.issues).toEqual([]);
      expect(mock.forbidden).toEqual([]);
    });

    test('step navigation: Back keeps the draft, the step bar tracks, browser Back/Reload do not crash', async ({ page }, info) => {
      const mock = await go(page, BASE, { locale });
      await expect(page.locator('[data-tanker-list]')).toBeVisible();
      await page.goto(`${baseUrl}${BASE}/new`);
      await toQuantityStep(page);
      await page.getByTestId('quantity-input').fill('120');
      await page.getByTestId('voucher-input').fill('V-1');
      await page.locator('[data-back]').click();
      await expect(step(page)).toHaveAttribute('data-step', 'nozzle');
      await expect(page.getByTestId('nozzle-nz1')).toHaveAttribute('data-selected', 'true'); // الاختيار محفوظ
      await page.locator('[data-back]').click();
      await expect(step(page)).toHaveAttribute('data-step', 'owner');
      await expect(page.getByTestId(`owner-${OWNER_ASKAR}`)).toHaveAttribute('data-selected', 'true');
      await expect(page.locator('[data-back]')).toHaveCount(0); // لا رجوع قبل الخطوة الأولى
      await next(page).click();
      await next(page).click();
      await expect(page.getByTestId('quantity-input')).toHaveValue('120'); // الكمية محفوظة عبر التنقل
      await shot(page, info, locale, '12-draft-kept', false);

      // رجوع المتصفح من المعالج إلى السجل ثم الأمام: لا انهيار.
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`${BASE}$`));
      await page.goForward();
      await expect(page.locator('[data-tanker-wizard]')).toBeVisible();
      await page.reload();
      await expect(page.locator('[data-tanker-wizard]')).toBeVisible();
      await expect(step(page)).toHaveAttribute('data-step', 'owner'); // المسودة لا تُخزَّن بين التحميلات (لا بيانات ناقصة محفوظة)
      expect(mock.issues).toEqual([]);
    });
  });
}

// ═════════════════════════════ 2) RTL والأرقام والاتجاه ═════════════════════════════

test.describe('RTL / bidi', () => {
  test('arabic: dir=rtl, numerals stay 0–9 and LTR, plates isolated, back arrow mirrored, no physical-direction overflow', async ({ page }, info) => {
    const mock = await go(page, BASE + '/new', { locale: 'ar' });
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('ar');
    await pickOwner(page, OWNER_ASKAR);
    await expect(page.getByTestId(`tanker-${TANKER_ASKAR}`)).toContainText('ABJ 1234');
    const plateBdi = page.getByTestId(`tanker-${TANKER_ASKAR}`).locator('bdi');
    await expect(plateBdi).toHaveText('ABJ 1234');
    // السعة تُعرض بأرقام لاتينية 0–9 ولو كانت الواجهة عربية.
    const capacityText = await page.getByTestId(`tanker-${TANKER_ASKAR}`).innerText();
    expect(capacityText).toMatch(/5,?000/);
    expect(capacityText).not.toMatch(/[٠-٩]/);
    await next(page).click();
    await page.getByTestId('nozzle-nz1').click();
    await next(page).click();

    // الإدخال بأرقام عربية-هندية وفاصلة كسر عربية ⇒ يُحوَّل إلى 0–9 قبل الحفظ.
    await page.getByTestId('quantity-input').fill('٢٠٫٥');
    await page.getByTestId('voucher-input').fill('٠٤٠٥٢');
    await expect(page.getByText(t('ar', 'tankerFill.voucher.willSave', { value: '04052' }))).toBeVisible();
    await next(page).click();
    await expect(page.locator('[data-review-liters]')).toContainText('20.500');
    await expect(page.locator('[data-review-liters]')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('[data-review-voucher]')).toHaveAttribute('dir', 'ltr');
    expect(await page.locator('main').innerText()).not.toMatch(/[٠-٩]/);
    await check(page, 'ar', 'rtl review', mock);
    await shot(page, info, 'ar', '13-rtl-review');
    await save(page).click();
    await expect(page.locator('[data-fill-success]')).toBeVisible();
    expect(mock.posts[0].body).toMatchObject({ quantity_milliliters: 20_500, voucher_number: '04052' });

    // السهم في زر «تفاصيل السند» معكوس في RTL.
    const arrowTransform = await page.locator('a:has(svg)').filter({ hasText: t('ar', 'tankerFill.success.open') }).locator('svg').evaluate((el) => getComputedStyle(el).transform);
    expect(arrowTransform).not.toBe('none');
  });

  test('english: dir=ltr and the arrow is not mirrored', async ({ page }) => {
    await go(page, BASE + '/new', { locale: 'en' });
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('ltr');
  });
});

// ═════════════════════════════ 3) التحقق من المدخلات ═════════════════════════════

test.describe('input validation', () => {
  const QUANTITY_CASES: Array<[string, string]> = [
    ['abc', 'quantity_invalid'],
    ['1,5', 'quantity_invalid'],
    ['1.2.3', 'quantity_invalid'],
    ['-5', 'quantity_negative'],
    ['0', 'quantity_zero'],
    ['0.000', 'quantity_zero'],
    ['1.2345', 'quantity_too_many_decimals'],
    ['99999999', 'quantity_too_large'],
  ];

  test('quantity: every bad value is rejected inline in the user language and blocks Next (no request sent)', async ({ page }, info) => {
    const mock = await go(page, BASE + '/new', { locale: 'en' });
    await toQuantityStep(page);
    await page.getByTestId('voucher-input').fill('V-1');
    for (const [value, problem] of QUANTITY_CASES) {
      await page.getByTestId('quantity-input').fill(value);
      await expect(page.getByRole('alert').filter({ hasText: t('en', `tankerFill.problem.${problem}`) }).first(), `${value} → ${problem}`).toBeVisible();
      await expect(next(page), value).toBeDisabled();
      await expect(page.getByTestId('quantity-input')).toHaveAttribute('aria-invalid', 'true');
    }
    await shot(page, info, 'en', '14-quantity-error', false);
    for (const good of ['0.001', '1', '10.5', '4999.250']) {
      await page.getByTestId('quantity-input').fill(good);
      await expect(next(page), good).toBeEnabled();
    }
    expect(mock.posts).toHaveLength(0);
    expect(mock.issues).toEqual([]);
  });

  test('voucher: leading zeros kept, internal whitespace collapsed, empty/over-64 rejected, numeric keyboard hints correct', async ({ page }) => {
    const mock = await go(page, BASE + '/new', { locale: 'en' });
    await toQuantityStep(page);
    await page.getByTestId('quantity-input').fill('10');
    await expect(page.getByTestId('quantity-input')).toHaveAttribute('inputmode', 'decimal');
    await page.getByTestId('voucher-input').fill('');
    await expect(next(page)).toBeDisabled();
    await page.getByTestId('voucher-input').fill('x'.repeat(65));
    await expect(page.getByRole('alert').filter({ hasText: t('en', 'tankerFill.problem.voucher_too_long') })).toBeVisible();
    await expect(next(page)).toBeDisabled();
    await page.getByTestId('voucher-input').fill('  000 12   ab  ');
    await expect(page.getByText(t('en', 'tankerFill.voucher.willSave', { value: '000 12 ab' }))).toBeVisible();
    await next(page).click();
    await expect(page.locator('[data-review-voucher]')).toHaveText('000 12 ab');
    // الحقل يمنع الإكمال/التصحيح التلقائي (حرفية السند).
    await page.locator('[data-back]').click();
    const voucher = page.getByTestId('voucher-input');
    for (const [attr, value] of [['autocomplete', 'off'], ['autocorrect', 'off'], ['autocapitalize', 'off'], ['spellcheck', 'false']] as const) await expect(voucher).toHaveAttribute(attr, value);
    expect(mock.posts).toHaveLength(0);
  });

  test('steps cannot be skipped: Next is disabled until the step is valid, owner/nozzle can be changed and dependent state resets', async ({ page }) => {
    await go(page, BASE + '/new', { locale: 'en' });
    await expect(next(page)).toBeDisabled();
    await pickOwner(page, OWNER_CAMEL);
    await expect(page.getByTestId(`tanker-${TANKER_CAMEL_A}`)).toBeVisible();
    await expect(page.getByTestId(`tanker-${UIDOFF}`)).toHaveCount(0); // الصهريج الموقوف لا يظهر
    await page.getByTestId(`tanker-${TANKER_CAMEL_A}`).click();
    await pickOwner(page, OWNER_BAKR); // تغيير الصاحب يمسح الصهريج
    await expect(page.getByTestId('tanker-none')).toHaveCount(0); // لا صهاريج لبكر ⇒ ملاحظة بدل خيار
    await expect(page.getByText(t('en', 'tankerFill.tanker.noneRegistered'))).toBeVisible();
    await expect(next(page)).toBeEnabled();
    await pickOwner(page, OWNER_CAMEL);
    await expect(page.getByTestId(`tanker-${TANKER_CAMEL_A}`)).toHaveAttribute('data-selected', 'false');
  });
});
const UIDOFF = '00000000-0000-4000-8000-000000000204';

// ═════════════════════════════ 4) السياسات (الإلزام، السعة، تكرار السند) ═════════════════════════════

test.describe('server policies reflected in the wizard', () => {
  test('tanker selection required: Next blocked until a tanker is chosen, and there is no “without tanker” option', async ({ page }) => {
    await go(page, BASE + '/new', { locale: 'en', policy: { tanker_selection_required: true } });
    await pickOwner(page, OWNER_CAMEL);
    await expect(page.locator('[data-tanker-policy]')).toHaveAttribute('data-tanker-policy', 'required');
    await expect(page.getByTestId('tanker-none')).toHaveCount(0);
    await expect(next(page)).toBeDisabled();
    await expect(page.getByText(t('en', 'tankerFill.problem.tanker_required'))).toBeVisible();
    await page.getByTestId(`tanker-${TANKER_CAMEL_A}`).click();
    await expect(next(page)).toBeEnabled();
  });

  test('optional tanker: “without a tanker” is allowed and sends no tanker id', async ({ page }) => {
    const mock = await go(page, BASE + '/new', { locale: 'en' });
    await toReview(page, '50', 'NT-1', OWNER_CAMEL, 'none');
    await expect(page.getByText(t('en', 'tankerFill.review.noTanker')).first()).toBeVisible();
    await save(page).click();
    await expect(page.locator('[data-fill-success]')).toBeVisible();
    expect(mock.posts[0].body.fuel_tanker_id ?? null).toBeNull();
  });

  test('capacity overrun (allow_with_confirmation): needs the explicit checkbox, the confirmed excess is shown on review and sent', async ({ page }, info) => {
    const mock = await go(page, BASE + '/new', { locale: 'en' });
    await toQuantityStep(page, OWNER_ASKAR, TANKER_ASKAR);
    await page.getByTestId('quantity-input').fill('5600');
    await page.getByTestId('voucher-input').fill('OVR-1');
    await expect(page.locator('[data-capacity="confirm"]')).toBeVisible();
    await expect(next(page)).toBeDisabled();
    await shot(page, info, 'en', '15-capacity-confirm', false);
    await page.locator('[data-confirm-overrun]').check();
    await expect(next(page)).toBeEnabled();
    await next(page).click();
    await expect(page.locator('[data-review-overrun]')).toContainText('600.000');
    await save(page).click();
    await expect(page.locator('[data-fill-success]')).toBeVisible();
    expect(mock.posts[0].body).toMatchObject({ quantity_milliliters: 5_600_000, confirm_capacity_overrun: true });
    // تعديل الكمية يلغي التأكيد السابق.
  });

  test('changing the quantity after confirming the overrun clears the confirmation', async ({ page }) => {
    await go(page, BASE + '/new', { locale: 'en' });
    await toQuantityStep(page, OWNER_ASKAR, TANKER_ASKAR);
    await page.getByTestId('voucher-input').fill('OVR-2');
    await page.getByTestId('quantity-input').fill('5600');
    await page.locator('[data-confirm-overrun]').check();
    await page.getByTestId('quantity-input').fill('5700');
    await expect(page.locator('[data-confirm-overrun]')).not.toBeChecked();
    await expect(next(page)).toBeDisabled();
    await page.getByTestId('quantity-input').fill('4999');
    await expect(page.locator('[data-capacity]')).toHaveCount(0);
    await expect(next(page)).toBeEnabled();
  });

  test('overrun policy block: cannot proceed, message explains, no checkbox', async ({ page }) => {
    await go(page, BASE + '/new', { locale: 'en', policy: { tanker_capacity_overrun_policy: 'block' } });
    await toQuantityStep(page, OWNER_ASKAR, TANKER_ASKAR);
    await page.getByTestId('quantity-input').fill('6000');
    await page.getByTestId('voucher-input').fill('BLK-1');
    await expect(page.locator('[data-capacity="block"]')).toBeVisible();
    await expect(page.locator('[data-confirm-overrun]')).toHaveCount(0);
    await expect(next(page)).toBeDisabled();
  });

  test('overrun policy allow: informational note only, can proceed', async ({ page }) => {
    await go(page, BASE + '/new', { locale: 'en', policy: { tanker_capacity_overrun_policy: 'allow' } });
    await toQuantityStep(page, OWNER_ASKAR, TANKER_ASKAR);
    await page.getByTestId('quantity-input').fill('6000');
    await page.getByTestId('voucher-input').fill('ALW-1');
    await expect(page.locator('[data-capacity="confirm"]')).toHaveCount(0);
    await expect(next(page)).toBeEnabled();
  });

  test('duplicate voucher (server 409): returns to the quantity step with an explanation and nothing is created twice', async ({ page }, info) => {
    const mock = await go(page, BASE + '/new', { locale: 'en', fills: 1 }); // السند V-100 مسجّل مسبقاً
    await toReview(page, '10', 'V-100');
    await save(page).click();
    const notice = page.locator('[data-fill-notice]');
    await expect(notice).toHaveAttribute('data-notice-key', 'tankerFill.reject.voucher_duplicate');
    await expect(step(page)).toHaveAttribute('data-step', 'quantity');
    await shot(page, info, 'en', '16-voucher-duplicate', false);
    expect(mock.fills).toHaveLength(1);
    // تصحيح السند ثم الحفظ ينجح.
    await page.getByTestId('voucher-input').fill('V-101');
    await next(page).click();
    await save(page).click();
    await expect(page.locator('[data-fill-success]')).toBeVisible();
    expect(mock.fills).toHaveLength(2);
    expect(new Set(mock.posts.map((p) => p.body.idempotency_key)).size).toBe(2); // محاولتان بمفتاحين مختلفين (رفض نهائي ⇒ مفتاح جديد)
  });

  test('reject reasons send the attendant back to the right step', async ({ page }) => {
    const mock = await go(page, BASE + '/new', { locale: 'en' });
    mock.controls.fault = { mode: 'reject', times: 1, reason: 'nozzle_operation_not_allowed' };
    await toReview(page, '10', 'RJ-1');
    await save(page).click();
    await expect(page.locator('[data-fill-notice]')).toHaveAttribute('data-notice-key', 'tankerFill.reject.nozzle_operation_not_allowed');
    await expect(step(page)).toHaveAttribute('data-step', 'nozzle');
    mock.controls.fault = { mode: 'reject', times: 1, reason: 'owner_inactive' };
    await next(page).click();
    await next(page).click();
    await save(page).click();
    await expect(step(page)).toHaveAttribute('data-step', 'owner');
    await expect(page.locator('[data-fill-notice]')).toHaveAttribute('data-notice-key', 'tankerFill.reject.owner_inactive');
  });

  test('rate limiting (429) and forbidden (403) from the server are explained, not shown as success', async ({ page }) => {
    const mock = await go(page, BASE + '/new', { locale: 'en' });
    mock.controls.fault = { mode: 'reject', times: 1, status: 429, message: 'Too many' };
    await toReview(page, '10', 'RL-1');
    await save(page).click();
    await expect(page.locator('[data-fill-notice]')).toHaveAttribute('data-notice-key', 'tankerFill.reject.rate_limited');
    mock.controls.fault = { mode: 'reject', times: 1, status: 403, message: 'no' };
    await save(page).click();
    await expect(page.locator('[data-fill-notice]')).toHaveAttribute('data-notice-key', 'tankerFill.reject.forbidden');
    await expect(page.locator('[data-fill-success]')).toHaveCount(0);
  });
});

// ═════════════════════════════ 5) الانقطاع وإعادة الاتصال واسترداد المحاولة المعلّقة ═════════════════════════════

test.describe('offline, reconnect and pending-attempt recovery', () => {
  test('offline before saving: nothing is sent, a clear notice shows, reconnecting lets the same draft save once', async ({ page, context }, info) => {
    const mock = await go(page, BASE + '/new', { locale: 'en' });
    await toReview(page, '25', 'OFF-1');
    await context.setOffline(true);
    // محاكاة navigator.onLine (WebKit يتأخر في تحديثه بعد setOffline).
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await save(page).click();
    await expect(page.locator('[data-fill-notice]')).toBeVisible();
    await expect(page.locator('[data-fill-notice]')).toHaveAttribute('data-notice-key', /tankerFill\.(notSent\.offline|unknown\.network)/);
    await shot(page, info, 'en', '17-offline', false);
    const key = await page.locator('[data-fill-notice]').getAttribute('data-notice-key');
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    if (key === 'tankerFill.notSent.offline') {
      expect(mock.posts).toHaveLength(0); // لم يُرسل شيء أصلاً
      await save(page).click();
      await expect(page.locator('[data-fill-success]')).toBeVisible();
    } else {
      // المتصفح لم يعلن offline قبل الإرسال: غير مؤكد ⇒ تُحسم بالقراءة لا بإعادة إرسال عمياء.
      await page.locator('[data-check-status]').first().click();
      await expect(page.locator('[data-fill-success]')).toBeVisible();
    }
    expect(mock.fills).toHaveLength(1);
    expect(mock.issues).toEqual([]);
  });

  test('request fails before reaching the server → uncertain → Check finds nothing → Resend with the SAME key records exactly one voucher', async ({ page }, info) => {
    const mock = await go(page, BASE + '/new', { locale: 'en' });
    mock.controls.fault = { mode: 'abort_before', times: 1 };
    await toReview(page, '40', 'AB-1');
    await save(page).click();
    await expect(page.locator('[data-pending-attempt] [data-fill-notice]')).toHaveAttribute('data-notice-key', /tankerFill\.unknown\./);
    await shot(page, info, 'en', '18-unknown-notice', false);
    await page.getByRole('button', { name: t('en', 'write.check') }).first().click();
    await expect(page.locator('[data-pending-attempt]')).toBeVisible();
    await expect(page.getByText(t('en', 'tankerFill.pending.notFound'))).toBeVisible();
    await shot(page, info, 'en', '19-pending-notfound');
    expect(mock.fills).toHaveLength(0);
    await page.locator('[data-resend]').click();
    await expect(page.locator('[data-fill-success]')).toBeVisible();
    expect(mock.fills).toHaveLength(1);
    const keys = mock.posts.map((p) => p.body.idempotency_key);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]); // المفتاح نفسه: لا تكرار
  });

  test('reply lost AFTER the server applied it: Check confirms the voucher (no duplicate), even after a full page reload', async ({ page }, info) => {
    const mock = await go(page, BASE + '/new', { locale: 'en' });
    mock.controls.fault = { mode: 'lost_reply', times: 1 };
    await toReview(page, '60', 'LR-1');
    await save(page).click();
    await expect(page.locator('[data-fill-notice]')).toHaveAttribute('data-notice-key', /tankerFill\.unknown\./);
    expect(mock.fills).toHaveLength(1); // الخادم سجّل فعلاً
    // إغلاق الصفحة/إعادة التحميل: المحاولة المعلّقة تبقى (sessionStorage) ولا تُنشأ نسخة ثانية.
    await page.reload();
    await expect(page.locator('[data-pending-attempt]')).toBeVisible();
    await expect(page.locator('[data-save]')).toHaveCount(0); // لا سند جديد قبل حسم القديم
    await shot(page, info, 'en', '20-pending-after-reload');
    await page.locator('button:has-text("' + t('en', 'write.check') + '")').first().click();
    await expect(page.locator('[data-fill-success]')).toBeVisible();
    await expect(page.getByText(t('en', 'tankerFill.success.replayed'))).toBeVisible();
    expect(mock.fills).toHaveLength(1);
    await page.reload();
    await expect(page.locator('[data-pending-attempt]')).toHaveCount(0); // حُسمت ومُسحت
  });

  test('server 503 after applying + the list shows the unresolved-attempt link that returns to the pending panel', async ({ page }) => {
    const mock = await go(page, BASE + '/new', { locale: 'en' });
    mock.controls.fault = { mode: 'server_error', times: 1 };
    await toReview(page, '70', 'S5-1');
    await save(page).click();
    await expect(page.locator('[data-fill-notice]')).toHaveAttribute('data-notice-key', 'tankerFill.unknown.server');
    await page.goto(`${baseUrl}${BASE}`, { waitUntil: 'domcontentloaded' });
    const link = page.locator('[data-pending-link]');
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.locator('[data-pending-attempt]')).toBeVisible();
    await page.locator('button:has-text("' + t('en', 'write.check') + '")').first().click();
    await expect(page.locator('[data-fill-success]')).toBeVisible();
    expect(mock.fills).toHaveLength(1);
  });

  test('Check status itself fails offline, then succeeds after reconnecting', async ({ page, context }) => {
    const mock = await go(page, BASE + '/new', { locale: 'en' });
    mock.controls.fault = { mode: 'lost_reply', times: 1 };
    await toReview(page, '80', 'CK-1');
    await save(page).click();
    await expect(page.locator('[data-fill-notice]')).toHaveAttribute('data-notice-key', /tankerFill\.unknown\./);
    await page.reload();
    await expect(page.locator('[data-pending-attempt]')).toBeVisible();
    await context.setOffline(true);
    mock.controls.offline = true; // الاعتراض يتجاوز محاكاة الشبكة، فنُسقط الطلب صراحةً كما يفعل الجهاز بلا اتصال
    await page.locator('button:has-text("' + t('en', 'write.check') + '")').first().click();
    await expect(page.getByText(t('en', 'tankerFill.pending.checkFailed'))).toBeVisible();
    await context.setOffline(false);
    mock.controls.offline = false;
    await page.locator('button:has-text("' + t('en', 'write.check') + '")').first().click();
    await expect(page.locator('[data-fill-success]')).toBeVisible();
    expect(mock.fills).toHaveLength(1);
  });

  test('check against an older server (no attempt marker) never confirms success', async ({ page }) => {
    const mock = await go(page, BASE + '/new', { locale: 'en', lookupWithoutMarker: true });
    mock.controls.fault = { mode: 'lost_reply', times: 1 };
    await toReview(page, '90', 'OLD-1');
    await save(page).click();
    await page.reload();
    await page.locator('button:has-text("' + t('en', 'write.check') + '")').first().click();
    await expect(page.getByText(t('en', 'tankerFill.pending.checkFailed'))).toBeVisible();
    await expect(page.locator('[data-fill-success]')).toHaveCount(0);
  });

  test('discarding a pending attempt clears it and re-enables recording; resend is blocked while sending', async ({ page }) => {
    const mock = await go(page, BASE + '/new', { locale: 'en' });
    mock.controls.fault = { mode: 'abort_before', times: 1 };
    await toReview(page, '30', 'DS-1');
    await save(page).click();
    await page.getByRole('button', { name: t('en', 'write.check') }).first().click();
    await expect(page.locator('[data-discard]')).toBeVisible();
    await page.locator('[data-discard]').click();
    await expect(page.locator('[data-pending-attempt]')).toHaveCount(0);
    await expect(page.locator('[data-tanker-wizard]')).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-pending-attempt]')).toHaveCount(0);
    expect(mock.fills).toHaveLength(0);
  });

  test('double-tap on Save sends exactly one request (slow server)', async ({ page }) => {
    const mock = await go(page, BASE + '/new', { locale: 'en' });
    mock.controls.fault = { mode: 'slow', times: 1, delayMs: 1200 };
    await toReview(page, '33', 'DT-1');
    const button = save(page);
    await button.dblclick();
    await expect(page.locator('[data-fill-success]')).toBeVisible();
    expect(mock.posts).toHaveLength(1);
    expect(mock.fills).toHaveLength(1);
  });

  test('timeout is not simulated here (25s write timeout is covered by unit tests); loading state shows “Saving…” and disables Save', async ({ page }) => {
    const mock = await go(page, BASE + '/new', { locale: 'en' });
    mock.controls.fault = { mode: 'slow', times: 1, delayMs: 1500 };
    await toReview(page, '34', 'SV-1');
    await save(page).click();
    await expect(page.getByText(t('en', 'tankerFill.review.saving'))).toBeVisible();
    await expect(page.locator('[data-fill-success]')).toBeVisible();
  });

  test('the shift closes while the attendant is on the review step → server says shift_required, wizard reloads the shift and blocks recording', async ({ page }) => {
    const mock = await go(page, BASE + '/new', { locale: 'en' });
    await toReview(page, '35', 'SC-1');
    mock.controls.shiftOpen = false;
    await save(page).click();
    // المعالج يعيد قراءة الوردية فيُستبدل بشاشة «لا وردية مفتوحة» (الرسالة تشرح السبب) ولا يبقى زر حفظ.
    await expect(page.locator('[data-no-open-shift]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-save]')).toHaveCount(0);
    expect(mock.fills).toHaveLength(0);
  });
});

// ═════════════════════════════ 6) الصلاحيات (RBAC) وجلسة PIN ═════════════════════════════

test.describe('permissions', () => {
  test('full permissions: card, list, new — and no request to endpoints outside the app whitelist', async ({ page }) => {
    const mock = await go(page, '/fuel-stations/ops', { locale: 'en' });
    await expect(page.getByRole('link', { name: new RegExp(t('en', 'tankerFill.home.title')) })).toBeVisible();
    await page.goto(`${baseUrl}${BASE}`);
    await expect(page.locator('[data-primary-action]')).toBeVisible();
    expect(mock.forbidden).toEqual([]);
  });

  test('view-only: the list works but there is no “record” button, and /new explains the missing permission without any owner request', async ({ page }, info) => {
    const mock = await go(page, BASE, { locale: 'en', permissions: VIEW_ONLY, fills: 2 });
    await expect(page.locator('[data-fill-row]')).toHaveCount(2);
    await expect(page.locator('[data-primary-action]')).toHaveCount(0);
    await shot(page, info, 'en', '21-view-only-list');
    await page.goto(`${baseUrl}${BASE}/new`);
    await expect(page.getByText(t('en', 'tankerFill.noAccess.title'))).toBeVisible();
    await expect(page.locator('[data-tanker-wizard]')).toHaveCount(0);
    expect(mock.requests.filter((r) => r.path.includes('tanker-owners'))).toEqual([]);
    await shot(page, info, 'en', '22-no-access-new');
  });

  test('can record but cannot read owners (no fuel.tanker.view): wizard is not offered', async ({ page }) => {
    const mock = await go(page, BASE + '/new', { locale: 'en', permissions: NO_PICK });
    await expect(page.getByText(t('en', 'tankerFill.noAccess.title'))).toBeVisible();
    expect(mock.requests.filter((r) => r.path.includes('tanker-owners'))).toEqual([]);
    expect(mock.posts).toEqual([]);
  });

  test('no tanker permissions at all: no home card, list and detail say no access, and no tanker request is ever sent', async ({ page }) => {
    const mock = await go(page, '/fuel-stations/ops', { locale: 'en', permissions: NONE });
    await expect(page.locator('[data-station-id], main').first()).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(t('en', 'tankerFill.home.title')) })).toHaveCount(0);
    await page.goto(`${baseUrl}${BASE}`);
    await expect(page.getByText(t('en', 'tankerFill.noAccess.title'))).toBeVisible();
    await page.goto(`${baseUrl}${BASE}/00000000-0000-4000-8000-000000000999`);
    await expect(page.getByText(t('en', 'tankerFill.noAccess.title'))).toBeVisible();
    expect(mock.requests.filter((r) => r.path.startsWith('/fuel-stations/tanker'))).toEqual([]);
  });

  test('PIN session: full flow works and only whitelisted endpoints are touched; attachments show the PIN note and make no attachment request', async ({ page }, info) => {
    const mock = await go(page, '/fuel-stations/ops', { locale: 'en', pin: true });
    await expect(page.getByRole('link', { name: new RegExp(t('en', 'tankerFill.home.title')) })).toBeVisible();
    await page.goto(`${baseUrl}${BASE}/new`);
    await toReview(page, '45', 'PIN-1');
    await save(page).click();
    await expect(page.locator('[data-fill-success]')).toBeVisible();
    await page.getByRole('link', { name: t('en', 'tankerFill.success.open') }).click();
    await expect(page.locator('[data-attachments-pin]')).toBeVisible();
    await expect(page.locator('[data-attachments-pin]')).toContainText('0');
    await shot(page, info, 'en', '23-pin-detail');
    expect(mock.forbidden).toEqual([]);
    expect(mock.requests.some((r) => /attachments/.test(r.path))).toBe(false);
    expect(mock.issues).toEqual([]);
  });

  test('PIN session without tanker permissions behaves as no-access (server would 403 anyway)', async ({ page }) => {
    const mock = await go(page, BASE, { locale: 'en', pin: true, permissions: NONE });
    await expect(page.getByText(t('en', 'tankerFill.noAccess.title'))).toBeVisible();
    expect(mock.forbidden).toEqual([]);
  });
});

// ═════════════════════════════ 7) البوابات المغلقة وتعذّر الخادم ═════════════════════════════

test.describe('gates (simulated inside the mock only — no production gate is touched)', () => {
  test('gate closed (404): no home card, list/new/detail show “feature not enabled”', async ({ page }, info) => {
    const mock = await go(page, '/fuel-stations/ops', { locale: 'en', gate: 'closed' });
    await expect(page.locator('main').first()).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(t('en', 'tankerFill.home.title')) })).toHaveCount(0);
    await check(page, 'en', 'home gate closed', mock);
    for (const path of [BASE, `${BASE}/new`]) {
      await page.goto(`${baseUrl}${path}`);
      await expect(page.getByText(t('en', 'tankerFill.closed.title'))).toBeVisible();
      await expect(page.locator('[data-primary-action], [data-tanker-wizard]')).toHaveCount(0);
    }
    await shot(page, info, 'en', '24-gate-closed');
    await page.goto(`${baseUrl}${BASE}/00000000-0000-4000-8000-000000000999`);
    await expect(page.getByText(t('en', 'tankerFill.closed.title'))).toBeVisible();
    expect(mock.posts).toEqual([]);
  });

  test('gate forbidden (403 from server): no card; list says no access', async ({ page }) => {
    await go(page, BASE, { locale: 'en', gate: 'forbidden' });
    await expect(page.getByText(t('en', 'tankerFill.noAccess.title'))).toBeVisible();
  });

  test('server down (500): error state with retry; retry recovers when the server is back', async ({ page }, info) => {
    const mock = await go(page, BASE, { locale: 'en', gate: 'down' });
    const retry = page.getByRole('button', { name: /retry|try again|Retry/i }).first();
    await expect(retry).toBeVisible();
    await shot(page, info, 'en', '25-server-down');
    expect(await layoutProblems(page, 'en')).toEqual([]);
    mock.controls.gate = 'open';
    await retry.click();
    await expect(page.locator('[data-tanker-list]')).toBeVisible();
  });

  test('no open shift: list and wizard explain, with a re-check button; no recording is possible', async ({ page }, info) => {
    const mock = await go(page, BASE, { locale: 'en', noShift: true });
    await expect(page.locator('[data-no-open-shift]')).toBeVisible();
    await expect(page.locator('[data-primary-action]')).toHaveCount(0);
    await shot(page, info, 'en', '26-no-shift-list');
    await page.goto(`${baseUrl}${BASE}/new`);
    await expect(page.locator('[data-no-open-shift]')).toBeVisible();
    await shot(page, info, 'en', '27-no-shift-new');
    // فتح الوردية ثم «تحقّق» يعيد المعالج.
    mock.controls.shiftOpen = true;
    await page.getByRole('button', { name: t('en', 'write.check') }).click();
    await expect(page.locator('[data-tanker-wizard]')).toBeVisible();
  });

  test('no eligible nozzle: step 2 explains and cannot continue', async ({ page }, info) => {
    await go(page, BASE + '/new', { locale: 'en', noEligibleNozzle: true });
    await pickOwner(page, OWNER_ASKAR);
    await next(page).click();
    await expect(page.getByText(t('en', 'tankerFill.nozzle.noneTitle'))).toBeVisible();
    await expect(next(page)).toBeDisabled();
    await shot(page, info, 'en', '28-no-nozzle', false);
  });

  test('detail: unknown id → not found; malformed id → not found without a request; other-station fill is not shown', async ({ page }) => {
    const mock = await go(page, `${BASE}/00000000-0000-4000-8000-000000000999`, { locale: 'en' });
    await expect(page.locator('[data-tanker-detail]')).toHaveCount(0);
    await expect(page.getByRole('alert').or(page.getByText(/not found|unavailable|could not/i)).first()).toBeVisible();
    await page.goto(`${baseUrl}${BASE}/not-a-uuid`);
    await expect(page.locator('[data-tanker-detail]')).toHaveCount(0);
    expect(mock.requests.some((r) => r.path.includes('not-a-uuid'))).toBe(false);
  });

  test('empty list state', async ({ page }, info) => {
    await go(page, BASE, { locale: 'en' });
    await expect(page.getByText(t('en', 'tankerFill.list.emptyTitle'))).toBeVisible();
    await shot(page, info, 'en', '29-list-empty');
  });
});

// ═════════════════════════════ 8) التمرير، لوحة المفاتيح، الاتجاه (عمودي/أفقي) ═════════════════════════════

test.describe('scrolling, keyboard and orientation', () => {
  test('long owner list: scrolling works, search narrows with a debounce, a far-down owner can be picked and the step stays usable', async ({ page }, info) => {
    const mock = await go(page, BASE + '/new', { locale: 'en', extraOwners: 40 });
    await expect(page.locator('[data-owner-list] [role=radio]').first()).toBeVisible();
    const last = page.getByTestId(`owner-${'00000000-0000-4000-8000-000000001039'}`);
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeVisible();
    await shot(page, info, 'en', '30-owners-scrolled', false);
    await last.click();
    await expect(last).toHaveAttribute('data-selected', 'true');
    expect(await reachable(page, '[data-next]')).toBe(true);
    // البحث
    await page.getByTestId('owner-search').fill('Fixture Owner 07');
    await expect(page.locator('[data-owner-list] [role=radio]')).toHaveCount(1);
    await page.getByTestId('owner-search').fill('zzzz');
    await expect(page.getByText(t('en', 'tankerFill.owner.noResults'))).toBeVisible();
    // الصاحب المختار يبقى مختاراً نصاً حتى لو خرج من نتائج البحث ⇒ الاستمرار ممكن والمراجعة تعرض «الصاحب المختار».
    await expect(next(page)).toBeEnabled();
    expect(mock.issues).toEqual([]);
  });

  test('slow owners request: loading skeleton shows, then the list', async ({ page }) => {
    await go(page, BASE + '/new', { locale: 'en', slowOwners: 1500 });
    await expect(page.locator('[data-owner-list]')).toBeVisible();
    await expect(page.getByTestId(`owner-${OWNER_ASKAR}`)).toBeVisible({ timeout: 20_000 });
  });

  test('keyboard open (visual viewport shrunk): focused quantity/voucher inputs stay visible, Next stays reachable, Enter does not submit', async ({ page }, info) => {
    const mock = await go(page, BASE + '/new', { locale: 'en' });
    await toQuantityStep(page);
    const full = page.viewportSize()!;
    // لوحة مفاتيح iOS تقتطع نحو 40% من الارتفاع؛ نحاكيها بتقليص الإطار (لا بديل عن اختبار الجهاز الحقيقي).
    await page.setViewportSize({ width: full.width, height: Math.round(full.height * 0.55) });
    for (const id of ['quantity-input', 'voucher-input']) {
      const input = page.getByTestId(id);
      await input.focus();
      await input.scrollIntoViewIfNeeded();
      const box = (await input.boundingBox())!;
      const vh = page.viewportSize()!.height;
      expect(box.y >= 0 && box.y + box.height <= vh, `${id} inside visible area`).toBe(true);
    }
    await page.getByTestId('quantity-input').fill('12');
    await page.getByTestId('quantity-input').press('Enter');
    expect(mock.posts).toHaveLength(0);
    await page.getByTestId('voucher-input').fill('KB-1');
    expect(await reachable(page, '[data-next]')).toBe(true);
    await shot(page, info, 'en', '31-keyboard-shrunk', false);
    await page.setViewportSize(full);
    await next(page).click();
    await expect(step(page)).toHaveAttribute('data-step', 'review');
  });

  test('rotating portrait ↔ landscape mid-wizard keeps the draft and never causes horizontal overflow', async ({ page }, info) => {
    const mock = await go(page, BASE + '/new', { locale: 'ar' });
    await toQuantityStep(page);
    await page.getByTestId('quantity-input').fill('77.25');
    await page.getByTestId('voucher-input').fill('ROT-1');
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: size.height, height: size.width });
    await expect(page.getByTestId('quantity-input')).toHaveValue('77.25');
    expect(await layoutProblems(page, 'ar'), 'after rotate').toEqual([]);
    await shot(page, info, 'ar', '32-rotated', false);
    await page.setViewportSize(size);
    await expect(page.getByTestId('voucher-input')).toHaveValue('ROT-1');
    expect(await layoutProblems(page, 'ar'), 'rotated back').toEqual([]);
    expect(mock.issues).toEqual([]);
  });

  test('bottom navigation never covers the primary action at the end of every wizard step', async ({ page }) => {
    await go(page, BASE + '/new', { locale: 'en' });
    await pickOwner(page, OWNER_ASKAR);
    expect(await reachable(page, '[data-next]'), 'step 1').toBe(true);
    await next(page).click();
    await page.getByTestId('nozzle-nz1').click();
    expect(await reachable(page, '[data-next]'), 'step 2').toBe(true);
    await next(page).click();
    await page.getByTestId('quantity-input').fill('5600');
    await page.getByTestId('voucher-input').fill('NAV-1');
    await page.locator('[data-confirm-overrun]').check();
    expect(await reachable(page, '[data-next]'), 'step 3').toBe(true);
    await next(page).click();
    expect(await reachable(page, '[data-save]'), 'step 4').toBe(true);
  });

  test('landscape/portrait list + detail with many rows: layout stays clean and rows are scrollable', async ({ page }, info) => {
    const mock = await go(page, BASE, { locale: 'en', fills: 14 });
    await expect(page.locator('[data-fill-row]')).toHaveCount(14);
    await check(page, 'en', 'long list', mock);
    await page.locator('[data-fill-row]').last().scrollIntoViewIfNeeded();
    await shot(page, info, 'en', '33-long-list');
    await page.locator('[data-fill-row] a').last().click();
    await expect(page.locator('[data-tanker-detail]')).toBeVisible();
    await check(page, 'en', 'detail of last row', mock);
  });

  test('focus rings: keyboard Tab reaches Next and a visible focus indicator exists (external keyboard on iPad/iPhone)', async ({ page }, info) => {
    test.skip(engineOf(info) === 'webkit', 'WebKit Tab order skips buttons unless the OS “full keyboard access” setting is on — verified on Chromium only');
    await go(page, BASE + '/new', { locale: 'en' });
    await pickOwner(page, OWNER_ASKAR);
    let found = false;
    for (let i = 0; i < 25 && !found; i += 1) {
      await page.keyboard.press('Tab');
      found = await page.evaluate(() => document.activeElement?.hasAttribute('data-next') ?? false);
    }
    expect(found).toBe(true);
    const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement as Element); return `${s.outlineStyle}|${s.boxShadow}`; });
    expect(ring).not.toBe('none|none');
  });
});

// ═════════════════════════════ 9) الوضع الداكن ═════════════════════════════

test.describe('dark theme', () => {
  test('wizard and list render in dark theme without layout problems', async ({ page }, info) => {
    const mock = await go(page, BASE, { locale: 'ar', theme: 'dark', fills: 3 });
    await expect(page.locator('[data-tanker-list]')).toBeVisible();
    await check(page, 'ar', 'dark list', mock);
    await shot(page, info, 'ar', '34-dark-list');
    await page.goto(`${baseUrl}${BASE}/new`);
    await pickOwner(page, OWNER_ASKAR);
    await check(page, 'ar', 'dark wizard', mock);
    await shot(page, info, 'ar', '35-dark-wizard');
  });
});

export type { Gate };
