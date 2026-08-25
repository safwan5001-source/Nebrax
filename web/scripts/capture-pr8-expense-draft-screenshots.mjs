import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const outputDir = resolve(process.cwd(), '../docs/intelligent-document-center/screenshots/pr-8-expense-draft');
const user = {
  id: 'demo-user',
  name: 'مستخدم المعاينة',
  email: 'demo@nibras.test',
  role: 'owner',
  tenant_id: 'demo-tenant',
};

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });

async function openDemo({ locale, theme, viewport }) {
  const context = await browser.newContext({ viewport });
  await context.addCookies([{ name: 'locale', value: locale, url: baseURL }]);
  const page = await context.newPage();
  await page.addInitScript(({ demoUser, selectedTheme }) => {
    localStorage.setItem('demo', 'true');
    localStorage.setItem('user', JSON.stringify(demoUser));
    localStorage.setItem('theme', selectedTheme);
  }, { demoUser: user, selectedTheme: theme });
  await page.goto(`${baseURL}/documents/demo-batch-002`, { waitUntil: 'networkidle' });
  return { context, page };
}

const desktop = { width: 1440, height: 960 };
const mobile = { width: 390, height: 844 };

async function createExpenseFixture(page, label) {
  await page.getByRole('button', { name: label }).first().click();
  await page.locator('#expense-draft-reason').fill('واجهة fixture لمسودة Expense من الدليل المراجع.');
  await page.locator('#expense-draft-account').selectOption('demo-expense-account-5130');
  await page.locator('#expense-draft-category').selectOption('demo-expense-category-services');
  await page.locator('#expense-draft-cost-center').selectOption('demo-expense-cost-center-admin');
  await page.locator('#expense-draft-payment-method').selectOption('bank');
  await page.getByRole('button', { name: label }).last().click();
}

async function assertRtlDraftCreatedReadOnly(page) {
  const readiness = page.getByText('أكمل المطابقات والمشكلات المانعة قبل إكمال المراجعة.', { exact: true });
  if (await readiness.count() !== 0) throw new Error('draft_created must not show the readiness blocker');

  for (const label of ['إنشاء مسودة مصروف', 'تعديل', 'تأكيد', 'رفض', 'حل المشكلة', 'إعادة فتح', 'إعادة التحقق المالي', 'إكمال المراجعة']) {
    if (await page.getByRole('button', { name: label }).count() !== 0) {
      throw new Error(`draft_created must not render the review command: ${label}`);
    }
  }
}

const rtl = await openDemo({ locale: 'ar', theme: 'light', viewport: desktop });
await rtl.page.screenshot({ path: resolve(outputDir, 'rtl-desktop-ready-light.png'), fullPage: true });
await rtl.page.getByRole('button', { name: 'إنشاء مسودة مصروف' }).click();
await rtl.page.locator('#expense-draft-reason').fill('لقطة واجهة لمسودة Expense من الدليل المراجع.');
await rtl.page.locator('#expense-draft-account').selectOption('demo-expense-account-5130');
await rtl.page.locator('#expense-draft-category').selectOption('demo-expense-category-services');
await rtl.page.locator('#expense-draft-cost-center').selectOption('demo-expense-cost-center-admin');
await rtl.page.locator('#expense-draft-payment-method').selectOption('bank');
await rtl.page.screenshot({ path: resolve(outputDir, 'rtl-desktop-dialog-light.png'), fullPage: true });
await rtl.page.getByRole('button', { name: 'إنشاء مسودة مصروف' }).last().click();
await rtl.page.getByRole('link', { name: /فتح مسودة المصروف EXP-DRAFT-0417/ }).waitFor();
await assertRtlDraftCreatedReadOnly(rtl.page);
await rtl.page.screenshot({ path: resolve(outputDir, 'rtl-desktop-linked-light.png'), fullPage: true });
await rtl.page.screenshot({ path: resolve(outputDir, 'rtl-desktop-draft-created-read-only-light.png'), fullPage: true });
await rtl.context.close();

const rtlMobile = await openDemo({ locale: 'ar', theme: 'dark', viewport: mobile });
await createExpenseFixture(rtlMobile.page, 'إنشاء مسودة مصروف');
await rtlMobile.page.getByRole('link', { name: /فتح مسودة المصروف EXP-DRAFT-0417/ }).waitFor();
await rtlMobile.page.screenshot({ path: resolve(outputDir, 'rtl-mobile-linked-dark.png'), fullPage: true });
await rtlMobile.context.close();

const ltr = await openDemo({ locale: 'en', theme: 'dark', viewport: desktop });
await createExpenseFixture(ltr.page, 'Create expense draft');
await ltr.page.getByRole('link', { name: /Open expense draft EXP-DRAFT-0417/ }).waitFor();
await ltr.page.screenshot({ path: resolve(outputDir, 'ltr-desktop-linked-dark.png'), fullPage: true });
await ltr.context.close();

await browser.close();
console.log(outputDir);
