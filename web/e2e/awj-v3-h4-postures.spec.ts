import { expect, test, type Page } from '@playwright/test';

// AWJ v3 (Horizon 4) — platform postures against Demo Mode (no backend).
// Pins: gate-off safety, Floor (cart anchor, Outcome surface, short-height, 44px touch,
// Ink decision), Commerce (Ledger shell adoption), Studio (graphite chrome, mode-fixed,
// merchant-token isolation, canvas selection language).

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const INK = 'rgb(14, 26, 49)'; // #0E1A31 — Outcome Surface / Ink shell
const GRAPHITE = 'rgb(27, 30, 36)'; // #1B1E24 — editor chrome

async function enterDemo(page: Page, extra: Record<string, string> = {}) {
  await page.context().addCookies([{ name: 'locale', value: 'ar', url: baseUrl }]);
  await page.addInitScript((extra) => {
    localStorage.setItem('demo', 'true');
    localStorage.setItem('user', JSON.stringify({
      id: 'demo-user', name: 'مستخدم المعاينة', email: 'demo@nibras.test',
      role: 'owner', permissions: ['*'], tenant_id: 'demo-tenant',
    }));
    for (const [key, value] of Object.entries(extra)) localStorage.setItem(key, value);
  }, extra);
}

async function go(page: Page, route: string, gate: boolean) {
  await page.goto(`${baseUrl}${route}?awj-ui=${gate ? '3' : 'legacy'}`, { waitUntil: 'load' });
}

const bg = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor);

async function fillCart(page: Page) {
  const tiles = page.locator('[data-awj-floor-tile]');
  await expect(tiles.first()).toBeVisible();
  await tiles.nth(0).click();
  await tiles.nth(2).click();
  await tiles.nth(2).click();
  await expect(page.locator('[data-awj-floor-line]')).toHaveCount(2);
}

test.describe('postures are declared per workspace root', () => {
  test('Ledger, Floor and Studio roots carry data-posture', async ({ page }) => {
    test.setTimeout(120_000); // visits three routes; the first dev-server compile of each is slow
    await enterDemo(page);
    await go(page, '/dashboard', true);
    await expect(page.locator('[data-posture="ledger"]')).toHaveCount(1);
    await go(page, '/pos', true);
    await expect(page.locator('[data-posture="floor"]')).toHaveCount(1);
    await go(page, '/commerce/appearance', true);
    await expect(page.locator('[data-posture="studio"]')).toHaveCount(1);
    await go(page, '/commerce/stores', true);
    await expect(page.locator('[data-posture="ledger"]')).toHaveCount(1);
  });
});

test.describe('gate OFF keeps today’s workspaces', () => {
  test('POS cart totals are NOT an ink surface and the wrapper generates no box', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await enterDemo(page);
    await go(page, '/pos', false);
    await fillCart(page).catch(async () => {
      await page.locator('button[aria-selected]').first().click();
    });
    const outcome = page.locator('[data-awj-floor-outcome]').first();
    expect(await outcome.evaluate((el) => getComputedStyle(el).display)).toBe('contents');
    expect(await bg(page, '[data-testid="pos-cart-totals"]')).not.toBe(INK);
    await expect(page.locator('html')).not.toHaveAttribute('data-awj-ui', '3');
  });

  test('Studio chrome stays the light ERP chrome', async ({ page }) => {
    await enterDemo(page);
    await go(page, '/commerce/appearance', false);
    const header = await bg(page, '[data-experience-builder] > header');
    expect(header).not.toBe(GRAPHITE);
  });
});

