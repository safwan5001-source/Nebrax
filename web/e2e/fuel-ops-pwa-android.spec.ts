import { devices, expect, test } from '@playwright/test';

/**
 * تثبيت «محطات أَوْج» كـPWA على Chrome/Android — يحاكي Pixel 7 (Chromium موبايل) ويسأل Chrome نفسه عن
 * قابلية التثبيت عبر CDP `Page.getInstallabilityErrors` (الآلية التي يعتمدها تبويب Application ▸ Manifest).
 * قائمة الأخطاء الفارغة = Chrome سيعرض التثبيت. لا يغني عن جهاز Android حقيقي (WebAPK)؛ انظر التقرير.
 */
const { defaultBrowserType: _ignored, ...pixel } = devices['Pixel 7'];
test.use({ ...pixel });

const PAGES = ['/fuel-stations/ops/login', '/fuel-stations/ops'];

for (const route of PAGES) {
  test(`Android Chrome: manifest linked and installable — ${route}`, async ({ page, context }) => {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');

    const href = await page.locator('link[rel="manifest"]').first().getAttribute('href');
    expect(href).toBe('/fuel-ops-pwa/manifest.webmanifest');

    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    const manifest = await res.json();
    expect(manifest.display).toBe('standalone');

    for (const icon of manifest.icons as { src: string; type: string }[]) {
      const r = await page.request.get(icon.src);
      expect(r.status(), icon.src).toBe(200);
      expect(r.headers()['content-type']).toContain(icon.type);
    }

    const cdp = await context.newCDPSession(page);
    const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as {
      installabilityErrors: { errorId: string; errorArguments: unknown[] }[];
    };
    // `in-incognito`: سياق Playwright معزول (تثبيت Chrome يُعطَّل في التصفح الخفي) — ليس خللاً في الإعداد.
    const real = installabilityErrors.filter((e) => e.errorId !== 'in-incognito');
    expect(real, JSON.stringify(real)).toEqual([]);

    const { url, errors } = (await cdp.send('Page.getAppManifest')) as { url: string; errors: { message: string }[] };
    expect(url).toContain('/fuel-ops-pwa/manifest.webmanifest');
    expect(errors.map((e) => e.message)).toEqual([]);
  });
}

test('control: Chrome reports no-manifest where none is linked (the pre-fix production state)', async ({ page, context }) => {
  await page.goto('/login', { waitUntil: 'load' });
  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as { installabilityErrors: { errorId: string }[] };
  expect(installabilityErrors.map((e) => e.errorId)).toContain('no-manifest');
});

test('Android Chrome: ERP root is not claimed as the station app', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const hrefs = await page.locator('link[rel="manifest"]').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  expect(hrefs).not.toContain('/fuel-ops-pwa/manifest.webmanifest');
});
