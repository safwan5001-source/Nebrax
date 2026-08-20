import { expect, test, type Page } from '@playwright/test';

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';

async function enterDemo(page: Page) {
  await page.goto(`${baseUrl}/login`);
  await page.getByRole('button', { name: 'دخول تجريبي' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.waitForLoadState('domcontentloaded');
}

test('تفاصيل الفاتورة على الجوال: إجراءات ظاهرة وأقسام قابلة للإغلاق', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterDemo(page);
  await page.goto(`${baseUrl}/invoices/inv-118`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /^(INV-2026-0118|INV-٢٠٢٦-٠١١٨)$/ })).toBeVisible();

  const actions = page.getByRole('button', { name: /^(Invoice actions|إجراءات الفاتورة)$/ });
  await actions.click();
  const menu = page.getByRole('menu', { name: /^(Invoice actions|إجراءات الفاتورة)$/ });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveCount(8);
  await actions.click();
  await expect(menu).toBeHidden();

  const details = page.getByRole('button', { name: /^(Invoice details|تفاصيل الفاتورة)$/ });
  await details.click();
  await expect(page.locator('#invoice-details-content')).toHaveCount(0);
  await details.click();
  await expect(page.locator('#invoice-details-content')).toBeVisible();

  const payments = page.getByRole('button', { name: /^(Payments|المدفوعات)/ });
  const paymentsPanel = page.locator('#acc-payments');
  await payments.scrollIntoViewIfNeeded();
  await expect(paymentsPanel).toBeVisible();
  await payments.click();
  await expect(paymentsPanel).toHaveCount(0);
  await payments.click();
  await expect(paymentsPanel).toBeVisible();

  const revisions = page.getByRole('button', { name: /^(Change log|سجلّ التغييرات)$/ });
  await revisions.scrollIntoViewIfNeeded();
  await revisions.click();
  await expect(page.locator('#revision-log-invoice-inv-118')).toHaveCount(0);

  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
