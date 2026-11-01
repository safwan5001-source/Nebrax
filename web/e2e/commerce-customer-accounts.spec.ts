import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Commerce → Store settings → Customer accounts — real-browser QA (desktop 1440 + phone 390, ar RTL / en LTR).
 * The API is fully intercepted with fixtures that exist ONLY in this spec; no backend runs. Screenshots are written
 * only when `CUSTOMER_ACCOUNTS_SHOTS` points to a folder.
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.CUSTOMER_ACCOUNTS_SHOTS;
const CH_A = 'c1111111-1111-4111-8111-111111111111';
const CH_B = 'c2222222-2222-4222-8222-222222222222';

type Scenario = { aEnabled?: boolean; deployment?: boolean; putStatus?: number; putReason?: string };

async function open(page: Page, opts: { locale?: 'ar' | 'en'; permissions?: string[]; scenario?: Scenario; path?: string } = {}) {
  const locale = opts.locale ?? 'ar';
  const scenario = { aEnabled: false, deployment: true, putStatus: 200, ...opts.scenario };
  const state = { a: scenario.aEnabled, b: true };
  const requests: string[] = [];
  const bodies: unknown[] = [];
  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const user = { id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: 'owner', permissions: opts.permissions ?? ['*'] };
  const settings = (id: string) => ({
    id, name: id === CH_A ? 'Rose web channel' : 'Tulip web channel', type: 'web',
    customer_accounts_enabled: id === CH_A ? state.a : state.b,
    customer_accounts_deployment_enabled: scenario.deployment,
    recent_changes: [],
  });
  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    const p = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    requests.push(`${method} ${p}`);
    if (p === '/applications/nav-state') return json(route, { data: {} });
    if (p === '/me') return json(route, { user, company: { name: 'Acme' } });
    if (p === '/commerce/workspace/storefronts') {
      return json(route, { data: { stores: [
        { id: 's1', name: 'متجر الورد', sales_channel_id: CH_A, is_active: true, default_locale: 'ar', business_vertical: 'general', domains: [] },
        { id: 's2', name: 'Tulip Outlet', sales_channel_id: CH_B, is_active: true, default_locale: 'en', business_vertical: 'general', domains: [] },
      ] } });
    }
    const match = p.match(/^\/commerce\/channels\/([^/]+)\/pricing-settings$/);
    if (match) {
      if (method === 'PUT') {
        bodies.push(JSON.parse(route.request().postData() ?? '{}'));
        if (scenario.putStatus !== 200) return json(route, { message: 'x', reason: scenario.putReason ?? 'server_error' }, scenario.putStatus);
        const next = (bodies.at(-1) as { customer_accounts_enabled: boolean }).customer_accounts_enabled;
        if (match[1] === CH_A) state.a = next; else state.b = next;
      }
      return json(route, { data: settings(match[1]) });
    }
    return json(route, { data: [] });
  });
  await page.addInitScript(([userJson]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
  }, [JSON.stringify(user)] as const);
  await page.goto(`${baseUrl}${opts.path ?? '/commerce/customer-accounts?store=s1'}`, { waitUntil: 'domcontentloaded' });
  return { requests, bodies };
}

const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};
const noHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
};

test.describe('Customer accounts settings', () => {
  test('ar RTL: shows the store, the disabled state, saves only after confirmation', async ({ page }) => {
    const { bodies } = await open(page, { locale: 'ar' });
    await expect(page.getByRole('heading', { name: 'حسابات العملاء' }).first()).toBeVisible();
    expect(await page.locator('html').getAttribute('dir')).toBe('rtl');
    await expect(page.getByTestId('selected-store')).toHaveText('متجر الورد');
    await expect(page.getByTestId('accounts-status')).toHaveText('غير مفعّلة');
    await expect(page.getByTestId('status-body')).toContainText('الشراء كضيف يبقى متاحاً');
    await shot(page, 'ar-disabled');
    await noHorizontalOverflow(page);

    const toggle = page.getByRole('switch');
    const box = await toggle.boundingBox();
    // The switch sits in a 44px-high row; the row itself is the touch target.
    expect(box!.height).toBeGreaterThanOrEqual(24);
    await toggle.click();
    await expect(page.getByText('تغييرات غير محفوظة')).toBeVisible();
    await shot(page, 'ar-unsaved');
    await page.getByRole('button', { name: 'حفظ' }).click();
    await expect(page.getByTestId('accounts-status')).toHaveText('مفعّلة');
    await expect(page.getByTestId('status-body')).toContainText('التسجيل وتسجيل الدخول متاحان الآن');
    expect(bodies).toEqual([{ customer_accounts_enabled: true }]);
    await shot(page, 'ar-enabled');
    await noHorizontalOverflow(page);
  });

  test('en LTR: enabled state and discard', async ({ page }) => {
    await open(page, { locale: 'en', scenario: { aEnabled: true } });
    await expect(page.getByRole('heading', { name: 'Customer accounts' }).first()).toBeVisible();
    expect(await page.locator('html').getAttribute('dir')).toBe('ltr');
    await expect(page.getByTestId('accounts-status')).toHaveText('Enabled');
    await page.getByRole('switch').click();
    await expect(page.getByText(/cannot create new accounts or sign in/)).toBeVisible();
    await shot(page, 'en-turn-off-draft');
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await noHorizontalOverflow(page);
  });

  test('409 deployment gate is reported and the persisted state does not change', async ({ page }) => {
    await open(page, { locale: 'en', scenario: { putStatus: 409, putReason: 'customer_accounts_deployment_disabled' } });
    await page.getByRole('switch').click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alert')).toContainText('deployment switch is closed');
    await expect(page.getByText('Customer accounts setting saved')).toHaveCount(0);
    await expect(page.getByTestId('accounts-status')).toHaveText('Disabled');
    await shot(page, 'en-409');
  });

  test('switching to another store reads that store’s own channel', async ({ page }) => {
    const { requests } = await open(page, { locale: 'en' });
    await expect(page.getByTestId('selected-store')).toHaveText('متجر الورد');
    // Phones use the in-page <select>; from md up the shell header offers a dropdown.
    const select = page.locator('select[aria-label="Current store"]');
    if (await select.isVisible()) {
      await select.selectOption('s2');
    } else {
      await page.getByRole('button', { name: 'Current store' }).click();
      await page.getByRole('menuitem', { name: 'Tulip Outlet' }).click();
    }
    await expect(page.getByTestId('selected-store')).toHaveText('Tulip Outlet');
    await expect(page.getByTestId('accounts-status')).toHaveText('Enabled');
    expect(requests.filter((r) => r.startsWith('GET /commerce/channels/'))).toEqual([
      `GET /commerce/channels/${CH_A}/pricing-settings`,
      `GET /commerce/channels/${CH_B}/pricing-settings`,
    ]);
  });

  test('without commerce.channel_settings.manage: denied state and no settings request', async ({ page }) => {
    const { requests } = await open(page, { locale: 'en', permissions: ['commerce.manage'] });
    await expect(page.getByText('You do not have access to this screen')).toBeVisible();
    await expect(page.getByRole('switch')).toHaveCount(0);
    expect(requests.some((r) => r.includes('pricing-settings'))).toBe(false);
    await shot(page, 'en-denied');
  });
});
