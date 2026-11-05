import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockUi2Api, SELLER, type Locale } from './support/fuel-ops-ui2-mock';

/**
 * FUEL-OPS — «المبيعات والتحصيل» في شاشة تسليم الوردية، في متصفح حقيقي (Chromium بمقاس آيفون 390×844 و320 + سطح المكتب):
 * RTL/LTR، الأرقام 0–9 فقط، لا تجاوز أفقي، حقول ≥16px وأهداف لمس ≥44px، وأن الحفظ يرسل معرّفات طرق الدفع بالهللات فقط.
 * الخادم مُعترَض ببيانات اختبار موسومة؛ لا خلفية ولا بيانات محطة حقيقية. هذا لا يغني عن اختبار Safari/iPhone الحقيقي.
 * اللقطات: `COLLECTION_SHOTS=1` ⇒ docs/fuel-stations/visual-qa/collection.
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const SHOTS = process.env.COLLECTION_SHOTS === '1';
const shotDir = '../docs/fuel-stations/visual-qa/collection';

interface Call { method: string; body: Record<string, unknown> | null }

/** يعترض `…/collection` بحالة بسيطة تحاكي العقد (بعد تسجيل mockUi2Api فتأخذ الأسبقية). */
async function mockCollection(page: Page, opts: { salesVisible: boolean; enabled?: boolean }) {
  const calls: Call[] = [];
  const methods = [
    { id: 'm-cash', name: 'Fixture Cash', name_en: 'Fixture Cash', settlement_type: 'cash' },
    { id: 'm-card', name: 'Fixture Card', name_en: 'Fixture Card', settlement_type: 'bank' },
  ];
  let revision = 0;
  let lines: Array<{ payment_method_id: string; amount_minor: number }> | null = null;
  const view = () => {
    const total = lines?.reduce((s, l) => s + l.amount_minor, 0) ?? 0;
    const amount = 23_000;
    return {
      enabled: true, state: lines ? 'declared' : 'none', revision,
      methods: methods.map((m) => ({ ...m, saved_amount_minor: lines?.find((l) => l.payment_method_id === m.id)?.amount_minor ?? null })),
      methods_changed: false,
      close_readiness: { ready: !!lines, blockers: lines ? [] : ['required'], reason_required: false },
      review: { visible: false },
      declaration: lines ? { id: 'd1', revision, status: 'declared', lines: lines.map((l) => ({ ...l, name: methods.find((m) => m.id === l.payment_method_id)!.name, settlement_type: methods.find((m) => m.id === l.payment_method_id)!.settlement_type, still_allowed: true })), collected_total_minor: total, cash_declared_minor: lines.filter((l) => l.payment_method_id === 'm-cash').reduce((s, l) => s + l.amount_minor, 0), network_declared_minor: lines.filter((l) => l.payment_method_id === 'm-card').reduce((s, l) => s + l.amount_minor, 0) } : null,
      sales: {
        visible: opts.salesVisible, complete: true, milliliters: 100_000, milliliters_complete: true, amount_minor: opts.salesVisible ? amount : null, tax_mode: 'tax_inclusive', evaluated_at: '2026-11-05T10:00:00+00:00',
        products: [{ fuel_product_id: 'p1', name: 'Fixture Fuel 1', nozzle_count: 2, milliliters: 100_000, ...(opts.salesVisible ? { price_per_liter_minor: 230, price_source: 'station_override', amount_minor: amount } : {}), gaps: [] }],
        nozzles: [], gaps: [],
      },
      reconciliation: !opts.salesVisible ? { visible: false } : lines
        ? { visible: true, final: true, reason: null, collected_total_minor: total, sales_minor: amount, difference_minor: total - amount, direction: total === amount ? 'none' : total > amount ? 'overage' : 'shortage' }
        : { visible: true, final: false, reason: 'not_declared', collected_total_minor: null, difference_minor: null, direction: null },
      drawer: { frozen: false, opening_float_minor: 50_000, counted_cash_minor: null, treasury_handover_minor: 0, cash_in_minor: 0, cash_out_minor: 0, expenses_minor: 0, implied_sales_cash: { visible: opts.salesVisible, amount_minor: null, declared_difference_minor: null } },
      disclaimers: ['operational_not_financial_proof', 'credit_sales_excluded', 'unrecorded_settlements_excluded'],
    };
  };
  await page.route('**/api/fuel-stations/shifts/*/collection', async (route) => {
    const request = route.request();
    if (opts.enabled === false) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'not found' }) });
    if (request.method() === 'GET') {
      calls.push({ method: 'GET', body: null });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: view() }) });
    }
    const body = request.postDataJSON() as { lines: typeof lines };
    calls.push({ method: request.method(), body: body as unknown as Record<string, unknown> });
    revision += 1;
    lines = body.lines;
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: view(), meta: { replayed: false, unchanged: false } }) });
  });
  return { calls };
}

