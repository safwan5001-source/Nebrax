import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockUi2Api, type Locale } from './support/fuel-ops-ui2-mock';

/**
 * FUEL-OPS — مراجعة المشرف للوردية المغلقة واعتمادها في متصفح حقيقي (Chromium بمقاس آيفون 390×844 و320 + سطح المكتب، EN/AR):
 * RTL، الأرقام 0–9، لا تجاوز أفقي، أهداف لمس ≥44px وخط الحقول ≥16px، وترتيب الإجراءات (مراجعة التحصيل ← مراجعة نقد الدرج ← اعتماد)
 * مع حجب الاعتماد قبلها، وأن الكتابات الثلاث وحدها هي المسارات القائمة. الخادم مُعترَض ببيانات اختبار موسومة؛ لا خلفية ولا بيانات حقيقية.
 * لا يغني عن Safari/iPhone الحقيقي. اللقطات: `REVIEW_SHOTS=1` ⇒ docs/fuel-stations/visual-qa/review.
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const SHOTS = process.env.REVIEW_SHOTS === '1';
const shotDir = '../docs/fuel-stations/visual-qa/review';
const SUPERVISOR = ['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.approve', 'fuel.shift.cash_variance_review', 'fuel.sale.view'];

async function mockReview(page: Page) {
  const posts: Array<{ path: string; body: unknown }> = [];
  const state = { collectionReviewed: false, cashReviewed: false, approved: false };
  const detail = () => ({
    id: 's-closed', number: 'SH-2001', status: state.approved ? 'approved' : 'closed', station_id: 'sa', branch_id: null, opening_float_minor: 20_000, counted_cash_minor: 20_500,
    expected_operational_cash_minor: 20_000, cash_variance_minor: 500, operational_meter_milliliters: 100_000, operational_liters: '100', locked_at: null, opened_at: '2026-11-05T03:00:00+00:00',
    closed_at: '2026-11-05T11:00:00+00:00', approved_at: state.approved ? '2026-11-05T12:10:00+00:00' : null, opened_by: 'fx-seller', staff_assignments: [], meter_readings: [], tank_readings: [], cash_movements: [],
    cash_variance: { status: 'pending_review', variance_direction: 'overage', reviewed_at: state.cashReviewed ? '2026-11-05T12:05:00+00:00' : null, reviewed_by: null },
    events: [{ id: 'e1', type: 'closed', actor_id: 'fx-seller', occurred_at: '2026-11-05T11:00:00+00:00', payload: null }],
  });
  const view = () => ({
    enabled: true, state: 'frozen', revision: 2, methods: [], methods_changed: false, close_readiness: { ready: true, blockers: [], reason_required: false },
    review: { visible: true, state: state.collectionReviewed ? 'reviewed' : 'pending', reason: 'Fixture reason for the difference', note: state.collectionReviewed ? 'Fixture note' : null, reviewed_by: null, reviewed_at: null },
    declaration: { id: 'd1', revision: 2, status: 'frozen', lines: [{ payment_method_id: 'm1', name: 'Fixture Cash', settlement_type: 'cash', amount_minor: 17_000, still_allowed: null }, { payment_method_id: 'm2', name: 'Fixture Card', settlement_type: 'bank', amount_minor: 3_000, still_allowed: null }], collected_total_minor: 20_000, cash_declared_minor: 17_000, network_declared_minor: 3_000, frozen_at: '2026-11-05T11:00:00+00:00' },
    sales: { visible: true, complete: true, milliliters: 100_000, milliliters_complete: true, amount_minor: 23_000, tax_mode: 'tax_inclusive', evaluated_at: null, products: [{ fuel_product_id: 'p1', name: 'Fixture Fuel 1', nozzle_count: 2, milliliters: 100_000, price_per_liter_minor: 230, amount_minor: 23_000, gaps: [] }], nozzles: [], gaps: [] },
    reconciliation: { visible: true, final: true, reason: null, collected_total_minor: 20_000, sales_minor: 23_000, difference_minor: -3_000, direction: 'shortage' },
    drawer: { frozen: true, opening_float_minor: 20_000, counted_cash_minor: 20_500, treasury_handover_minor: 0, cash_in_minor: 0, cash_out_minor: 0, expenses_minor: 0, implied_sales_cash: { visible: true, amount_minor: 500, declared_difference_minor: 16_500 } },
    disclaimers: ['operational_not_financial_proof', 'credit_sales_excluded', 'unrecorded_settlements_excluded'],
  });
  const json = (route: import('@playwright/test').Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/fuel-stations/shifts/s-closed', (route) => json(route, { data: detail() }));
  await page.route('**/api/fuel-stations/shifts/s-closed/collection', (route) => json(route, { data: view() }));
  await page.route('**/api/fuel-stations/shifts/s-closed/collection/review', (route) => { posts.push({ path: 'collection/review', body: route.request().postDataJSON() }); state.collectionReviewed = true; return json(route, { data: view() }); });
  await page.route('**/api/fuel-stations/shifts/s-closed/cash-variance/review', (route) => { posts.push({ path: 'cash-variance/review', body: route.request().postDataJSON() }); state.cashReviewed = true; return json(route, { data: detail() }); });
  await page.route('**/api/fuel-stations/shifts/s-closed/approve', (route) => {
    posts.push({ path: 'approve', body: route.request().postDataJSON() });
    if (!state.collectionReviewed || !state.cashReviewed) return json(route, { message: 'FUEL_COLLECTION_REVIEW_REQUIRED: x' }, 422);
    state.approved = true;
    return json(route, { data: detail() });
  });
  return { posts, state };
}

