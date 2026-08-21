import { expect, test, type Page } from '@playwright/test';

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';

async function enterDemo(page: Page) {
  await page.context().addCookies([{ name: 'locale', value: 'ar', url: baseUrl }]);
  await page.goto(`${baseUrl}/login`);
  await page.getByRole('button', { name: 'دخول تجريبي' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test('لوحة التحكم تربط الأزرار الرئيسية والعرض التشغيلي بعقود مكتملة', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await enterDemo(page);

  await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'فاتورة جديدة' })).toHaveAttribute('href', '/invoices/new');
  await expect(page.getByRole('link', { name: 'عميل جديد' })).toHaveAttribute('href', '/partners/new');
  await expect(page.getByRole('link', { name: 'تسجيل دفعة' })).toHaveAttribute('href', '/payments/new');
  await expect(page.getByRole('link', { name: 'التقارير' })).toHaveAttribute('href', '/reports');

  const purchaseActivity = page.getByText(/إنشاء فاتورة الشراء/);
  await expect(purchaseActivity).toHaveCount(2);
  await expect(purchaseActivity.first()).toContainText('PUR-2026-0040');
  await expect(page.getByRole('link', { name: 'إدارة الورديات ←' })).toHaveAttribute('href', '/pos/sessions');

  await page.locator('#rf-branches').click();
  const branchList = page.getByRole('listbox');
  await expect(branchList).toBeVisible();
  await branchList.getByRole('option', { name: 'فرع الخبر' }).click();
  await expect(page.locator('#rf-branches')).toContainText('فرع الخبر');
  await page.getByRole('button', { name: 'مسح المرشّحات' }).click();
  await expect(page.locator('#rf-branches')).toContainText('كل الفروع');

  for (const tab of ['الأيام', 'المنتجات', 'الفئات', 'الفروع', 'البائعين']) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
  }
});

test('لوحة التحكم لا تفيض أفقياً على الجوال وتحافظ على الأزرار الرئيسية', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterDemo(page);

  await expect(page.getByRole('link', { name: 'فاتورة جديدة' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'عميل جديد' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'تسجيل دفعة' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'التقارير' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
