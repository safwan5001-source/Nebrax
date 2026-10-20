import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const widths = [390, 430, 768, 1024, 1280, 1440] as const;
const locales = ['ar', 'en'] as const;
const socialNetworks = [
  'instagram',
  'x',
  'tiktok',
  'snapchat',
  'youtube',
  'linkedin',
  'facebook',
] as const;
const evidenceDir = path.resolve(process.cwd(), 'test-results/store-brand-qa');

function previewViewport(width: number) {
  if (width < 768) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

function expectedColumns(width: number) {
  if (width >= 1024) return 3;
  if (width >= 640) return 2;
  return 1;
}

const identityCopy = {
  ar: {
    cr: 'السجل التجاري',
    vat: 'الرقم الضريبي',
    verified: 'موثّق في منصة الأعمال',
  },
  en: {
    cr: 'Commercial registration',
    vat: 'VAT number',
    verified: 'Verified in Saudi Business Center',
  },
} as const;

async function assertIdentityIcons(footer: Locator, kinds: readonly ('cr' | 'vat')[]) {
  for (const kind of ['cr', 'vat'] as const) {
    const icon = footer.locator(`[data-identity-icon="${kind}"]`);
    await expect(icon).toHaveCount(kinds.includes(kind) ? 1 : 0);
    if (!kinds.includes(kind)) continue;
    await expect(icon).toHaveAttribute('aria-hidden', 'true');
    const box = await icon.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(14);
    expect(box?.width ?? 0).toBeLessThanOrEqual(20);
    expect(Math.abs((box?.width ?? 0) - (box?.height ?? 0))).toBeLessThanOrEqual(1);
    await expect(footer.locator(`[data-identity-detail="${kind}"] a`)).toHaveCount(0);
  }
}

async function assertNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

async function assertTouchTarget(locator: Locator, minimum = 44) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(minimum);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(minimum);
}

async function assertKeyboardFocusVisible(page: Page, target: Locator) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  for (let index = 0; index < 80; index += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => document.activeElement === el)) {
      const focus = await target.evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          outlineWidth: Number.parseFloat(style.outlineWidth || '0'),
          outlineStyle: style.outlineStyle,
        };
      });
      expect(focus.outlineStyle).not.toBe('none');
      expect(focus.outlineWidth).toBeGreaterThan(0);
      return;
    }
  }
  throw new Error('Target was not reached by keyboard navigation');
}

async function assertFooter(page: Page, width: number, locale: 'ar' | 'en') {
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
  await assertNoOverflow(page);

  const footer = page.locator('footer');
  await expect(footer).toBeVisible();

  const grids = footer.locator('.grid');
  expect(await grids.count()).toBeGreaterThanOrEqual(2);
  const trustGrid = grids.nth(1);
  const columns = await trustGrid.evaluate((el) =>
    getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length,
  );
  expect(columns).toBe(expectedColumns(width));

  for (const network of socialNetworks) {
    const mark = footer.locator(`[data-official-social="${network}"]`);
    await expect(mark).toHaveCount(1);
    const anchor = mark.locator('xpath=ancestor::a[1]');
    await expect(anchor).toHaveAttribute('aria-label', /.+/);
  }

  for (const kind of ['phone', 'email', 'address', 'hours']) {
    const icon = footer.locator(`[data-contact-icon="${kind}"]`);
    await expect(icon).toHaveCount(1);
    await expect(icon).toHaveAttribute('aria-hidden', 'true');
  }

  await assertIdentityIcons(footer, ['cr', 'vat']);
  await expect(footer).toContainText('7050247977');
  await expect(footer).toContainText('310123456700003');
  await expect(footer).not.toContainText('DECOY-CR-NOT-CANONICAL');
  await expect(page.getByTestId('sbc-official-seal')).toHaveCount(0);
  await expect(page.locator('script[src*="EAuthSealApi/seal.js"]')).toHaveCount(0);
  await expect(page.getByTestId('sbc-seal-preview')).toBeVisible();
  await expect(footer).not.toContainText('official-token');
  const footerText = (await footer.innerText()).toLowerCase();
  expect(footerText).not.toContain('mada');
  expect(footerText).not.toContain('visa');
  expect(footerText).not.toContain('mastercard');
  expect(footerText).not.toContain('apple pay');
  expect(footerText).not.toContain('google pay');

  expect(await page.locator('[data-official-social="whatsapp"]').count()).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole('img', { name: 'App Store' })).toHaveCount(2);
  await expect(page.getByRole('img', { name: 'Google Play' })).toHaveCount(2);
}

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

