import { expect, test } from '@playwright/test';

async function seedLocalFixture(page: import('@playwright/test').Page, locale: 'ar' | 'en' = 'ar', permissions: string[] = ['*'], role = 'owner') {
  await page.context().addCookies([{ name: 'locale', value: locale, domain: '127.0.0.1', path: '/' }]);
  await page.addInitScript(({ locale: selectedLocale, selectedPermissions, selectedRole }) => {
    localStorage.setItem('demo', 'true');
    localStorage.setItem('user', JSON.stringify({
      id: 'demo-user', name: 'Fixture user', email: 'fixture@nibras.test', role: selectedRole,
      permissions: selectedPermissions, tenant_id: 'fixture-tenant', preferences: { locale: selectedLocale, theme: 'light' },
    }));
    localStorage.setItem('theme', 'light');
  }, { locale, selectedPermissions: permissions, selectedRole: role });
}

test.describe('Delivery notes — local fixture only', () => {
  test('renders the RTL desktop list with filters and fixture data', async ({ page }, testInfo) => {
    await seedLocalFixture(page);
    await page.goto('/delivery-notes');
    await expect(page.getByRole('heading', { name: 'سندات التسليم' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'DN-2026-00104' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'سند تسليم جديد' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`delivery-notes-${testInfo.project.name}-rtl-light.png`), fullPage: true });
  });

  test('creates a draft through the responsive fixture form and confirms it to read-only', async ({ page }, testInfo) => {
    await seedLocalFixture(page);
    await page.goto('/delivery-notes/new');
    await expect(page.getByRole('heading', { name: 'سند تسليم جديد' })).toBeVisible();
    await page.getByRole('button', { name: 'المنتج 1' }).click();
    await page.getByRole('option', { name: /جهاز قياس رقمي/ }).click();
    await page.getByRole('button', { name: 'حفظ كمسودة' }).click();
    await expect(page.getByRole('heading', { name: /DN-2026-/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'تأكيد التسليم' })).toBeVisible();
    await page.getByRole('button', { name: 'تأكيد التسليم' }).click();
    await expect(page.getByText('هذا السند مؤكد للقراءة فقط.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'تعديل' })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`delivery-notes-${testInfo.project.name}-confirmed-rtl.png`), fullPage: true });
  });

  test('keeps sensitive actions hidden for a view-only fixture user', async ({ page }) => {
    await seedLocalFixture(page, 'ar', ['delivery_notes.view'], 'staff');
    await page.goto('/delivery-notes/dn-104');
    await expect(page.getByRole('heading', { name: 'DN-2026-00104' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'تعديل' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'تأكيد التسليم' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'إلغاء السند' })).toHaveCount(0);
  });

  test('renders the LTR dark fixture without horizontal overflow', async ({ page }, testInfo) => {
    await seedLocalFixture(page, 'en');
    await page.goto('/delivery-notes');
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await expect(page.getByRole('heading', { name: 'Delivery notes' })).toBeVisible();
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`delivery-notes-${testInfo.project.name}-ltr-dark.png`), fullPage: true });
  });
});
