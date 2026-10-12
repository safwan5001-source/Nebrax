import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * FLOWERS-H15 / ADR-26 — Theme Gallery: «أَوْج بلوم» قابل للمعاينة والتطبيق (CUST-HV V10b: معاينة ← ملخّص التطبيق ← مسودة جديدة)،
 * ويُنشئ مسودة جديدة بالهوية وأقسام الهدايا التي تسندها بيانات المتجر فقط. الخادم مُعترَض بحمولات تطابق العقود الفعلية.
 */
const evidenceDir = path.resolve(process.cwd(), 'test-results/flowers-h15-bloom-theme');

const store = {
  id: 's1', name: 'ورد الندى', sales_channel_id: 'ch1', is_active: true, preview_url: 'https://nada.example.test/',
  default_locale: 'ar', business_vertical: 'flowers_gifts',
  vertical_profile: { key: 'flowers_gifts', recommended_capabilities: [] },
};

const version = (config: unknown, revision: number) => ({
  data: {
    id: 'v1', storefront_id: 's1', name: 'Bloom', state: 'draft', schema_version: 3, revision,
    schedule_token: 'tok', published_revision: null, config,
  },
});

const published = {
  data: {
    id: 'v0', storefront_id: 's1', name: 'Live', state: 'published', schema_version: 3, revision: 1,
    schedule_token: 'tok', published_revision: 1,
    config: {
      version: 3, themePreset: 'awj-modern', primaryColor: '#12372a',
      homepage: { sections: [{ id: 'hero-1', type: 'hero', visible: true }, { id: 'cat-1', type: 'categories', visible: true }] },
    },
  },
};

async function seed(page: Page, captured: { put: unknown }) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', JSON.stringify({
      id: 'u1', name: 'المالك', email: 'o@test', role: 'owner', permissions: ['*'], tenant_id: 't1',
    }));
  });
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (url.includes('/presentation/versions/v1') && method === 'PUT') {
      captured.put = route.request().postDataJSON();
      const body = captured.put as { config: unknown };
      return route.fulfill({ json: version(body.config, 2) });
    }
    if (url.includes('/presentation/versions/v0') && method === 'GET') {
      return route.fulfill({ json: published });
    }
    if (url.includes('/presentation/versions') && method === 'GET') {
      return route.fulfill({ json: { data: [published.data] } });
    }
    if (url.includes('/presentation/versions') && method === 'POST') {
      return route.fulfill({
        status: 201,
        json: version({
          version: 3, themePreset: 'awj-modern', primaryColor: '#12372a',
          homepage: { sections: [{ id: 'hero-1', type: 'hero', visible: true }, { id: 'cat-1', type: 'categories', visible: true }] },
        }, 1),
      });
    }
    if (url.includes('/vertical-setup')) {
      return route.fulfill({
        json: { data: { setup: { vertical: 'flowers_gifts', items: [
          { key: 'delivery_scheduling', available: true, state: 'configured', count: 3, manage_in: 'delivery_schedule' },
        ] } } },
      });
    }
    if (url.includes('/commerce/workspace/facets')) {
      return route.fulfill({
        json: { data: { facets: [
          { id: 'f1', key: 'occasion', system_key: 'occasion', name: 'المناسبة', name_en: 'Occasion', sort_order: 0, is_active: true, values: [] },
        ] } },
      });
    }
    if (url.includes('/commerce/workspace/storefronts')) {
      return route.fulfill({ json: { data: { stores: [store] } } });
    }
    return route.fulfill({ status: 404, json: { message: 'not mocked' } });
  });
}

async function assertNoOverflow(page: Page) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(o.sw).toBeLessThanOrEqual(o.cw + 1);
}

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

test.describe('FLOWERS-H15 — AWJ Bloom in the Theme Gallery', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own viewport');
  });

  for (const [locale, w, h, name] of [['ar', 390, 844, 'ar-390'], ['ar', 1440, 960, 'ar-1440'], ['en', 1440, 960, 'en-1440']] as const) {
    test(`${name} — Bloom is listed as available and applicable`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page, { put: null });
      await page.context().addCookies([{ name: 'locale', value: locale, url: 'http://127.0.0.1:3001' }]);
      await page.goto('/commerce/themes');
      const bloom = locale === 'ar' ? 'أَوْج بلوم' : 'AWJ Bloom';
      await expect(page.getByRole('heading', { name: bloom })).toBeVisible();
      await expect(page.getByRole('link', { name: locale === 'ar' ? 'معاينة وتطبيق' : 'Preview & apply' })).toHaveCount(6);
      await assertNoOverflow(page);
      await page.getByRole('heading', { name: bloom }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(evidenceDir, `${name}-gallery.png`) });
    });
  }

  for (const [locale, w, h, name] of [['ar', 390, 844, 'ar-390'], ['ar', 768, 1024, 'ar-768'], ['en', 1024, 768, 'en-1024'], ['ar', 1440, 960, 'ar-1440'], ['en', 1440, 960, 'en-1440']] as const) {
    test(`${name} — the theme preview bar fits, lists every area and keeps Apply / Exit reachable`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page, { put: null });
      await page.context().addCookies([{ name: 'locale', value: locale, url: 'http://127.0.0.1:3001' }]);
      await page.goto('/commerce/appearance?version=v0&previewTheme=awj-atelier');
      const bar = page.locator('[data-theme-preview-bar]');
      await expect(bar).toBeVisible({ timeout: 60_000 });
      await expect(bar.locator('[data-theme-area]')).toHaveCount(10);
      await expect(page.locator('[data-theme-apply]')).toBeVisible();
      await expect(page.locator('[data-theme-exit]')).toBeVisible();
      const box = await bar.boundingBox();
      expect(box && box.x >= -1 && box.x + box.width <= w + 1).toBe(true);
      await assertNoOverflow(page);
      await page.screenshot({ path: path.join(evidenceDir, `${name}-preview.png`) });
    });
  }

  test('applying Bloom saves a draft with the preset and only the backed gift sections', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    const captured: { put: unknown } = { put: null };
    await seed(page, captured);
    await page.context().addCookies([{ name: 'locale', value: 'ar', url: 'http://127.0.0.1:3001' }]);
    await page.goto('/commerce/themes');
    // Preview → Apply summary → new Draft Version (V0 §16): the gallery links to the builder's Theme Preview.
    const bloomLink = page.locator('[data-theme-preview-link="awj-bloom"]');
    await expect(bloomLink).toHaveAttribute('href', '/commerce/appearance?version=v0&previewTheme=awj-bloom');
    await bloomLink.click();
    const bar = page.locator('[data-theme-preview-bar]');
    await expect(bar).toBeVisible({ timeout: 60_000 }); // first visit compiles the builder route in dev
    await expect(bar.locator('[data-theme-area="identity"]')).toHaveAttribute('data-changed', '');
    expect(captured.put).toBeNull(); // the preview wrote nothing
    await page.locator('[data-theme-apply]').click();
    await expect.poll(() => captured.put).not.toBeNull();
    const config = (captured.put as { config: { themePreset: string; primaryColor: string; homepage: { sections: { type: string; content?: { dimension?: string } }[] } } }).config;
    expect(config.themePreset).toBe('awj-bloom');
    expect(config.primaryColor).toBe('#9d2449');
    expect(config.homepage.sections.map((s) => s.type)).toEqual(['hero', 'discovery', 'deliveryPromise', 'categories']);
    expect(config.homepage.sections[1].content?.dimension).toBe('occasion');
  });
});
