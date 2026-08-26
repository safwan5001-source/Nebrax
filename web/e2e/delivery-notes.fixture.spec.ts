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

  test('keeps a linked draft visible but hides invoice navigation for a delivery-note-only fixture role', async ({ page }) => {
    await seedLocalFixture(page, 'ar', ['delivery_notes.view', 'delivery_notes.invoice'], 'delivery-invoicer');
    await page.goto('/delivery-notes/dn-100');

    await expect(page.getByText(/مرتبط بالفعل بالمسودة/)).toBeVisible();
    await expect(page.locator('main a[href^="/invoices/"]')).toHaveCount(0);
  });

  test('shows linked invoice navigation only to a fixture role with invoices.view', async ({ page }) => {
    await seedLocalFixture(page, 'ar', ['delivery_notes.view', 'delivery_notes.invoice', 'invoices.view'], 'invoice-viewer');
    await page.goto('/delivery-notes/dn-100');

    await expect(page.getByText(/مرتبط بالفعل بالمسودة/)).toBeVisible();
    await expect(page.locator('main a[href^="/invoices/"]').first()).toBeVisible();
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


test.describe('Delivery notes to invoice draft — local fixture only', () => {
  test('previews compatible confirmed notes and creates one draft without posting', async ({ page }, testInfo) => {
    await seedLocalFixture(page);
    await page.goto('/delivery-notes/invoice-draft?notes=dn-103,dn-102');

    await expect(page.getByRole('heading', { name: 'إنشاء مسودة فاتورة مبيعات' })).toBeVisible();
    await expect(page.getByText('إنشاء مسودة فقط')).toBeVisible();
    await expect(page.getByLabel('اختيار سند التسليم DN-2026-00103').first()).toBeChecked();
    await expect(page.getByLabel('اختيار سند التسليم DN-2026-00102').first()).toBeChecked();
    await page.getByRole('button', { name: 'معاينة الأهلية والتسعير' }).click();
    await expect(page.getByLabel('سبب إنشاء المسودة')).toBeVisible();
    await page.getByLabel('سبب إنشاء المسودة').fill('تجميع دفعات تسليم متوافقة في مسودة مراجعة.');
    await page.getByRole('button', { name: 'إنشاء مسودة الفاتورة' }).click();
    await expect(page.getByText('تم إنشاء مسودة فاتورة المبيعات.')).toBeVisible();
    await expect(page.getByText('لم تُرحّل ولم تُنشئ أي قيد أو دفعة أو حركة مخزون.')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`delivery-notes-invoice-draft-${testInfo.project.name}-rtl-light.png`), fullPage: true });
  });

  test('shows a pre-linked note as unavailable while keeping an unlinked note selectable', async ({ page }) => {
    await seedLocalFixture(page);
    await page.goto('/delivery-notes/invoice-draft?notes=dn-100,dn-103');

    await expect(page.getByLabel('اختيار سند التسليم DN-2026-00100').first()).toBeDisabled();
    await expect(page.locator('span.text-xs.text-negative:visible').filter({ hasText: 'مرتبط بالفعل بالمسودة' })).toBeVisible();
    await expect(page.getByLabel('اختيار سند التسليم DN-2026-00103').first()).toBeEnabled();
  });

  test('shows a local fixture mixed-customer eligibility error and keeps the build action disabled', async ({ page }, testInfo) => {
    await seedLocalFixture(page);
    await page.goto('/delivery-notes/invoice-draft?notes=dn-103,dn-101');
    await page.getByRole('button', { name: 'معاينة الأهلية والتسعير' }).click();
    await expect(page.getByText('يجب أن تشترك السندات في العميل نفسه.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'إنشاء مسودة الفاتورة' })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath(`delivery-notes-invoice-draft-${testInfo.project.name}-mixed-rtl.png`), fullPage: true });
  });

  test('renders the LTR invoice-draft wizard and local-fixture boundary label without overflow', async ({ page }, testInfo) => {
    await seedLocalFixture(page, 'en');
    await page.goto('/delivery-notes/invoice-draft?notes=dn-103,dn-102');
    await expect(page.getByRole('heading', { name: 'Create sales invoice draft' })).toBeVisible();
    await expect(page.getByText('Draft creation only')).toBeVisible();
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`delivery-notes-invoice-draft-${testInfo.project.name}-ltr-light.png`), fullPage: true });
  });
});
