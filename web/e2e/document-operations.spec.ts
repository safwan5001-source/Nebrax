import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('demo', 'true');
    localStorage.setItem('user', JSON.stringify({ id: 'demo-user', name: 'مستخدم المعاينة', email: 'demo@nibras.test', role: 'owner', permissions: ['*'], tenant_id: 'demo-tenant' }));
  });
});

test('renders tenant operations and safe visible processing state', async ({ page }) => {
  await page.goto('/documents/operations');
  await expect(page.getByRole('heading', { name: /Document operations|عمليات المستندات/ })).toBeVisible();
  await expect(page.locator('span:visible').filter({ hasText: /retry may be available|قد تتاح إعادة المحاولة/ }).first()).toBeVisible();
  await expect(page.locator('a:visible').filter({ hasText: /View diagnostics|عرض التشخيص/ }).first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('demo-object-key');
});

test('renders tenant usage and governance as evidence-only surfaces', async ({ page }) => {
  await page.goto('/documents/usage');
  await expect(page.getByText(/Recorded cost|التكلفة المسجلة/)).toBeVisible();
  await expect(page.getByText(/Cost is not available|التكلفة غير متاحة/)).toBeVisible();
  await page.goto('/documents/governance');
  await expect(page.getByRole('heading', { name: /Retention and redaction governance|حوكمة الاحتفاظ والحجب/ })).toBeVisible();
  await expect(page.getByText('fields.issuer_name · privacy_request')).toBeVisible();
});

test('renders separately scoped platform document operations', async ({ page }) => {
  await page.goto('/platform/document-operations');
  await expect(page.getByRole('heading', { name: /Document Center operations — platform|عمليات مركز المستندات — المنصة/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Back|رجوع|العودة إلى المنصة/ })).toHaveAttribute('href', '/platform');
  await expect(page.getByText(/Worker offline|العامل غير متصل/)).toBeVisible();
  await expect(page.getByText(/Provider network is locked|شبكة المزود مقفلة/).first()).toBeVisible();
  await expect(page.getByText(/Resume cursor|مؤشر الاستئناف/).first()).toBeVisible();
  await page.getByRole('button', { name: /Run retention|تشغيل الاحتفاظ/ }).click();
  await expect(page.getByText(/The governed retention run completed|اكتمل تشغيل الاحتفاظ المحكوم/)).toBeVisible();
  await expect(page.getByText(/The run will start with the first file|سيبدأ التشغيل من أول ملف/)).toBeVisible();

  const exportRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/platform/document-audit/export')) exportRequests.push(request.url());
  });
  await page.getByRole('button', { name: /Export audit|تصدير سجل التدقيق/ }).click();
  await expect(page.getByRole('status')).toContainText(/Preview does not create an export file|المعاينة لا تُنشئ ملف تصدير/);
  await expect(page.getByRole('status')).not.toContainText(/The safe CSV download has started|تم بدء تنزيل ملف CSV الآمن/);
  expect(exportRequests).toEqual([]);
});
