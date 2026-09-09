import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context, page }) => {
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
  });
  await context.addCookies([{ name: 'locale', value: 'ar', domain: '127.0.0.1', path: '/' }]);
});

test('searches help articles and opens an article', async ({ page }) => {
  await page.goto('/help');

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'مركز مساعدة أَوْج' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'كيف يمكننا مساعدتك؟' }).fill('جرد مخزني');
  await expect(page.getByText('تنفيذ جرد مخزني', { exact: true })).toBeVisible();
  await expect(page.getByText('إنشاء فاتورة مبيعات', { exact: true })).toHaveCount(0);

  await page.getByRole('link', { name: /تنفيذ جرد مخزني/ }).click();
  await expect(page).toHaveURL(/\/help\/run-stocktake$/);
  await expect(page.getByRole('heading', { name: 'تنفيذ جرد مخزني' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'بدء جرد' })).toBeVisible();
});

test('supports English LTR search and article navigation', async ({ context, page }) => {
  await context.addCookies([{ name: 'locale', value: 'en', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/help');

  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await page.getByRole('searchbox', { name: 'How can we help?' }).fill('stock count');
  await page.getByRole('link', { name: /Run a stocktake/ }).click();
  await expect(page).toHaveURL(/\/help\/run-stocktake$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Run a stocktake' })).toBeVisible();
});

test('falls back safely to Arabic for an unexpected locale cookie', async ({ context, page }) => {
  await context.addCookies([{ name: 'locale', value: 'unexpected', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/help');

  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'مركز مساعدة أَوْج' })).toBeVisible();
});

test('renders an explicit state for an unknown article slug', async ({ page }) => {
  await page.goto('/help/not-a-help-article');

  await expect(page.getByRole('heading', { level: 1, name: 'المقال غير موجود' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'العودة إلى مركز المساعدة' })).toHaveAttribute('href', '/help');
});

test('traps contextual Sheet focus and restores the desktop trigger on Escape', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop-only top-bar focus check');
  await page.goto('/dashboard');

  const trigger = page.getByRole('button', { name: 'مساعدة هذه الشاشة' });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('opens and closes contextual Help from the mobile account menu', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile-only contextual focus check');
  await page.goto('/dashboard');

  const account = page.getByRole('button', { name: 'الحساب' });
  await account.click();
  await page.getByRole('menuitem', { name: 'مساعدة هذه الشاشة' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(account).toBeFocused();
});

test('keeps the Help Center reachable on a mobile viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile-only navigation check');
  await page.goto('/help');

  await expect(page.getByRole('heading', { name: 'مركز مساعدة أَوْج' })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'كيف يمكننا مساعدتك؟' })).toBeVisible();

  await page.getByRole('button', { name: 'الحساب' }).click();
  await expect(page.getByRole('menuitem', { name: 'مركز المساعدة' })).toBeVisible();
});
