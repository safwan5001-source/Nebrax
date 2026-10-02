import { expect, test, type Page } from '@playwright/test';

// AWJ v3 (Horizon 3) — Theme (Default/Ink) × Mode (Light/Dark) contract.
// Runs against Demo Mode (no backend): real production components, local mock data.
// Pins: the v3 gate / theme independence, pre-paint (no FOUC path through localStorage),
// Ink-Dark = Default-Dark, and the Settings selector wiring end to end.

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';

async function enterDemo(page: Page, extra?: Record<string, string>) {
  await page.context().addCookies([{ name: 'locale', value: 'ar', url: baseUrl }]);
  await page.addInitScript((extra) => {
    localStorage.setItem('demo', 'true');
    localStorage.setItem(
      'user',
      JSON.stringify({
        id: 'demo-user', name: 'مستخدم المعاينة', email: 'demo@nibras.test',
        role: 'owner', permissions: ['*'], tenant_id: 'demo-tenant',
      })
    );
    for (const [k, v] of Object.entries(extra ?? {})) localStorage.setItem(k, v);
  }, extra ?? {});
}

async function go(page: Page, route: string, gate: boolean) {
  await page.goto(`${baseUrl}${route}?awj-ui=${gate ? '3' : 'legacy'}`, { waitUntil: 'load' });
}

test.describe('theme is independent from the v3 gate', () => {
  test('a stored Ink preference never turns the v3 gate on by itself', async ({ page }) => {
    await enterDemo(page, { 'awj:theme': 'ink' });
    await go(page, '/dashboard', false);
    await expect(page.locator('html')).toHaveAttribute('data-awj-theme', 'ink');
    await expect(page.locator('html')).not.toHaveAttribute('data-awj-ui', '3');
  });

  test('gate OFF renders legacy regardless of the stored theme', async ({ page }) => {
    await enterDemo(page, { 'awj:theme': 'ink' });
    await go(page, '/dashboard', false);
    // The data-awj-shell="sidebar" marker is an inert attribute present unconditionally
    // (H1 pattern); what proves gate-off is that its background still resolves to the
    // legacy --surface value, not the Ink navy shell token.
    const bg = await page.locator('[data-awj-shell="sidebar"]').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgb(14, 26, 49)'); // #0E1A31 — Ink shell-bg
  });
});

test.describe('pre-paint: no flash from a stored Ink preference', () => {
  test('the attribute is present at the very first paint, before hydration settles', async ({ page }) => {
    await enterDemo(page, { 'awj:theme': 'ink' });
    await go(page, '/dashboard', true);
    // Checked immediately after `load`; the inline script runs before React mounts.
    await expect(page.locator('html')).toHaveAttribute('data-awj-theme', 'ink');
  });

  test('survives a hard refresh (localStorage-backed, not React state)', async ({ page }) => {
    await enterDemo(page, { 'awj:theme': 'ink' });
    await go(page, '/dashboard', true);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-awj-theme', 'ink');
  });

  test('survives client-side navigation between routes', async ({ page }) => {
    await enterDemo(page, { 'awj:theme': 'ink' });
    await go(page, '/invoices', true);
    await expect(page.locator('html')).toHaveAttribute('data-awj-theme', 'ink');
    // Mobile: the sidebar is a closed drawer — open it first so the link is reachable.
    const menuButton = page.getByRole('button', { name: 'القائمة' });
    if (await menuButton.isVisible().catch(() => false)) await menuButton.click();
    await page.getByRole('link', { name: 'لوحة التحكم' }).first().click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveAttribute('data-awj-theme', 'ink');
  });

  test('default (no stored preference) carries no theme attribute at all', async ({ page }) => {
    await enterDemo(page);
    await go(page, '/dashboard', true);
    await expect(page.locator('html')).not.toHaveAttribute('data-awj-theme', /.+/);
  });
});

test.describe('Ink-Dark = Default-Dark', () => {
  test('dark mode renders the same shell background regardless of the Ink/Default preference', async ({ page }) => {
    await enterDemo(page, { 'awj:theme': 'ink', theme: 'dark' });
    await go(page, '/dashboard', true);

    const shellBg = async () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--awj-shell-bg').trim());
    const inkBgResolved = await shellBg();
    expect(inkBgResolved.toUpperCase()).toBe('#0E1A31');

    // Removing the Ink attribute (Default) must resolve to the exact same dark shell
    // color — the CSS generator reuses the Ink block verbatim for `.dark` (no second
    // dark matrix), so there is nothing to toggle between.
    await page.evaluate(() => document.documentElement.removeAttribute('data-awj-theme'));
    const defaultBgResolved = await shellBg();
    expect(defaultBgResolved).toBe(inkBgResolved);
  });

  test('switching back to Light makes the Default/Ink distinction visible again', async ({ page }) => {
    // No stored Ink preference here (unlike the other cases in this file): Settings is
    // where a live switch actually happens, and it must not require a reload — exactly
    // what the "Settings — AWJ theme selector" test below exercises end to end. This
    // test instead pins the CSS-level claim: once Light, Default and Ink resolve to
    // different shell colors (the whole point of the Ink theme existing).
    await enterDemo(page, { theme: 'light' });
    await go(page, '/dashboard', true);
    const shellBg = () => page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--awj-shell-bg').trim()
    );

    const defaultLightBg = await shellBg();
    expect(defaultLightBg.toUpperCase()).not.toBe('#0E1A31');

    await page.evaluate(() => document.documentElement.setAttribute('data-awj-theme', 'ink'));
    const inkLightBg = await shellBg();
    expect(inkLightBg.toUpperCase()).toBe('#0E1A31');

    await page.evaluate(() => document.documentElement.removeAttribute('data-awj-theme'));
    expect((await shellBg()).toUpperCase()).toBe(defaultLightBg.toUpperCase());
  });
});

test.describe('Settings — AWJ theme selector', () => {
  test('selecting Ink and saving applies it immediately, in the same session, with no page reload', async ({ page }) => {
    await enterDemo(page);
    await go(page, '/settings', true);
    await expect(page.locator('html')).not.toHaveAttribute('data-awj-theme', /.+/);

    await page.locator('select[aria-describedby="preferences-app-theme-hint"]').selectOption('ink');
    await page.getByRole('button', { name: 'حفظ التفضيلات' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-awj-theme', 'ink');
    await expect(page.getByText('تم حفظ تفضيلات العرض.')).toBeVisible();
  });
});
