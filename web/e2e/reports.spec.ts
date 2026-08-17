import { expect, test } from '@playwright/test';

const reportRoutes = [
  '/reports',
  '/reports/general/trial-balance',
  '/reports/general/income-statement',
  '/reports/general/balance-sheet',
  '/reports/general/cost-center-profitability',
  '/reports/general/account-ledger',
  '/reports/general/cash-flow',
  '/reports/general/journal-entries',
  '/reports/general/tax-report',
  '/reports/customers/aging',
  '/reports/purchases/by-period',
  '/reports/purchases/by-supplier',
  '/reports/purchases/by-product',
  '/reports/purchases/by-employee',
  '/reports/purchases/balances',
  '/reports/purchases/payments',
  '/reports/purchases/aging',
  '/reports/sales/by-period',
  '/reports/sales/by-customer',
  '/reports/sales/by-product',
  '/reports/sales/by-salesperson',
  '/reports/sales/profitability',
  '/reports/sales/payments',
  '/pos/report',
] as const;

async function enterDemo(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    localStorage.setItem('demo', 'true');
    localStorage.setItem('user', JSON.stringify({
      id: 'demo-user', name: 'مستخدم المعاينة', email: 'demo@nibras.test', role: 'owner', tenant_id: 'demo-tenant',
    }));
  });
}

async function openReportPreview(page: import('@playwright/test').Page) {
  const directPreview = page.getByRole('button', { name: 'معاينة التقرير' });
  if (await directPreview.count()) {
    await directPreview.click();
    return;
  }

  await page.getByRole('button', { name: 'إجراءات التقرير' }).click();
  await page.getByRole('button', { name: 'معاينة التقرير' }).last().click();
}

test.describe('مسارات التقارير في وضع العرض التجريبي', () => {
  for (const route of reportRoutes) {
    test(`${route} يحمّل بلا تعطل أو تجاوز أفقي`, async ({ page }) => {
      const pageErrors: Error[] = [];
      page.on('pageerror', (error) => pageErrors.push(error));
      await enterDemo(page);
      await page.goto(route, { waitUntil: 'networkidle' });

      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByText('تعذر تحميل التقرير.', { exact: true })).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
      expect(pageErrors, pageErrors.map((error) => error.message).join('\n')).toEqual([]);
    });
  }

  test('كشف الأستاذ يحافظ على المعاينة كإجراء اختياري ويعرض تفاصيل الحساب', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/reports/general/account-ledger', { waitUntil: 'networkidle' });
    await page.locator('#ledger-account').selectOption('a4110');
    await expect(page.getByRole('heading', { name: 'إيرادات المبيعات' })).toBeVisible();
    await expect(page.locator('table')).toHaveCount(1);
    await expect(page.locator('.md\\:hidden article')).toHaveCount(1);
    await page.getByRole('button', { name: 'معاينة التقرير' }).click();
    await expect(page.getByRole('heading', { name: 'معاينة التقرير' })).toBeVisible();
  });

  test('تقارير المبيعات والمشتريات تستجيب لإجراء المعاينة من دون فقدان التفاصيل', async ({ page }) => {
    for (const route of ['/reports/sales/by-customer', '/reports/purchases/by-supplier']) {
      await enterDemo(page);
      await page.goto(route, { waitUntil: 'networkidle' });
      await expect(page.getByText('تفاصيل التقرير', { exact: true })).toBeVisible();
      await expect(page.locator('table')).toHaveCount(1);
      await openReportPreview(page);
      await expect(page.getByRole('heading', { name: 'معاينة التقرير' })).toBeVisible();
    }
  });
});
