import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * COPS-H4-1 — مركز إعدادات المتجر في متصفح حقيقي (سطح مكتب 1440 + جوال 390، عربي/إنجليزي، فاتح/داكن). الخادم مُعترَض بالكامل.
 * يتحقق من: الاتجاه، عدم تجاوز العرض الأفقي، تصفية البطاقات بالصلاحية والقدرة، وأن الصفحة قراءة فقط (لا كتابة).
 * اللقطات تُكتب فقط حين يُضبط `H41_SHOTS` (مجلد خارج المستودع).
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.H41_SHOTS;

async function open(page: Page, opts: { locale?: 'ar' | 'en'; theme?: 'light' | 'dark'; permissions?: string[]; navState?: Record<string, boolean> } = {}) {
  const locale = opts.locale ?? 'ar';
  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  const requests: string[] = [];
  const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  const user = { id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: 'owner', permissions: opts.permissions ?? ['*'] };
  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    const p = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    requests.push(`${method} ${p}`);
    if (p === '/applications/nav-state') return json(route, { data: opts.navState ?? {} });
    if (p === '/commerce/workspace/storefronts') return json(route, { data: { stores: [{ id: 's1', name: 'زهور طيبة', sales_channel_id: 'c1', is_active: true, default_locale: 'ar', business_vertical: 'general', domains: [] }] } });
    if (p === '/me') return json(route, { user, company: { name: 'Acme' } });
    return json(route, { data: [] });
  });
  await page.addInitScript(([userJson, theme]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    localStorage.setItem('theme', theme);
  }, [JSON.stringify(user), opts.theme ?? 'light'] as const);
  await page.goto(`${baseUrl}/commerce/settings`, { waitUntil: 'domcontentloaded' });
  return requests;
}

const cards = (page: Page) => page.locator('main ul a, ul a').filter({ hasText: /\S/ }).locator('visible=true');
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};
const writes = (requests: string[]) => requests.filter((r) => /^(POST|PUT|PATCH|DELETE) /.test(r));

test.describe('H4-1 store settings hub', () => {
  for (const locale of ['ar', 'en'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      test(`renders all six sections (${locale}/${theme}), correct direction, no overflow, read-only`, async ({ page }, info) => {
        const requests = await open(page, { locale, theme });
        await expect(page.getByRole('heading', { name: locale === 'ar' ? 'إعدادات المتجر' : 'Store settings' }).locator('visible=true').first()).toBeVisible();
        await expect(page.locator('a[href^="/commerce/appearance"]').locator('visible=true').first()).toBeVisible();
        for (const href of ['/commerce/domains', '/commerce/delivery', '/commerce/customer-accounts', '/commerce/gifting', '/commerce/integrations']) {
          await expect(page.locator(`main a[href^="${href}"]`).first()).toBeVisible();
        }
        expect(await page.evaluate(() => document.documentElement.dir)).toBe(locale === 'ar' ? 'rtl' : 'ltr');
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        await shot(page, `hub-${locale}-${theme}-${info.project.name}`);
        expect(writes(requests)).toEqual([]);
      });
    }
  }

  test('a limited viewer only reaches the ungated sections; no card leads to a forbidden screen', async ({ page }) => {
    await open(page, { permissions: ['orders.view'] });
    await expect(page.locator('main a[href^="/commerce/appearance"]').first()).toBeVisible();
    await expect(page.locator('main a[href^="/commerce/integrations"]').first()).toBeVisible();
    for (const href of ['/commerce/domains', '/commerce/delivery', '/commerce/customer-accounts', '/commerce/gifting']) {
      await expect(page.locator(`main a[href^="${href}"]`)).toHaveCount(0);
    }
  });

  test('the customer-accounts card disappears when the storefront capability is off', async ({ page }) => {
    await open(page, { navState: { 'commerce.storefront': false } });
    await expect(page.locator('main a[href^="/commerce/gifting"]').first()).toBeVisible();
    await expect(page.locator('main a[href^="/commerce/customer-accounts"]')).toHaveCount(0);
  });

  test('the hub is reachable from the workspace navigation', async ({ page }) => {
    await open(page);
    await expect(page.locator('a[href^="/commerce/settings"]').locator('visible=true').first()).toBeVisible();
  });
});
