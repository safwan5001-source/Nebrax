import { expect, test, type Page } from '@playwright/test';

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';

async function enterDemo(page: Page) {
  await page.context().addCookies([{ name: 'locale', value: 'ar', url: baseUrl }]);
  await page.goto(`${baseUrl}/login`);
  await page.getByRole('button', { name: 'دخول تجريبي' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.waitForLoadState('domcontentloaded');
}

async function expectActionMenuWithinViewport(page: Page, count: number, expectedItems: RegExp[] = []) {
  const actions = page.getByRole('button', { name: /^(Invoice actions|إجراءات الفاتورة)$/ });
  await actions.click();
  const menu = page.getByRole('menu', { name: /^(Invoice actions|إجراءات الفاتورة)$/ });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveCount(count);
  for (const name of expectedItems) await expect(menu.getByRole('menuitem', { name })).toBeVisible();
  const menuBox = await menu.boundingBox();
  expect(menuBox).not.toBeNull();
  expect(menuBox!.x).toBeGreaterThanOrEqual(12);
  expect(menuBox!.width).toBeLessThanOrEqual(352);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(378);
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(832);
  await actions.click();
  await expect(menu).toBeHidden();
}

test('تفاصيل الفاتورة على الجوال: إجراءات ظاهرة وأقسام قابلة للإغلاق', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterDemo(page);
  await page.goto(`${baseUrl}/invoices/inv-118`, { waitUntil: 'commit' }).catch((error: Error) => {
    if (!error.message.includes('ERR_ABORTED')) throw error;
  });
  await expect(page.getByRole('heading', { name: /^(INV-2026-0118|INV-٢٠٢٦-٠١١٨)$/ })).toBeVisible();

  await expectActionMenuWithinViewport(page, 7, [/^(Duplicate|نسخ)$/]);

  const documentBeforeDetails = await page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll('h3'));
    const documentTitle = headings.find((node) => /^(Document|المستند)$/.test(node.textContent?.trim() ?? ''));
    const detailsTitle = headings.find((node) => /^(Invoice details|تفاصيل الفاتورة)$/.test(node.textContent?.trim() ?? ''));
    return Boolean(documentTitle && detailsTitle && (documentTitle.compareDocumentPosition(detailsTitle) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(documentBeforeDetails).toBe(true);

  const documentToggle = page.getByRole('button', { name: /^(Document|المستند)$/ });
  await expect(page.locator('#invoice-document-content')).toBeVisible();

  const details = page.getByRole('button', { name: /^(Invoice details|تفاصيل الفاتورة)$/ });
  await expect(page.locator('#invoice-details-content')).toHaveCount(0);
  await details.click();
  await expect(page.locator('#invoice-details-content')).toBeVisible();
  await details.click();
  await expect(page.locator('#invoice-details-content')).toHaveCount(0);

  const financial = page.getByRole('button', { name: /^(Financial summary|الملخص المالي)$/ });
  await expect(page.locator('#invoice-financial-content')).toHaveCount(0);
  await financial.click();
  await expect(page.locator('#invoice-financial-content')).toBeVisible();

  const payments = page.getByRole('button', { name: /^(Payments|المدفوعات)/ });
  const paymentsPanel = page.locator('#acc-payments');
  await payments.scrollIntoViewIfNeeded();
  await expect(paymentsPanel).toHaveCount(0);
  await payments.click();
  await expect(paymentsPanel).toBeVisible();
  await payments.click();
  await expect(paymentsPanel).toHaveCount(0);

  const revisions = page.getByRole('button', { name: /^(Change log|سجلّ التغييرات)$/ });
  await revisions.scrollIntoViewIfNeeded();
  await expect(page.locator('#revision-log-invoice-inv-118')).toHaveCount(0);

  await documentToggle.click();
  await expect(page.locator('#invoice-document-content')).toBeHidden();
  await documentToggle.click();
  await expect(page.locator('#invoice-document-content')).toBeVisible();

  await page.getByRole('button', { name: 'تبديل اللغة' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expectActionMenuWithinViewport(page, 7, [/^Duplicate$/]);

  await page.goto(`${baseUrl}/invoices/inv-115`, { waitUntil: 'commit' }).catch((error: Error) => {
    if (!error.message.includes('ERR_ABORTED')) throw error;
  });
  await expect(page.getByRole('heading', { name: 'INV-2026-0115' })).toBeVisible();
  await expectActionMenuWithinViewport(page, 8, [/^Edit$/, /^Duplicate$/, /^Delete draft$/]);

  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