async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    if (document.documentElement.scrollWidth - document.documentElement.clientWidth > 1) problems.push('horizontal overflow');
    for (const el of document.querySelectorAll('[data-review-screen] button, [data-action-bar] button, [role=dialog] button')) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width > 0 && r.height < 43.5) problems.push(`button ${Math.round(r.height)}px: ${(el.textContent ?? '').trim().slice(0, 24)}`);
    }
    for (const el of document.querySelectorAll('[role=dialog] textarea')) if (parseFloat(getComputedStyle(el).fontSize) < 16) problems.push('textarea font < 16px');
    const bar = document.querySelector('[data-action-bar]') as HTMLElement | null;
    const navEl = document.querySelector('nav[aria-label]') as HTMLElement | null;
    // الشريط السفلي موجود على الجوال فقط (سطح المكتب بتنقل جانبي).
    if (window.innerWidth < 768 && bar && navEl && bar.getBoundingClientRect().bottom > navEl.getBoundingClientRect().top + 1) problems.push('action bar covered by bottom nav');
    return problems;
  });
}

for (const locale of ['en', 'ar'] as const) {
  const ar = locale === 'ar';
  test.describe(`supervisor review — ${locale}`, () => {
    async function open(page: Page, permissions = SUPERVISOR) {
      await mockUi2Api(page, { baseUrl, locale: locale as Locale, theme: 'light', seed: 'none', permissions });
      const mock = await mockReview(page);
      await page.goto(`${baseUrl}/fuel-stations/ops/shifts/s-closed/review`, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-review-screen]').waitFor();
      return mock;
    }

    test('review the collection, then the drawer cash difference, then approve — approval is blocked until both are recorded', async ({ page }, info) => {
      const mock = await open(page);
      expect(await page.evaluate(() => document.documentElement.dir)).toBe(ar ? 'rtl' : 'ltr');
      const approve = page.locator('[data-approve-action]');
      await expect(approve).toBeDisabled();
      await expect(page.locator('[data-review-blocker]')).toHaveCount(2);
      await expect(page.locator('[data-review-explainer]')).toBeVisible();
      expect((await page.locator('[data-review-screen]').innerText())).not.toMatch(/[٠-٩]/);
      expect(await layoutProblems(page)).toEqual([]);
      if (SHOTS) { mkdirSync(shotDir, { recursive: true }); await page.screenshot({ path: `${shotDir}/review-${locale}-${info.project.name}.png`, fullPage: true }); }

      for (const key of ['collection', 'cash'] as const) {
        await page.locator(`[data-review-action="${key}"]`).click();
        const dialog = page.getByRole('dialog');
        expect(await layoutProblems(page)).toEqual([]);
        await expect(dialog.locator('[data-confirm-review]')).toBeDisabled();
        await dialog.locator('textarea').fill('Fixture review note');
        await dialog.locator('[data-confirm-review]').click();
        await expect(dialog).toHaveCount(0);
      }
      await expect(page.locator('[data-review-blocker]')).toHaveCount(0);
      await expect(approve).toBeEnabled();
      await approve.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.locator('[data-confirm-approve]')).toBeDisabled();
      await dialog.locator('[data-approve-ack]').check({ force: true });
      await dialog.locator('[data-confirm-approve]').click();
      await expect(page.locator('[data-review-approved]')).toBeVisible();
      await expect(page.locator('[data-approve-action]')).toHaveCount(0);
      expect(mock.posts.map((p) => p.path)).toEqual(['collection/review', 'cash-variance/review', 'approve']);
      if (SHOTS) await page.screenshot({ path: `${shotDir}/approved-${locale}-${info.project.name}.png`, fullPage: true });
    });

    test('a viewer without approve/review permissions sees the figures and clear reasons, and nothing to press', async ({ page }) => {
      await open(page, ['fuel_stations.view', 'fuel.shift.view', 'fuel.sale.view']);
      await expect(page.locator('[data-approve-action]')).toBeDisabled();
      await expect(page.locator('[data-review-action]')).toHaveCount(0);
      await expect(page.locator('[data-review-blocker="no_permission"]')).toBeVisible();
    });

    test('fits a 320px phone without horizontal scrolling', async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 568 });
      await open(page);
      expect(await layoutProblems(page)).toEqual([]);
    });
  });
}