async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    if (document.documentElement.scrollWidth - document.documentElement.clientWidth > 1) problems.push('horizontal overflow');
    for (const el of document.querySelectorAll('[data-collection] input[type=text]')) {
      const style = getComputedStyle(el);
      if (parseFloat(style.fontSize) < 16) problems.push(`font ${parseFloat(style.fontSize)}px`);
      if ((el as HTMLElement).getBoundingClientRect().height < 43.5) problems.push('input height');
    }
    for (const el of document.querySelectorAll('[data-collection] button')) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width > 0 && r.height < 43.5) problems.push(`button ${Math.round(r.height)}px`);
    }
    return problems;
  });
}

for (const locale of ['en', 'ar'] as const) {
  const ar = locale === 'ar';
  test.describe(`shift collection — ${locale}`, () => {
    async function open(page: Page, collection: { salesVisible: boolean; enabled?: boolean }) {
      const mock = await mockUi2Api(page, { baseUrl, locale: locale as Locale, theme: 'light', seed: 'ready', permissions: collection.salesVisible ? [...SELLER, 'fuel.sale.view'] : SELLER });
      const col = await mockCollection(page, collection);
      await page.goto(`${baseUrl}/fuel-stations/ops/shifts/s-open/handover`, { waitUntil: 'domcontentloaded' });
      return { mock, col };
    }

    test('enter by payment method → live difference preview → save (ids + halalas) → saved reconciliation', async ({ page }, info) => {
      const { col } = await open(page, { salesVisible: true });
      const section = page.locator('[data-collection]');
      await expect(section).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.dir)).toBe(ar ? 'rtl' : 'ltr');
      await expect(page.locator('#collection-h')).toHaveText(ar ? 'المبيعات والتحصيل' : 'Sales and collection');
      // Q1: بلا إقرار محفوظ لا يُفتح التسليم (البوابة مفتوحة) ويظهر السبب.
      await page.getByTestId('counted-cash').fill('1000');
      await expect(page.locator('[data-handover-collection-blocked]')).toBeVisible();
      await expect(page.locator('[data-action-bar] button')).toBeDisabled();
      await section.getByTestId('collection-amount-m-cash').fill('200');
      await section.getByTestId('collection-amount-m-card').fill('20');
      await expect(section.locator('[data-collection-recon] [data-collection-direction]')).toHaveAttribute('data-collection-direction', 'shortage');
      const text = await section.innerText();
      expect(text).not.toMatch(/[٠-٩]/);
      expect(await layoutProblems(page)).toEqual([]);
      if (SHOTS) { mkdirSync(shotDir, { recursive: true }); await section.screenshot({ path: `${shotDir}/preview-${locale}-${info.project.name}.png` }); }

      await section.locator('[data-save-collection]').click();
      await expect(section.locator('[data-collection-saved]')).toBeVisible();
      const posts = col.calls.filter((c) => c.method === 'POST');
      expect(posts).toHaveLength(1);
      expect(posts[0].body).toMatchObject({ base_revision: 0, lines: [{ payment_method_id: 'm-cash', amount_minor: 20_000 }, { payment_method_id: 'm-card', amount_minor: 2_000 }] });
      await expect(section.locator('[data-save-collection]')).toBeDisabled(); // لا شيء جديد للحفظ
      await expect(page.locator('[data-handover-collection-blocked]')).toHaveCount(0);
      await expect(page.locator('[data-action-bar] button')).toBeEnabled(); // الإقرار محفوظ ومكتمل ⇒ يُفتح التسليم
      if (SHOTS) await section.screenshot({ path: `${shotDir}/saved-${locale}-${info.project.name}.png` });
    });

    test('gate closed (404): the handover screen shows no collection section', async ({ page }) => {
      await open(page, { salesVisible: true, enabled: false });
      await expect(page.locator('[data-handover]')).toBeVisible();
      await expect(page.locator('[data-collection]')).toHaveCount(0);
    });

    test('a seller without sales visibility: litres only, no amounts or difference', async ({ page }) => {
      await open(page, { salesVisible: false });
      const section = page.locator('[data-collection]');
      await expect(section).toBeVisible();
      await expect(section.locator('[data-collection-sales-amount]')).toContainText(ar ? 'تظهر للمشرف' : 'Shown to the supervisor');
      await expect(section.locator('[data-collection-direction]')).toHaveCount(0);
      expect(await layoutProblems(page)).toEqual([]);
    });

    test('fits a 320px phone without horizontal scrolling', async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 568 });
      await open(page, { salesVisible: true });
      await page.locator('[data-collection]').waitFor();
      expect(await layoutProblems(page)).toEqual([]);
    });
  });
}
