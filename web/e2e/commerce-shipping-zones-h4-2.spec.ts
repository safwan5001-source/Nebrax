import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * COPS-H4-2 — محرر مناطق الشحن في متصفح حقيقي (1440 + جوال 390، ar/en، فاتح/داكن). الخادم مُعترَض بالكامل.
 * يتحقق من: الاتجاه، عدم تجاوز العرض الأفقي، الرسم بالريال في العرض وبالهللات في الحفظ، التعطيل بتأكيد، وغياب أي حذف.
 * اللقطات تُكتب فقط حين يُضبط `H42_SHOTS` (مجلد خارج المستودع).
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.H42_SHOTS;

type Z = { id: string; name: string; match_type: 'city' | 'region'; match_value: string; rate_amount_minor: number; is_active: boolean };
const seed = (): Z[] => [
  { id: 'z1', name: 'الدمام', match_type: 'city', match_value: 'الدمام', rate_amount_minor: 1500, is_active: true },
  { id: 'z2', name: 'المنطقة الشرقية', match_type: 'region', match_value: 'الشرقية', rate_amount_minor: 2500, is_active: true },
  { id: 'z3', name: 'الجبيل', match_type: 'city', match_value: 'الجبيل', rate_amount_minor: 0, is_active: false },
];

async function open(page: Page, opts: { locale?: 'ar' | 'en'; theme?: 'light' | 'dark'; permissions?: string[]; zones?: Z[]; onWrite?: (method: string, path: string, body: unknown, route: Route) => Promise<boolean> | boolean } = {}) {
  const locale = opts.locale ?? 'ar';
  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  const zones = opts.zones ?? seed();
  const requests: string[] = [];
  const bodies: { method: string; path: string; body: unknown }[] = [];
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const user = { id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: 'owner', permissions: opts.permissions ?? ['*'] };
  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    const p = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    requests.push(`${method} ${p}`);
    if (p === '/applications/nav-state') return json(route, { data: {} });
    if (p === '/commerce/workspace/storefronts') return json(route, { data: { stores: [] } });
    if (p === '/me') return json(route, { user, company: { name: 'Acme' } });
    if (p === '/commerce/workspace/shipping-zones' && method === 'GET') return json(route, { data: zones });
    if (p.startsWith('/commerce/workspace/shipping-zones') && method !== 'GET') {
      const body = route.request().postDataJSON();
      bodies.push({ method, path: p, body });
      if (opts.onWrite && (await opts.onWrite(method, p, body, route))) return;
      const id = p.split('/')[3] ?? 'new';
      return json(route, { data: { id, created_at: null, ...body } }, method === 'POST' ? 201 : 200);
    }
    return json(route, { data: [] });
  });
  await page.addInitScript(([userJson, theme]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    localStorage.setItem('theme', theme);
  }, [JSON.stringify(user), opts.theme ?? 'light'] as const);
  await page.goto(`${baseUrl}/commerce/shipping-zones`, { waitUntil: 'domcontentloaded' });
  return { requests, bodies };
}

const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};
const noOverflow = async (page: Page) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
};
const visible = (page: Page, text: string | RegExp) => page.getByText(text).locator('visible=true').first();

test.describe('H4-2 shipping zones editor', () => {
  for (const locale of ['ar', 'en'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      test(`lists zones with SAR fees (${locale}/${theme}), direction, no overflow, no writes`, async ({ page }, info) => {
        const { requests } = await open(page, { locale, theme });
        await expect(visible(page, 'المنطقة الشرقية')).toBeVisible();
        await expect(visible(page, locale === 'ar' ? 'مجاني' : 'Free')).toBeVisible();
        await expect(visible(page, /15\.00/)).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.dir)).toBe(locale === 'ar' ? 'rtl' : 'ltr');
        await noOverflow(page);
        await shot(page, `list-${locale}-${theme}-${info.project.name}`);
        expect(requests.filter((r) => /^(POST|PUT|PATCH|DELETE) /.test(r))).toEqual([]);
      });
    }
  }

  test('create dialog: SAR in, integer halalas out; the dialog fits the viewport', async ({ page }, info) => {
    const { bodies } = await open(page, { locale: 'en' });
    await expect(visible(page, 'المنطقة الشرقية')).toBeVisible();
    await page.getByRole('button', { name: /Add zone/ }).locator('visible=true').first().click();
    await page.getByLabel('Zone name').fill('Khobar');
    await page.getByLabel('Value to match').fill('Khobar');
    await page.getByLabel('Shipping fee (SAR)').fill('17.5');
    await noOverflow(page);
    await shot(page, `dialog-en-${info.project.name}`);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({ method: 'POST', body: { name: 'Khobar', match_type: 'city', match_value: 'Khobar', rate_amount_minor: 1750, is_active: true } });
  });

  test('invalid fee is blocked in the browser (no request)', async ({ page }) => {
    const { bodies } = await open(page, { locale: 'en' });
    await expect(visible(page, 'المنطقة الشرقية')).toBeVisible();
    await page.getByRole('button', { name: /Add zone/ }).locator('visible=true').first().click();
    await page.getByLabel('Zone name').fill('X');
    await page.getByLabel('Value to match').fill('X');
    await page.getByLabel('Shipping fee (SAR)').fill('1.234');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/Enter a valid fee in SAR/)).toBeVisible();
    expect(bodies).toEqual([]);
  });

  test('disabling needs confirmation that says windows are hidden, not deleted; only then is_active=false is sent', async ({ page }, info) => {
    const { bodies } = await open(page, { locale: 'en' });
    await expect(visible(page, 'المنطقة الشرقية')).toBeVisible();
    await page.getByRole('button', { name: 'Disable' }).locator('visible=true').first().click();
    await expect(page.getByText(/hidden temporarily, not deleted/)).toBeVisible();
    await shot(page, `confirm-en-${info.project.name}`);
    expect(bodies).toEqual([]);
    await page.getByRole('button', { name: 'Disable zone' }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({ method: 'PUT', body: { is_active: false, rate_amount_minor: 1500 } });
  });

  test('a duplicate rejection is explained and no delete control exists anywhere', async ({ page }) => {
    const { requests } = await open(page, {
      locale: 'en',
      onWrite: async (_m, _p, _b, route) => {
        await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ message: 'dup' }) });
        return true;
      },
    });
    await expect(visible(page, 'المنطقة الشرقية')).toBeVisible();
    await expect(page.getByRole('button', { name: /delete|remove|حذف/i })).toHaveCount(0);
    await page.getByRole('button', { name: /Add zone/ }).locator('visible=true').first().click();
    await page.getByLabel('Zone name').fill('Dup');
    await page.getByLabel('Value to match').fill('Dammam');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Another zone already uses the same match type and value.')).toBeVisible();
    expect(requests.some((r) => r.startsWith('DELETE '))).toBe(false);
  });

  test('without commerce.manage the screen is forbidden and requests nothing', async ({ page }) => {
    const { requests } = await open(page, { locale: 'en', permissions: ['orders.view'] });
    await expect(visible(page, 'You do not have access to this screen')).toBeVisible();
    expect(requests.some((r) => r.includes('shipping-zones'))).toBe(false);
  });
});