for (const locale of locales) {
  for (const width of widths) {
    test(`merchant preview full ${locale} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const viewport = previewViewport(width);
      await page.goto(`/dev/trust-visual?locale=${locale}&scenario=full&viewport=${viewport}`);
      await page.waitForLoadState('networkidle');
      await assertFooter(page, width, locale);
      await page.screenshot({
        path: path.join(evidenceDir, `preview-full-${locale}-${width}.png`),
        fullPage: true,
      });
    });
  }
}

test('global media background is still-only and matches desktop/mobile focal points', async ({ page }) => {
  const ids = ['00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102'];
  const previewUrls = {
    [ids[0]]: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='%234f46e5'/%3E%3C/svg%3E",
    [ids[1]]: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='%23f97316'/%3E%3C/svg%3E",
  };
  const mediaRequests: string[] = [];
  await page.route((url) => url.pathname.includes('/commerce/workspace/storefront-media/'), async (route) => {
    const requestUrl = route.request().url();
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (new URL(requestUrl).pathname.endsWith('/derivatives/status')) {
      return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ data: [{ state: 'absent', files: [] }] }) });
    }
    if (route.request().method() === 'GET') mediaRequests.push(requestUrl);
    const id = new URL(requestUrl).pathname.split('/').at(-1) ?? '';
    if (!ids.includes(id)) return route.fulfill({ status: 404, headers, body: '{}' });
    const previewUrl = previewUrls[id as keyof typeof previewUrls];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers,
      body: JSON.stringify({ data: { id, name: 'QA still', mime: 'image/svg+xml', size: 128, width: 32, height: 32, alt_ar: null, alt_en: null, variants_state: 'ready', variants_error: null, thumbnail_url: previewUrl, preview_url: previewUrl, usage_count: 1 } }),
    });
  });
  for (const view of [
    { width: 1440, name: 'desktop', id: ids[0], focal: '32% 58%' },
    { width: 390, name: 'mobile', id: ids[1], focal: '70% 30%' },
  ]) {
    await page.setViewportSize({ width: view.width, height: 1000 });
    await page.goto(`/dev/trust-visual?locale=en&scenario=global-background&viewport=${view.name}`);
    await expect.poll(() => mediaRequests.length).toBeGreaterThan(0);
    const layer = page.locator('[data-global-background-layer]');
    await expect(layer).toBeVisible();
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('footer')).toBeVisible();
    const image = layer.locator('img[data-global-background-image]');
    await expect(image).toHaveAttribute('src', previewUrls[view.id as keyof typeof previewUrls]);
    await expect(image).toHaveCSS('object-position', view.focal);
    await expect(image).toHaveAttribute('loading', 'lazy');
    await expect(layer.locator('[data-global-background-overlay]')).toHaveCSS('opacity', '0.35');
    await expect(layer.locator('video')).toHaveCount(0);
    await page.screenshot({ path: path.join(evidenceDir, `global-background-${view.name}.png`), fullPage: true });
  }
});

const stateCases = [
  ['empty', { phone: 0, email: 0, address: 0, hours: 0, instagram: 0, whatsapp: 0, apple: 0, google: 0 }],
  ['partial', { phone: 1, email: 0, address: 0, hours: 0, instagram: 1, whatsapp: 1, apple: 0, google: 0 }],
  ['missing-identity', { phone: 1, email: 1, address: 1, hours: 1, instagram: 1, whatsapp: 2, apple: 2, google: 2 }],
  ['apps-one', { phone: 1, email: 1, address: 1, hours: 1, instagram: 0, whatsapp: 0, apple: 2, google: 0 }],
  ['apps-google', { phone: 1, email: 1, address: 1, hours: 1, instagram: 0, whatsapp: 0, apple: 0, google: 2 }],
  ['whatsapp-floating', { phone: 1, email: 1, address: 1, hours: 1, instagram: 0, whatsapp: 1, apple: 2, google: 2 }],
] as const;

for (const [scenario, expected] of stateCases) {
  test(`merchant preview state ${scenario}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.goto(`/dev/trust-visual?locale=en&scenario=${scenario}&viewport=mobile`);
    await page.waitForLoadState('networkidle');
    await assertNoOverflow(page);

    for (const kind of ['phone', 'email', 'address', 'hours'] as const) {
      await expect(page.locator(`[data-contact-icon="${kind}"]`)).toHaveCount(expected[kind]);
    }
    for (const network of socialNetworks) {
      const expectedCount = network === 'instagram' ? expected.instagram : 0;
      await expect(page.locator(`[data-official-social="${network}"]`)).toHaveCount(expectedCount);
    }
    const footerWhatsapp = page.locator('footer [data-official-social="whatsapp"]');
    await expect(page.locator('[data-official-social="whatsapp"]')).toHaveCount(expected.whatsapp);

    if (scenario === 'partial') {
      await expect(footerWhatsapp).toHaveCount(1);
    }

    if (scenario === 'whatsapp-floating') {
      await expect(footerWhatsapp).toHaveCount(0);
      await expect(page.locator('[data-official-social="whatsapp"]')).toHaveCount(1);
    }
    await expect(page.getByRole('img', { name: 'App Store' })).toHaveCount(expected.apple);
    await expect(page.getByRole('img', { name: 'Google Play' })).toHaveCount(expected.google);

    if (scenario === 'missing-identity') {
      await expect(page.locator('#footer-identity')).toHaveCount(0);
      await expect(page.locator('[data-identity-icon]')).toHaveCount(0);
      await expect(page.locator('footer')).not.toContainText('7050247977');
      await expect(page.locator('footer')).not.toContainText('310123456700003');
    }
  });
}

