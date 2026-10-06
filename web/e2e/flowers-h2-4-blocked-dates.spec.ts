import { expect, test, type Route } from '@playwright/test';
import path from 'node:path';
import { assertNoOverflow, evidenceDir, seedAdmin, VIEWPORTS } from './helpers/flowers-admin';

/**
 * FLOWERS-H2-4 — التحقق البصري لتبويب «التواريخ المحجوبة». الخادم مُعترَض بحمولات تطابق عقد
 * `delivery-schedule` (القراءة + `blocked-dates` استبدالٌ كامل).
 */
let dir = '';
test.beforeAll(async () => {
  dir = await evidenceDir('flowers-h2-4-blocked-dates');
});

type Row = { date: string; method: string; reason: string | null };
const ROWS: Row[] = [
  { date: '2099-12-25', method: 'all', reason: 'عطلة رسمية — لا يوجد توصيل أو استلام في هذا اليوم' },
  { date: '2099-12-26', method: 'pickup', reason: null },
  { date: '2000-01-01', method: 'all', reason: 'عطلة منتهية' },
];

function server(state: { rows: Row[]; failSave?: boolean }) {
  return async (url: string, route: Route) => {
    if (!url.includes('/delivery-schedule')) return false;
    if (route.request().method() === 'PUT' && url.endsWith('/blocked-dates')) {
      if (state.failSave) {
        await route.fulfill({ status: 422, json: { message: 'لا يمكن تكرار التاريخ نفسه لنفس الطريقة.', errors: {} } });
        return true;
      }
      state.rows = (route.request().postDataJSON() as { blocked_dates: Row[] }).blocked_dates;
    }
    await route.fulfill({
      json: {
        data: {
          settings: { enabled: true, required: true, timezone: 'Asia/Riyadh', lead_time_minutes: 0, cutoff_time: null, max_days_ahead: 30 },
          slots: [],
          blocked_dates: [...state.rows].sort((a, b) => a.date.localeCompare(b.date)),
        },
      },
    });
    return true;
  };
}

test.describe('FLOWERS-H2-4 — blocked dates', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own viewport');
  });

  for (const locale of ['ar', 'en'] as const) {
    for (const [w, h] of VIEWPORTS) {
      test(`${locale.toUpperCase()} ${w} — list, no overflow`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await seedAdmin(page, locale, server({ rows: ROWS }));
        await page.goto('/commerce/delivery?tab=blocked');
        await expect(page.locator('[data-blocked-upcoming] [data-blocked-row]')).toHaveCount(2);
        await assertNoOverflow(page);
        await page.screenshot({ path: path.join(dir, `${locale}-${w}-list.png`), fullPage: true });
      });
    }
  }

  test('AR 390 — pick a date, validate, add; the date is sent as plain Y-m-d', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = { rows: ROWS };
    let sent: Row[] = [];
    await seedAdmin(page, 'ar', async (url, route) => {
      if (route.request().method() === 'PUT' && url.endsWith('/blocked-dates')) sent = (route.request().postDataJSON() as { blocked_dates: Row[] }).blocked_dates;
      return server(state)(url, route);
    });
    await page.goto('/commerce/delivery?tab=blocked');
    await page.getByRole('button', { name: 'حجب التاريخ' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'اختر التاريخ.' })).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'ar-390-invalid.png'), fullPage: true });

    await page.getByLabel('التاريخ', { exact: true }).fill('01/01/2100');
    await page.getByLabel('السبب (اختياري)').fill('رأس السنة');
    await page.getByRole('button', { name: 'حجب التاريخ' }).click();
    await expect(page.getByText('01/01/2100')).toBeVisible();
    expect(sent.find((r) => r.reason === 'رأس السنة')?.date).toBe('2100-01-01');
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(dir, 'ar-390-added.png'), fullPage: true });
  });

  test('EN 1440 — past dates fold away; clear-past asks for confirmation; server rejection is visible', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    const state = { rows: ROWS };
    await seedAdmin(page, 'en', server(state));
    await page.goto('/commerce/delivery?tab=blocked');
    await expect(page.getByText('01/01/2000')).toHaveCount(0);
    await page.getByRole('button', { name: 'Past (1)' }).click();
    await expect(page.getByText('01/01/2000')).toBeVisible();
    await page.getByRole('button', { name: 'Remove past dates' }).click();
    await expect(page.getByRole('dialog').getByText('does not affect any order')).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'en-1440-clear-past.png') });
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

    state.rows = ROWS;
    await page.unroute('**/api/**');
    await seedAdmin(page, 'en', server({ rows: ROWS, failSave: true }));
    await page.goto('/commerce/delivery?tab=blocked');
    await page.getByLabel('Date', { exact: true }).fill('02/02/2100');
    await page.getByRole('button', { name: 'Block date' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'لا يمكن تكرار' })).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'en-1440-server-error.png'), fullPage: true });
  });

  test('EN 390 dark — empty state', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAdmin(page, 'en', server({ rows: [] }), { dark: true });
    await page.goto('/commerce/delivery?tab=blocked');
    await expect(page.getByText('No blocked dates')).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(dir, 'en-390-dark-empty.png'), fullPage: true });
  });
});
