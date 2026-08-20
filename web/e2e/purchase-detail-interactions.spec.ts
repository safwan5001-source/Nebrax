import { expect, test, type Page } from '@playwright/test';

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';

async function enterDemo(page: Page) {
  await page.context().addCookies([{ name: 'locale', value: 'ar', url: baseUrl }]);
  await page.goto(`${baseUrl}/login`);
  await page.getByRole('button', { name: 'دخول تجريبي' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.waitForLoadState('domcontentloaded');
}

async function expectActionMenuWithinViewport(page: Page, expectedItems: RegExp[]) {
  const actions = page.getByRole('button', { name: /^(Purchase invoice actions|إجراءات فاتورة الشراء)$/ });
  await actions.click();
  const menu = page.getByRole('menu', { name: /^(Purchase invoice actions|إجراءات فاتورة الشراء)$/ });
  await expect(menu).toBeVisible();
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

test('تفاصيل فاتورة الشراء على الجوال: قائمة إجراءات وأقسام قابلة للإغلاق', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterDemo(page);
  await page.goto(`${baseUrl}/purchases/pu-40`, { waitUntil: 'commit' }).catch((error: Error) => {
    if (!error.message.includes('ERR_ABORTED')) throw error;
  });
  await expect(page.getByRole('heading', { name: /^(PUR-2026-0040|PUR-٢٠٢٦-٠٠٤٠)$/ })).toBeVisible();

  await expectActionMenuWithinViewport(page, [/^(Add payment|إضافة عملية دفع)$/, /^(Create return|إنشاء مرتجع)$/, /^(Print|طباعة)$/]);
  await page.getByRole('button', { name: /^(Purchase invoice actions|إجراءات فاتورة الشراء)$/ }).click();
  await page.getByRole('menuitem', { name: /^(Add payment|إضافة عملية دفع)$/ }).click();
  await expect(page).toHaveURL(/\/purchases\/pu-40\/payments\/new$/);
  await expect(page.getByRole('heading', { name: /^(Add payment|إضافة عملية دفع)$/ })).toBeVisible();
  await expect(page.locator('#document-payment-amount')).toHaveValue('3450.00');
  await expect(page.locator('#document-payment-collector')).toBeVisible();

  await page.goto(`${baseUrl}/purchases/pu-40`, { waitUntil: 'commit' }).catch((error: Error) => {
    if (!error.message.includes('ERR_ABORTED')) throw error;
  });
  await expect(page.getByRole('heading', { name: /^(PUR-2026-0040|PUR-٢٠٢٦-٠٠٤٠)$/ })).toBeVisible();

  const documentBeforeDetails = await page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll('h3'));
    const documentTitle = headings.find((node) => /^(Document|المستند)$/.test(node.textContent?.trim() ?? ''));
    const detailsTitle = headings.find((node) => /^(Invoice details|تفاصيل الفاتورة)$/.test(node.textContent?.trim() ?? ''));
    return Boolean(documentTitle && detailsTitle && (documentTitle.compareDocumentPosition(detailsTitle) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(documentBeforeDetails).toBe(true);

  await expect(page.locator('#purchase-document-content')).toBeVisible();
  const details = page.getByRole('button', { name: /^(Invoice details|تفاصيل الفاتورة)$/ });
  await expect(page.locator('#purchase-details-content')).toHaveCount(0);
  await details.click();
  await expect(page.locator('#purchase-details-content')).toBeVisible();
  await details.click();
  await expect(page.locator('#purchase-details-content')).toHaveCount(0);

  const financial = page.getByRole('button', { name: /^(Financial summary|الملخص المالي)$/ });
  await expect(page.locator('#purchase-financial-content')).toHaveCount(0);
  await financial.click();
  await expect(page.locator('#purchase-financial-content')).toBeVisible();

  const payments = page.getByRole('button', { name: /^(Payments|المدفوعات)/ });
  await payments.scrollIntoViewIfNeeded();
  await expect(page.locator('#acc-payments')).toHaveCount(0);
  await payments.click();
  await expect(page.locator('#acc-payments')).toBeVisible();
  await payments.click();
  await expect(page.locator('#acc-payments')).toHaveCount(0);

  const revisions = page.getByRole('button', { name: /^(Change log|سجلّ التغييرات)$/ });
  await revisions.scrollIntoViewIfNeeded();
  await expect(page.locator('#revision-log-purchase-pu-40')).toHaveCount(0);

  await page.getByRole('button', { name: 'تبديل اللغة' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expectActionMenuWithinViewport(page, [/^Add payment$/, /^Create return$/]);

  await page.goto(`${baseUrl}/purchases/pu-39`, { waitUntil: 'commit' }).catch((error: Error) => {
    if (!error.message.includes('ERR_ABORTED')) throw error;
  });
  await expect(page.getByRole('heading', { name: 'PUR-2026-0039' })).toBeVisible();
  await expectActionMenuWithinViewport(page, [/^Edit$/, /^Delete$/]);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});


test('الإجراء السريع في لوحة التحكم يفتح شاشة تسجيل دفعة الموحدة', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterDemo(page);
  await page.getByRole('link', { name: /^(Record payment|تسجيل دفعة)$/ }).click();
  await expect(page).toHaveURL(/\/payments\/new$/);
  await expect(page.getByRole('heading', { name: /^(Record payment|تسجيل دفعة)$/ })).toBeVisible();
  await expect(page.locator('#general-payment-direction')).toBeVisible();
  await expect(page.locator('#general-payment-partner')).toBeVisible();
  await expect(page.locator('#general-payment-attachments')).toBeAttached();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});


test('رصيد مدفوعات الطرف يهيئ القبض أو الصرف ويترك المستند اختيارياً', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterDemo(page);

  await page.goto(`${baseUrl}/partners/p1`);
  await expect(page.locator('h1', { hasText: 'مؤسسة الخليج للتجارة' })).toBeVisible();
  await page.getByRole('link', { name: 'أضف رصيد مدفوعات' }).click();
  await expect(page).toHaveURL(/\/payments\/new\?partner_id=p1&direction=received$/);
  await expect(page.locator('#general-payment-direction')).toHaveValue('received');
  await expect(page.locator('#general-payment-partner')).toHaveValue('p1');
  await expect(page.locator('#general-payment-document')).toBeVisible();
  await expect(page.locator('#general-payment-document')).toHaveValue('');

  await page.goto(`${baseUrl}/partners/p7`);
  await expect(page.locator('h1', { hasText: 'شركة الجزيرة للتوريدات الصناعية' })).toBeVisible();
  await page.getByRole('link', { name: 'أضف رصيد مدفوعات' }).click();
  await expect(page).toHaveURL(/\/payments\/new\?partner_id=p7&direction=paid$/);
  await expect(page.locator('#general-payment-direction')).toHaveValue('paid');
  await expect(page.locator('#general-payment-partner')).toHaveValue('p7');
  await expect(page.locator('#general-payment-document')).toHaveValue('');
});