test.describe('Floor (POS)', () => {
  test('1280×720: cart, total, pay and search stay on screen with a populated cart', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await enterDemo(page);
    await go(page, '/pos', true);
    await fillCart(page);
    const scrolls = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 1);
    expect(scrolls).toBe(false);
    for (const selector of ['[data-awj-floor-total]', '[data-testid="pos-cart-pay"]', 'input[type="search"], input[placeholder]']) {
      const box = await page.locator(selector).first().boundingBox();
      expect(box, selector).not.toBeNull();
      expect(box!.y + box!.height).toBeLessThanOrEqual(721);
    }
  });

  test('totals + pay are ONE Outcome Surface with display money, Ledger Rule and outcome action', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemo(page);
    await go(page, '/pos', true);
    await fillCart(page);
    expect(await bg(page, '[data-awj-floor-outcome]')).toBe(INK);
    const total = page.locator('[data-awj-floor-total] > .num');
    const style = await total.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { size: parseFloat(cs.fontSize), rule: cs.borderBottomStyle, width: parseFloat(cs.borderBottomWidth) };
    });
    expect(style.size).toBeGreaterThanOrEqual(28);
    expect(style.rule).toBe('double');
    expect(style.width).toBeGreaterThanOrEqual(3);
    const pay = page.getByTestId('pos-cart-pay');
    expect(await pay.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(127, 168, 255)');
    const payBox = await pay.boundingBox();
    expect(payBox!.height).toBeGreaterThanOrEqual(48);
  });

  test('the cart is wider than the old 1:2 split (the owner prefers a wide cart)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemo(page);
    await go(page, '/pos', true);
    const cart = await page.locator('[data-awj-floor-cart]').boundingBox();
    const catalogue = await page.locator('[data-awj-floor-grid]').boundingBox();
    expect(cart!.width / catalogue!.width).toBeGreaterThan(0.33);
  });

  test('selected cart line: tonal fill + aria-selected, never color alone', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemo(page);
    await go(page, '/pos', true);
    await fillCart(page);
    const selected = page.locator('[data-awj-floor-line][aria-selected="true"]');
    await expect(selected).toHaveCount(1);
    const style = await selected.evaluate((el) => ({ shadow: getComputedStyle(el).boxShadow, bg: getComputedStyle(el).backgroundColor }));
    expect(style.shadow).not.toBe('none');
    expect(style.bg).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('touch targets: tile actions, cart actions and pay are ≥ 44px', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await enterDemo(page);
    await go(page, '/pos', true);
    await fillCart(page);
    const small = await page.evaluate(() => {
      const selectors = ['[data-awj-floor-tile-wrap] > button:not([data-awj-floor-tile])', '[data-awj-floor-actions] button', '[data-testid="pos-cart-pay"]'];
      return selectors.flatMap((selector) =>
        Array.from(document.querySelectorAll<HTMLElement>(selector)).map((el) => {
          const r = el.getBoundingClientRect();
          return { selector, w: Math.round(r.width), h: Math.round(r.height) };
        }),
      ).filter((box) => box.w < 44 || box.h < 44);
    });
    expect(small).toEqual([]);
  });

  test('payment surface: amount due and change owed are the two sanctioned Outcome Surfaces', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await enterDemo(page);
    await go(page, '/pos', true);
    await fillCart(page);
    await page.getByTestId('pos-cart-pay').click();
    const screen = page.getByTestId('pos-payment-screen');
    await expect(screen).toBeVisible();
    const summary = screen.getByTestId('pos-payment-summary');
    await expect(summary).toBeVisible();
    await expect(summary.getByTestId('pos-payment-subtotal')).toBeVisible();
    await expect(summary.getByTestId('pos-payment-tax')).toBeVisible();
    await expect(summary.getByTestId('pos-payment-total')).toBeVisible();
    await expect(screen.locator('[data-awj-surface="outcome"]')).toHaveCount(2);
    expect(await bg(page, '[data-awj-floor-change]')).toBe(INK);
    expect(await bg(page, 'aside [data-awj-floor-outcome]')).toBe(INK);
    // confirming remains a deliberate, full-size action
    const confirm = await page.getByTestId('pos-confirm-payment').boundingBox();
    expect(confirm!.height).toBeGreaterThanOrEqual(48);
  });

  test('Ink decision: Floor keeps the paper topbar — Ink must not change it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await enterDemo(page, { 'awj:theme': 'ink' });
    await go(page, '/pos', true);
    const header = '[data-testid="pos-sale-shell"] > header';
    const inkTopbar = await bg(page, header);
    expect(inkTopbar).not.toBe(INK);
    // the cart/payment Outcome stays ink in every theme (it is mode- and theme-fixed)
    await fillCart(page);
    expect(await bg(page, '[data-awj-floor-outcome]')).toBe(INK);
  });

  test('Dark: Floor surfaces follow the shared dark tokens and the Outcome stays distinguishable', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await enterDemo(page, { theme: 'dark' });
    await go(page, '/pos', true);
    await fillCart(page);
    expect(await bg(page, '[data-awj-floor-cart]')).toBe('rgb(28, 31, 40)'); // dark paper
    const edge = await page.locator('[data-awj-floor-outcome]').evaluate((el) => getComputedStyle(el).boxShadow);
    expect(edge).not.toBe('none'); // the 1px ink-600 seam against the dark desk
  });
});

test.describe('Commerce Admin (Ledger variant) adopts the shared shell', () => {
  test('sidebar/topbar follow the Default shell and switch to Ink with the theme', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await enterDemo(page);
    await go(page, '/commerce/stores', true);
    const tint = await bg(page, '[data-awj-shell="sidebar"]');
    expect(tint).toBe('rgb(213, 223, 240)'); // #D5DFF0 — Default shell
    await page.evaluate(() => document.documentElement.setAttribute('data-awj-theme', 'ink'));
    expect(await bg(page, '[data-awj-shell="sidebar"]')).toBe(INK);
  });

  test('the active item carries the shared Apex (no legacy bar) and aria-current', async ({ page }) => {
    await enterDemo(page);
    await go(page, '/commerce/stores', true);
    const active = page.locator('[data-awj-shell="sidebar"] a[aria-current="page"]').first();
    await expect(active).toHaveAttribute('data-awj-apex-on', '');
    expect(await active.evaluate((el) => getComputedStyle(el, '::before').opacity)).toBe('1');
    expect(await page.locator('[data-awj-legacy-marker]').first().evaluate((el) => getComputedStyle(el).display)).toBe('none');
  });
});

