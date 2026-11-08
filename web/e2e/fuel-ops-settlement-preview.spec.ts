import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockUi2Api, SELLER, type Locale } from './support/fuel-ops-ui2-mock';

/**
 * P1-3a — «معاينة التسوية» في شاشة تسليم الوردية، في متصفح حقيقي (Chromium بمقاس آيفون 390×844 و320 + سطح المكتب):
 * RTL/LTR، الأرقام 0–9 فقط، لا تجاوز أفقي، زر التحديث هدف لمس ≥44px، وأن القسم **قراءة فقط**: لا طلب غير GET إلى أي مسار تسوية.
 * الخادم مُعترَض ببيانات اختبار موسومة؛ لا خلفية ولا بيانات محطة حقيقية. هذا لا يغني عن اختبار Safari/iPhone الحقيقي.
 * اللقطات: `SETTLEMENT_SHOTS=1` ⇒ docs/fuel-stations/visual-qa/settlement-preview.
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const SHOTS = process.env.SETTLEMENT_SHOTS === '1';
const shotDir = '../docs/fuel-stations/visual-qa/settlement-preview';

type Variant = 'basic' | 'finance' | 'withheld' | 'closed';

function body(variant: Variant) {
  const basic = {
    enabled: true, writes_nothing: true, shift: { id: 's-open', number: 'SH-001', status: 'open' }, policy: { mode: 'post_on_close', sales_basis: 'per_invoice' },
    ready: true, blockers: [] as string[], preview_hash: 'f'.repeat(64), evaluated_at: '2026-11-08T10:00:00+00:00', disclaimers: ['preview_only_no_postings'],
    lines: [
      { nozzle_id: 'n1', nozzle_number: '1', fuel_product_id: 'p1', metered_milliliters: 20_000, withheld: false },
      { nozzle_id: 'n2', nozzle_number: '2', fuel_product_id: 'p1', metered_milliliters: 12_500, withheld: false },
    ],
  };
  if (variant === 'basic') return { ...basic, ready: false, blockers: ['FUEL_SETTLEMENT_DECLARATION_MISSING', 'FUEL_SETTLEMENT_SUPERVISOR_ATTENTION', 'FUEL_SETTLEMENT_NOT_READY_COST_STATE:abc'] };
  const money = {
    lines: [
      { ...basic.lines[0], erp_milliliters: 5_000, residual_milliliters: 15_000, price_per_liter_minor: 230, expected_gross_minor: 3_450, state: variant === 'withheld' ? 'withheld_cost_pool_changed' : 'posted', withheld_reason: null, withheld: variant === 'withheld' },
      { ...basic.lines[1], erp_milliliters: 0, residual_milliliters: 12_500, price_per_liter_minor: 230, expected_gross_minor: 2_875, state: variant === 'withheld' ? 'withheld_period_boundary' : 'posted', withheld_reason: null, withheld: variant === 'withheld' },
    ],
    reference: { total_minor: 6_325 },
    declaration: { present: true, declared_total_minor: 6_000, difference_vs_reference_minor: -325 },
    allocation: variant === 'withheld' ? { rows: [], allocated_total_minor: 0 } : { rows: [
      { payment_method_id: 'm-card', method: 'Fixture Card', settlement_type: 'bank', target_kind: 'settlement', target_ref: 'nozzle:1', amount_minor: 2_600 },
      { payment_method_id: 'm-cash', method: 'Fixture Cash', settlement_type: 'cash', target_kind: 'erp_walk_in', target_ref: 'FS-1', amount_minor: 1_150 },
      { payment_method_id: 'm-cash', method: 'Fixture Cash', settlement_type: 'cash', target_kind: 'settlement', target_ref: 'nozzle:2', amount_minor: 2_250 },
    ], allocated_total_minor: 6_000 },
    variances: variant === 'withheld'
      ? { shortage_minor: 0, surplus: [], held_for_withheld: [{ payment_method_id: 'm-cash', method: 'Fixture Cash', amount_minor: 6_000 }] }
      : { shortage_minor: 325, surplus: [], held_for_withheld: [] },
  };
  return { ...basic, ...money, ready: variant === 'finance' };
}

async function mockPreview(page: Page, variant: Variant) {
  const calls: Array<{ method: string; url: string }> = [];
  await page.route('**/api/fuel-stations/shifts/*/settlement-preview', async (route) => {
    const request = route.request();
    calls.push({ method: request.method(), url: request.url() });
    if (variant === 'closed') return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'not found' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: body(variant) }) });
  });
  return { calls };
}

async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    if (document.documentElement.scrollWidth - document.documentElement.clientWidth > 1) problems.push('horizontal overflow');
    for (const el of document.querySelectorAll('[data-settlement-preview] button')) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width > 0 && (r.height < 43.5 || r.width < 43.5)) problems.push(`button ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return problems;
  });
}

for (const locale of ['en', 'ar'] as const) {
  const ar = locale === 'ar';
  test.describe(`settlement preview — ${locale}`, () => {
    async function open(page: Page, variant: Variant, permissions: string[]) {
      await mockUi2Api(page, { baseUrl, locale: locale as Locale, theme: 'light', seed: 'ready', permissions });
      const preview = await mockPreview(page, variant);
      await page.goto(`${baseUrl}/fuel-stations/ops/shifts/s-open/handover`, { waitUntil: 'domcontentloaded' });
      return preview;
    }

    test('finance layer: expected values, declaration check, how the money is applied; read-only', async ({ page }, info) => {
      const preview = await open(page, 'finance', [...SELLER, 'fuel.sale.view']);
      const section = page.locator('[data-settlement-preview]');
      await expect(section).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.dir)).toBe(ar ? 'rtl' : 'ltr');
      await expect(section.locator('#fo-settlement-h')).toHaveText(ar ? 'معاينة التسوية' : 'Settlement preview');
      await expect(section.locator('[data-settlement-status]')).toHaveAttribute('data-settlement-status', 'ready');
      await expect(section.locator('[data-settlement-direction]')).toHaveAttribute('data-settlement-direction', 'short');
      await expect(section.locator('[data-settlement-shortage]')).toContainText('3.25');
      await expect(section.locator('[data-settlement-allocation] li').first()).toContainText('26.00'); // الشبكة أولاً
      const text = await section.innerText();
      expect(text).not.toMatch(/[٠-٩]/);
      expect(await layoutProblems(page)).toEqual([]);
      if (SHOTS) { mkdirSync(shotDir, { recursive: true }); await section.screenshot({ path: `${shotDir}/finance-${locale}-${info.project.name}.png` }); }

      // التحديث يقرأ من جديد ولا يكتب شيئاً.
      const before = preview.calls.length;
      await section.locator('[data-settlement-refresh]').click();
      await expect.poll(() => preview.calls.length).toBeGreaterThan(before);
      expect(preview.calls.every((c) => c.method === 'GET')).toBe(true);
    });

    test('closer without sales access: readiness, blockers and liters only', async ({ page }, info) => {
      await open(page, 'basic', SELLER);
      const section = page.locator('[data-settlement-preview]');
      await expect(section).toBeVisible();
      await expect(section.locator('[data-settlement-blockers] li')).toHaveCount(3);
      await expect(section.locator('[data-settlement-hidden]')).toBeVisible();
      await expect(section.locator('[data-settlement-reference]')).toHaveCount(0);
      await expect(section.locator('[data-settlement-allocation]')).toHaveCount(0);
      expect(await section.innerText()).not.toMatch(/23\.00|34\.50|28\.75/);
      expect(await layoutProblems(page)).toEqual([]);
      if (SHOTS) { mkdirSync(shotDir, { recursive: true }); await section.screenshot({ path: `${shotDir}/basic-${locale}-${info.project.name}.png` }); }
    });

    test('deferred lines are explained and the declared money is held, not shown as a surplus', async ({ page }) => {
      await open(page, 'withheld', [...SELLER, 'fuel.sale.view']);
      const section = page.locator('[data-settlement-preview]');
      await expect(section.locator('[data-settlement-state="withheld_cost_pool_changed"]')).toBeVisible();
      await expect(section.locator('[data-settlement-state="withheld_period_boundary"]')).toBeVisible();
      await expect(section.locator('[data-settlement-held]')).toContainText('60.00');
      await expect(section.locator('[data-settlement-surplus]')).toHaveCount(0);
      expect(await layoutProblems(page)).toEqual([]);
    });

    test('gate closed (404): the handover screen shows no settlement section', async ({ page }) => {
      await open(page, 'closed', [...SELLER, 'fuel.sale.view']);
      await expect(page.locator('[data-handover]')).toBeVisible();
      await expect(page.locator('[data-settlement-preview]')).toHaveCount(0);
    });

    test('fits a 320px phone without horizontal scrolling', async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 568 });
      await open(page, 'finance', [...SELLER, 'fuel.sale.view']);
      await page.locator('[data-settlement-preview]').waitFor();
      expect(await layoutProblems(page)).toEqual([]);
    });
  });
}
