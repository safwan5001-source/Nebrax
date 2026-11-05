import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockOpsApi, type Locale } from './support/fuel-ops-ui1-mock';

/**
 * FUEL-OPS #2021 — «ملخص النقد» (D1/D2/D5) في متصفح حقيقي: RTL/LTR، الأرقام 0–9 فقط، آيفون 390 و320، لا تجاوز أفقي،
 * الصدق في العناوين (متوقع غير مكتمل ≠ إجمالي، فرق غير نهائي ≠ زيادة/عجز، غير متاح ≠ صفر)، وGET فقط.
 * الخادم مُعترَض بالكامل ببيانات Fixture؛ لا بيانات محطة حقيقية. هذا لا يغني عن اختبار Safari/iPhone الحقيقي.
 * اللقطات تُحفظ في docs/fuel-stations/visual-qa/cash-summary عند `CASH_SUMMARY_SHOTS=1`.
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3012';
const SHOTS = process.env.CASH_SUMMARY_SHOTS === '1';
const shotDir = '../docs/fuel-stations/visual-qa/cash-summary';

type Cash = Record<string, unknown>;

const complete = (over: Cash = {}): Cash => ({
  state: 'frozen',
  basis: 'receiving_shift_receipts',
  components: {
    opening_float_minor: 20_000,
    official_cash_receipts: { available: true, amount_minor: 100_000, count: 4, reason: null },
    cash_in_minor: 0, cash_out_minor: 10_000, treasury_handover_minor: 10_000, expenses_minor: 0,
  },
  expected_cash_minor: 110_000, expected_cash_partial_minor: 110_000, expected_complete: true, incompleteness: [],
  counted_cash_minor: 109_000, variance_minor: -1_000, variance_final: true,
  network_receipts: { available: true, amount_minor: 45_000, reason: null, information_only: true },
  unattributed_cash_receipts: null,
  post_close_adjustments: { available: true, items: [{ payment_id: 'fx-p1', amount_minor: 2_300, occurred_at: null }], net_effect_minor: -2_300 },
  ...over,
});

const incomplete = (): Cash => complete({
  state: 'live', expected_cash_minor: null, expected_cash_partial_minor: 20_000, expected_complete: false,
  incompleteness: ['unattributed_cash_receipts', 'sales_cash_not_included'],
  counted_cash_minor: 15_000, variance_minor: -5_000, variance_final: false,
  unattributed_cash_receipts: { count: 2, amount_minor: 5_000 },
  post_close_adjustments: { available: true, items: [], net_effect_minor: 0 },
});

const restricted = (): Cash => complete({
  state: 'live',
  components: { opening_float_minor: 20_000, official_cash_receipts: { available: false, amount_minor: null, count: null, reason: 'permission' }, cash_in_minor: 0, cash_out_minor: 0, treasury_handover_minor: 0, expenses_minor: 0 },
  expected_cash_minor: null, expected_cash_partial_minor: 20_000, expected_complete: false, incompleteness: ['permission_sales_view'],
  counted_cash_minor: null, variance_minor: null, variance_final: false,
  network_receipts: { available: false, amount_minor: null, reason: 'permission', information_only: true },
  post_close_adjustments: { available: false, items: [], net_effect_minor: null },
});

async function open(page: Page, locale: Locale, cash: Cash, id = 'h2') {
  const mock = await mockOpsApi(page, { baseUrl, locale, theme: 'light' });
  (mock.data.details[id] as Record<string, unknown>).cash_summary = cash;
  await page.goto(`${baseUrl}/fuel-stations/ops/shifts/${id}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-cash-summary]').waitFor();
  return mock;
}

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(shotDir, { recursive: true });
  await page.locator('[data-cash-summary]').screenshot({ path: `${shotDir}/${name}.png` });
}

for (const locale of ['en', 'ar'] as const) {
  const ar = locale === 'ar';
  test.describe(`cash summary — ${locale}`, () => {
    test('complete frozen summary: components, total, named variance, network for information, after-close warning, GET only', async ({ page }, info) => {
      const mock = await open(page, locale, complete());
      expect(await page.evaluate(() => document.documentElement.dir)).toBe(ar ? 'rtl' : 'ltr');
      const section = page.locator('[data-cash-summary="frozen"]');
      await expect(section).toContainText(ar ? 'ملخص النقد' : 'Cash summary');
      await expect(section.locator('[data-cash-row="expected"]')).toContainText(ar ? 'النقد المتوقع' : 'Expected cash');
      await expect(section.locator('[data-cash-row="expected"]')).not.toContainText(ar ? 'غير مكتمل' : 'incomplete');
      await expect(section.locator('[data-cash-row="variance"]')).toContainText(ar ? 'عجز' : 'Shortage');
      await expect(section.locator('[data-cash-row="network"]')).toContainText(ar ? 'للعلم' : 'for information');
      await expect(section).toContainText(ar ? 'عُكس 1 تحصيل نقدي بعد إغلاق' : '1 cash collection(s) were reversed after this shift closed');
      const text = await section.innerText();
      expect(text).not.toMatch(/[٠-٩]/); // الأرقام 0–9 فقط
      expect(text).toMatch(/1,?100\.00/);
      expect(await noOverflow(page)).toBe(true);
      expect(mock.requests.filter((r) => r.method !== 'GET')).toEqual([]);
      expect(mock.issues).toEqual([]);
      await shot(page, `complete-${locale}-${info.project.name}`);
    });

    test('incomplete live summary never shows a total or a named variance', async ({ page }, info) => {
      await open(page, locale, incomplete());
      const section = page.locator('[data-cash-summary="live"]');
      await expect(section.locator('[data-cash-row="expected"]')).toContainText(ar ? 'غير مكتمل' : 'incomplete');
      await expect(section.locator('[data-cash-row="variance"]')).toContainText(ar ? 'فرق غير نهائي' : 'Provisional difference');
      await expect(section.getByText(ar ? 'عجز' : 'Shortage', { exact: true })).toHaveCount(0);
      await expect(section).toContainText(ar ? 'لا تعتبره زيادة أو عجزاً' : "Don't treat it as an overage or shortage");
      expect(await noOverflow(page)).toBe(true);
      await shot(page, `incomplete-${locale}-${info.project.name}`);
    });

    test('a restricted viewer sees "not available", never a zero', async ({ page }, info) => {
      await open(page, locale, restricted());
      const sales = page.locator('[data-cash-row="sales"]');
      await expect(sales).toContainText(ar ? 'غير متاح لصلاحيتك' : 'Not available for your role');
      expect(await sales.innerText()).not.toMatch(/0\.00/);
      await expect(page.locator('[data-cash-row="network"]')).toContainText(ar ? 'غير متاح لصلاحيتك' : 'Not available for your role');
      await shot(page, `restricted-${locale}-${info.project.name}`);
    });

    test('fits a 320px phone without horizontal scrolling and keeps the rows readable', async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 568 });
      await open(page, locale, complete());
      expect(await noOverflow(page)).toBe(true);
      const clipped = await page.evaluate(() => [...document.querySelectorAll('[data-cash-summary] dt, [data-cash-summary] dd')].filter((el) => (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 1).map((el) => (el.textContent ?? '').trim().slice(0, 30)));
      expect(clipped).toEqual([]);
    });
  });
}
