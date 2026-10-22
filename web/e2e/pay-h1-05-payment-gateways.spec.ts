import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * PAY-H1-05 — الإعدادات › المالية › بوابات الدفع في متصفح حقيقي (سطح مكتب 1440 + جوال 390، عربي/إنجليزي، فاتح/داكن):
 * القائمة والشارات، سبب تعطيل التفعيل لمزوّد حقيقي غير مُتحقَّق منه، معالج الإضافة، سجل الأحداث، قراءة فقط بلا إجراءات،
 * وعدم ظهور أي سر. اللقطات تُكتب فقط حين يُضبط `PAY_H105_SHOTS`.
 */

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.PAY_H105_SHOTS;

const CONNECTIONS = [
  { id: 'g1', provider: 'custom', name: 'تحويل بنكي يدوي', name_en: 'Manual bank link', environment: 'live', status: 'active', is_usable: true, merchant_reference: null, publishable_key: null, has_secret_key: false, has_webhook_secret: false, has_extra_credentials: false, credential_version: 1, previous_secret_valid_until: null, verified_at: null, activated_at: '2026-10-01T08:00:00Z', deactivated_at: null, created_at: '2026-09-30T08:00:00Z' },
  { id: 'g2', provider: 'stripe', name: 'سترايب التجريبي', name_en: 'Stripe sandbox', environment: 'sandbox', status: 'draft', is_usable: false, merchant_reference: 'acct_demo', publishable_key: 'pk_test_demo', has_secret_key: true, has_webhook_secret: true, has_extra_credentials: false, credential_version: 3, previous_secret_valid_until: '2026-10-22T20:00:00Z', verified_at: null, activated_at: null, deactivated_at: null, created_at: '2026-10-10T08:00:00Z' },
  { id: 'g3', provider: 'tap', name: 'تاب القديم', name_en: 'Old Tap', environment: 'live', status: 'revoked', is_usable: false, merchant_reference: null, publishable_key: null, has_secret_key: false, has_webhook_secret: false, has_extra_credentials: false, credential_version: 2, previous_secret_valid_until: null, verified_at: '2026-08-01T08:00:00Z', activated_at: '2026-08-02T08:00:00Z', deactivated_at: '2026-09-01T08:00:00Z', created_at: '2026-07-30T08:00:00Z' },
];

const EVENTS = [
  { id: 'e2', event_type: 'credentials_rotated', from_status: 'draft', to_status: 'draft', credential_version: 3, actor_user_id: 'u', reason: null, changed_fields: ['secret_key', 'webhook_secret'], occurred_at: '2026-10-20T10:00:00Z' },
  { id: 'e1', event_type: 'created', from_status: null, to_status: 'draft', credential_version: 1, actor_user_id: 'u', reason: null, changed_fields: null, occurred_at: '2026-10-10T08:00:00Z' },
];

async function open(page: Page, opts: { locale: 'ar' | 'en'; theme?: 'light' | 'dark'; permissions?: string[]; rows?: unknown[] }) {
  await page.context().addCookies([{ name: 'locale', value: opts.locale, url: baseUrl }]);
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    if (path === '/applications/nav-state') return json(route, { data: {} });
    if (path === '/payment-gateways' && method === 'GET') return json(route, { data: opts.rows ?? CONNECTIONS });
    if (/^\/payment-gateways\/[^/]+\/events$/.test(path)) return json(route, { data: EVENTS });
    if (path === '/me') return json(route, { user, company: { name: 'Acme' } });
    return json(route, { data: [] });
  });

  const user = { id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: 'owner', permissions: opts.permissions ?? ['*'] };
  await page.addInitScript(([userJson, theme]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    localStorage.setItem('theme', theme);
  }, [JSON.stringify(user), opts.theme ?? 'light'] as const);
  await page.goto(`${baseUrl}/finance-settings/payments`, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
}

const noHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
};
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};

for (const locale of ['ar', 'en'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`PAY-H1-05 list, wizard and history (${locale}, ${theme})`, async ({ page }, info) => {
      await open(page, { locale, theme });
      const tag = `${info.project.name}-${locale}-${theme}`;
      const dir = locale === 'ar' ? 'rtl' : 'ltr';

      await expect(page.locator('html')).toHaveAttribute('dir', dir);
      await expect(page.getByTestId('pg-list')).toBeVisible();
      await expect(page.getByTestId('pg-item-g1')).toBeVisible();
      // مزوّد حقيقي غير مُتحقَّق منه: التفعيل معطّل بسببه المعلن، ولا سر في الصفحة.
      const stripe = page.getByTestId('pg-item-g2');
      await expect(stripe.getByRole('button', { name: locale === 'ar' ? 'تفعيل' : 'Activate' })).toBeDisabled();
      expect(await page.locator('body').innerText()).not.toMatch(/sk_|whsec_/);
      await noHorizontalOverflow(page);
      await shot(page, `${tag}-list`);

      await page.getByRole('button', { name: locale === 'ar' ? 'إضافة اتصال' : 'Add connection' }).first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByLabel(locale === 'ar' ? 'الاسم' : 'Name', { exact: true }).fill('Test');
      await dialog.getByRole('button', { name: locale === 'ar' ? 'التالي' : 'Next' }).click();
      await expect(dialog.getByLabel(locale === 'ar' ? 'المفتاح السري' : 'Secret key')).toHaveAttribute('type', 'password');
      await noHorizontalOverflow(page);
      await shot(page, `${tag}-wizard-step2`);
      await dialog.getByRole('button', { name: locale === 'ar' ? 'التالي' : 'Next' }).click();
      await expect(page.getByTestId('pg-review')).toBeVisible();
      await shot(page, `${tag}-wizard-review`);
      await dialog.getByRole('button', { name: locale === 'ar' ? 'إلغاء' : 'Cancel' }).click();

      await stripe.getByRole('button', { name: locale === 'ar' ? 'السجل' : 'History' }).click();
      await expect(page.getByTestId('pg-events')).toBeVisible();
      await noHorizontalOverflow(page);
      await shot(page, `${tag}-events`);
    });
  }

  test(`PAY-H1-05 read-only viewer has no actions and an empty state is calm (${locale})`, async ({ page }, info) => {
    await open(page, { locale, permissions: ['payments.view'] });
    await expect(page.getByTestId('pg-item-g1')).toBeVisible();
    await expect(page.getByTestId('pg-list').getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('button', { name: locale === 'ar' ? 'إضافة اتصال' : 'Add connection' })).toHaveCount(0);
    await noHorizontalOverflow(page);
    await shot(page, `${info.project.name}-${locale}-readonly`);

    const empty = await page.context().newPage();
    await open(empty, { locale, rows: [] });
    await expect(empty.getByTestId('pg-empty')).toBeVisible();
    await noHorizontalOverflow(empty);
    await shot(empty, `${info.project.name}-${locale}-empty`);
  });
}
