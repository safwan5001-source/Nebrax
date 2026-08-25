import { expect, test } from '@playwright/test';

async function enterDemo(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    localStorage.setItem('demo', 'true');
    localStorage.setItem('user', JSON.stringify({
      id: 'demo-user',
      name: 'مستخدم المعاينة',
      email: 'demo@nibras.test',
      role: 'owner',
      tenant_id: 'demo-tenant',
    }));
  });
}

async function openSection(page: import('@playwright/test').Page, name: string) {
  const tab = page.getByRole('tab', { name });
  if (await tab.isVisible()) await tab.click();
}

async function fillDecision(page: import('@playwright/test').Page, reason: string) {
  await page.locator('textarea').fill(reason);
}

test.describe('مساحة مراجعة المستند في وضع المعاينة', () => {
  test('يفتح الحزمة ويعدل الدليل ويؤكد المطابقة ويعيد التحقق المالي ثم يكمل المراجعة', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/documents', { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: 'مركز المستندات' })).toBeVisible();
    await expect(page.locator('a:visible').filter({ hasText: 'فتح المراجعة' }).first()).toBeVisible();
    await page.locator('a:visible').filter({ hasText: 'فتح المراجعة' }).first().click();

    await expect(page.getByRole('heading', { name: 'مراجعة المستند' })).toBeVisible();
    await expect(page.locator('p:visible').filter({ hasText: 'شركة الجزيرة للتوريدات الصناعية' }).first()).toBeVisible();

    await openSection(page, 'التفاصيل');
    await page.getByRole('button', { name: 'تعديل' }).first().click();
    await page.locator('#review-change-value').fill('PI-2084-R');
    await page.locator('#review-change-reason').fill('تصحيح رقم المستند من الدليل.');
    await page.getByRole('button', { name: 'حفظ التصحيح' }).click();

    await openSection(page, 'المطابقات');
    await page.getByRole('button', { name: 'تأكيد' }).first().click();
    await fillDecision(page, 'تأكيد المورّد المطابق.');
    await page.getByRole('button', { name: 'تأكيد' }).last().click();

    await openSection(page, 'المشكلات');
    await page.getByRole('button', { name: 'إعادة التحقق المالي' }).click();
    await fillDecision(page, 'إعادة تحقق مالي بعد مراجعة الدليل.');
    await page.getByRole('button', { name: 'إعادة التحقق المالي' }).last().click();

    const complete = page.getByRole('button', { name: 'إكمال المراجعة' });
    await expect(complete).toBeEnabled();
    await complete.click();
    await fillDecision(page, 'اكتملت المراجعة البشرية.');
    await page.getByRole('button', { name: 'إكمال المراجعة' }).last().click();
    await openSection(page, 'التفاصيل');
    await expect(page.locator('span:visible').filter({ hasText: 'جاهزة للمسودة' }).first()).toBeVisible();
    await openSection(page, 'السجل');
    await expect(page.locator('p:visible').filter({ hasText: 'اكتملت المراجعة البشرية.' }).first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  });

  test('يعرض رسالة تعارض النسخة عند تعديل fixture متعمد قديم', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/documents/demo-batch-001', { waitUntil: 'networkidle' });

    await page.getByRole('button', { name: 'تعديل' }).first().click();
    await page.locator('#review-change-reason').fill('[stale] تحقق من تعارض النسخة');
    await page.getByRole('button', { name: 'حفظ التصحيح' }).click();

    await expect(page.getByText('تغيّرت الحزمة لدى مراجع آخر', { exact: false }).first()).toBeVisible();
  });
});
