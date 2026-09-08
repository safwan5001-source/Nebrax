import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('demo', 'true');
    localStorage.setItem('user', JSON.stringify({
      id: 'demo-user',
      name: 'مستخدم المعاينة',
      email: 'demo@awj.test',
      role: 'owner',
      permissions: ['*'],
      tenant_id: 'demo-tenant',
    }));
    document.cookie = 'locale=ar; path=/';
  });
});

test('searches help articles and opens an article', async ({ page }) => {
  await page.goto('/help');

  await expect(page.getByRole('heading', { name: 'مركز مساعدة أَوْج' })).toBeVisible();
  await page.getByPlaceholder('ابحث عن فاتورة، منتج، جرد، قيد…').fill('جرد مخزني');
  await expect(page.getByText('تنفيذ جرد مخزني', { exact: true })).toBeVisible();
  await expect(page.getByText('إنشاء فاتورة مبيعات', { exact: true })).toHaveCount(0);

  await page.getByRole('link', { name: /تنفيذ جرد مخزني/ }).click();
  await expect(page).toHaveURL(/\/help\/run-stocktake$/);
  await expect(page.getByRole('heading', { name: 'تنفيذ جرد مخزني' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'بدء جرد' })).toBeVisible();
});

test('keeps the Help Center reachable on a mobile viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile-only navigation check');
  await page.goto('/help');

  await expect(page.getByRole('heading', { name: 'مركز مساعدة أَوْج' })).toBeVisible();
  await expect(page.getByPlaceholder('ابحث عن فاتورة، منتج، جرد، قيد…')).toBeVisible();

  await page.getByRole('button', { name: 'الحساب' }).click();
  await expect(page.getByRole('menuitem', { name: 'مركز المساعدة' })).toBeVisible();
});