test.describe('Studio (Builder)', () => {
  test('chrome is graphite and mode-fixed: identical across theme and mode', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemo(page, { 'awj:theme': 'ink', theme: 'dark' });
    await go(page, '/commerce/appearance', true);
    expect(await bg(page, '[data-experience-builder] > header')).toBe(GRAPHITE);
    expect(await bg(page, '[data-experience-builder] > div > nav')).toBe(GRAPHITE);
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
      document.documentElement.removeAttribute('data-awj-theme');
    });
    expect(await bg(page, '[data-experience-builder] > header')).toBe(GRAPHITE);
  });

  test('merchant tokens cannot recolor the chrome (hostile --store-primary)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemo(page);
    await go(page, '/commerce/appearance', true);
    const read = () => page.evaluate(() => {
      const header = document.querySelector('[data-experience-builder] > header') as HTMLElement;
      const rail = document.querySelector('[data-experience-builder] > div > nav [aria-current="page"]') as HTMLElement;
      return [getComputedStyle(header).backgroundColor, getComputedStyle(rail).backgroundColor, getComputedStyle(rail, '::before').backgroundColor];
    });
    const before = await read();
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--store-primary', '#ff00ff');
      document.documentElement.style.setProperty('--store-background', '#ff00ff');
    });
    expect(await read()).toEqual(before);
  });

  test('editor tokens do not leak into the merchant Canvas subtree', async ({ page }) => {
    await enterDemo(page);
    await go(page, '/commerce/appearance', true);
    await page.locator('.awj-store-preview').first().waitFor();
    const leaked = await page.evaluate(() => {
      const canvas = document.querySelector('.awj-store-preview') as HTMLElement | null;
      if (!canvas) return 'no-canvas';
      return getComputedStyle(canvas).getPropertyValue('--awj-editor-chrome').trim();
    });
    expect(leaked).toBe('');
  });

  test('selecting on the Canvas syncs the rail (Apex) and draws the CHROME selection color', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemo(page);
    await go(page, '/commerce/appearance', true);
    await page.locator('[data-preview-frame] .awj-preview-section').nth(1).click({ position: { x: 20, y: 20 } });
    const outline = page.locator('[data-preview-frame] .awj-preview-section-selected').first();
    await expect(outline).toBeVisible();
    expect(await outline.evaluate((el) => getComputedStyle(el).outlineColor)).toBe('rgb(79, 140, 255)');
    const current = page.locator('[data-experience-builder] > div > nav [aria-current="page"]');
    await expect(current).toHaveCount(1);
    expect(await current.evaluate((el) => getComputedStyle(el, '::before').width)).toBe('3px');
  });

  test('1280×720: the Canvas frame keeps the larger share than the inspector', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await enterDemo(page);
    await go(page, '/commerce/appearance', true);
    const canvas = await page.locator('[data-builder-preview]').boundingBox();
    const inspector = await page.locator('[data-builder-controls]').boundingBox();
    expect(canvas!.width).toBeGreaterThan(inspector!.width * 1.8);
    const frame = await page.locator('[data-preview-frame]').boundingBox();
    expect(frame!.width).toBeGreaterThan(600);
  });

  test('device preview switching keeps the selection and the chrome', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemo(page);
    await go(page, '/commerce/appearance', true);
    await page.locator('[data-device-option="mobile"]').click();
    await expect(page.locator('[data-experience-builder]')).toHaveAttribute('data-device', 'mobile');
    const frame = await page.locator('[data-preview-frame]').boundingBox();
    expect(frame!.width).toBeLessThan(420);
    expect(await bg(page, '[data-experience-builder] > header')).toBe(GRAPHITE);
  });

  for (const mode of ['light', 'dark'] as const) {
    test(`mobile bottom action bar follows the editor chrome (${mode})`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await enterDemo(page, { theme: mode });
      await go(page, '/commerce/appearance', true);
      const bar = page.locator('[data-experience-builder] > [data-builder-mobile-bar]');
      await expect(bar).toBeVisible();
      expect(await bg(page, '[data-experience-builder] > [data-builder-mobile-bar]')).toBe(GRAPHITE);
      // Same chrome as the header; the primary action keeps its semantics (editor action fill).
      expect(await bg(page, '[data-experience-builder] > header')).toBe(GRAPHITE);
      expect(await bar.locator('button.bg-primary').first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(79, 140, 255)');
    });
  }

  test('gate OFF: the mobile bottom action bar keeps the legacy surface', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enterDemo(page);
    await go(page, '/commerce/appearance', false);
    await expect(page.locator('[data-builder-mobile-bar]')).toBeVisible();
    expect(await bg(page, '[data-builder-mobile-bar]')).not.toBe(GRAPHITE);
  });

  test('Inspector follows Light/Dark through the shared tokens (Paper), chrome does not', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await enterDemo(page, { theme: 'dark' });
    await go(page, '/commerce/appearance', true);
    expect(await bg(page, '[data-builder-controls]')).toBe('rgb(28, 31, 40)'); // dark paper
    expect(await bg(page, '[data-experience-builder] > header')).toBe(GRAPHITE);
  });
});