test('merchant preview long values do not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto('/dev/trust-visual?locale=en&scenario=long&viewport=mobile');
  await page.waitForLoadState('networkidle');
  await assertNoOverflow(page);
  await assertIdentityIcons(page.locator('footer'), ['cr', 'vat']);
});

test('merchant preview unsafe values fail closed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto('/dev/trust-visual?locale=en&scenario=unsafe&viewport=mobile');
  await page.waitForLoadState('networkidle');
  const hrefs = await page.locator('footer a').evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLAnchorElement).href),
  );
  expect(hrefs.some((href) => href.startsWith('javascript:'))).toBe(false);
  expect(hrefs.some((href) => href.startsWith('http://'))).toBe(false);
  await expect(page.locator('[data-official-social="x"]')).toHaveCount(0);
  await expect(page.locator('[data-official-social="tiktok"]')).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'App Store' })).toHaveCount(0);
});

test('merchant preview icon targets remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto('/dev/trust-visual?locale=en&scenario=full&viewport=mobile');
  await page.waitForLoadState('networkidle');

  const instagram = page
    .locator('footer [data-official-social="instagram"]')
    .locator('xpath=ancestor::a[1]');
  const whatsapp = page
    .locator('[data-official-social="whatsapp"]')
    .last()
    .locator('xpath=ancestor::a[1]');

  await assertTouchTarget(instagram);
  await assertTouchTarget(whatsapp);
  await assertKeyboardFocusVisible(page, instagram);
});

const identityScenarios = ['cr-only', 'vat-only', 'sbc-plain'] as const;

for (const locale of locales) {
  for (const width of [390, 1440] as const) {
    for (const scenario of identityScenarios) {
      test(`merchant preview identity ${scenario} ${locale} ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        const viewport = previewViewport(width);
        await page.goto(
          `/dev/trust-visual?locale=${locale}&scenario=${scenario}&viewport=${viewport}`,
        );
        await page.waitForLoadState('networkidle');
        await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
        await assertNoOverflow(page);
        const footer = page.locator('footer');
        await expect(footer).not.toContainText('DECOY-CR-NOT-CANONICAL');
        await expect(page.getByTestId('sbc-official-seal')).toHaveCount(0);
        await expect(page.locator('script[src*="EAuthSealApi/seal.js"]')).toHaveCount(0);

        if (scenario === 'cr-only') {
          await assertIdentityIcons(footer, ['cr']);
          await expect(footer).toContainText(identityCopy[locale].cr);
          await expect(footer).toContainText('7050247977');
          await expect(footer).not.toContainText(identityCopy[locale].vat);
          await expect(footer).not.toContainText('310123456700003');
        }

        if (scenario === 'vat-only') {
          await assertIdentityIcons(footer, ['vat']);
          await expect(footer).toContainText(identityCopy[locale].vat);
          await expect(footer).toContainText('310123456700003');
          await expect(footer).not.toContainText(identityCopy[locale].cr);
          await expect(footer).not.toContainText('7050247977');
        }

        if (scenario === 'sbc-plain') {
          await assertIdentityIcons(footer, []);
          await expect(footer).toContainText(identityCopy[locale].verified);
          await expect(page.getByTestId('sbc-seal-preview')).toHaveCount(0);
        }
      });
    }
  }
}
