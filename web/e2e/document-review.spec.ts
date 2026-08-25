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

    const createDraft = page.getByRole('button', { name: 'إنشاء مسودة مشتريات' });
    await expect(createDraft).toBeVisible();
    await createDraft.click();
    await fillDecision(page, 'إنشاء مسودة مشتريات من الدليل المراجع.');
    await page.getByRole('button', { name: 'إنشاء مسودة مشتريات' }).last().click();
    await expect(page.getByRole('link', { name: /فتح مسودة المشتريات PUR-DRAFT-2084/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'إكمال المراجعة' })).toHaveCount(0);

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


test.describe('مسودة Expense في fixture واجهة محلي', () => {
  test('يعرض إجراء المسودة الجاهزة ثم يطلب الخيارات غير المالية ويربط المسودة في الواجهة', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/documents/demo-batch-002', { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: 'مراجعة المستند' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'إنشاء مسودة مصروف' })).toBeVisible();
    await page.getByRole('button', { name: 'إنشاء مسودة مصروف' }).click();

    await expect(page.getByRole('dialog', { name: 'إنشاء مسودة مصروف' })).toBeVisible();
    await page.locator('#expense-draft-reason').fill('إنشاء مسودة مصروف من الدليل المراجع في fixture الواجهة.');
    await page.locator('#expense-draft-account').selectOption('demo-expense-account-5130');
    await page.locator('#expense-draft-category').selectOption('demo-expense-category-services');
    await page.locator('#expense-draft-cost-center').selectOption('demo-expense-cost-center-admin');
    await page.locator('#expense-draft-payment-method').selectOption('bank');
    await page.getByRole('button', { name: 'إنشاء مسودة مصروف' }).last().click();

    await expect(page.getByRole('link', { name: /فتح مسودة المصروف EXP-DRAFT-0417/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'إكمال المراجعة' })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  });
});
