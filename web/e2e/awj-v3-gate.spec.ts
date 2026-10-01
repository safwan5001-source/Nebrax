import { expect, test, type Page } from '@playwright/test';

// AWJ v3 (Horizon 1) — structural regression guard for the feature gate.
//
// This is not a pixel-snapshot test. It asserts the contract the Horizon 1 safety
// boundary depends on: gate-off renders today's exact mechanism (legacy marker
// visible, no Apex pseudo-element, no html[data-awj-ui] attribute), and gate-on
// renders the v3 mechanism (gate attribute present, Apex pseudo-element painted,
// legacy marker hidden) — without requiring a human to eyeball a screenshot.

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';

// Demo mode (src/lib/demo.ts) renders every real screen with local mock data and no
// backend — exactly what this gate contract needs to verify against the real
// production Sidebar/Topbar, not a synthetic fixture. Seeded directly via
// localStorage (the same two keys enableDemo() sets) rather than through a login-page
// button, since this spec must not depend on that button existing/working.
async function enterDemo(page: Page) {
  await page.context().addCookies([{ name: 'locale', value: 'ar', url: baseUrl }]);
  await page.addInitScript(() => {
    localStorage.setItem('demo', 'true');
    localStorage.setItem(
      'user',
      JSON.stringify({
        id: 'demo-user',
        name: 'مستخدم المعاينة',
        email: 'demo@nibras.test',
        role: 'owner',
        permissions: ['*'],
        tenant_id: 'demo-tenant',
      })
    );
  });
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'load' });
  await expect(page).toHaveURL(/\/dashboard$/);
}

test('gate OFF (default): no gate attribute, legacy active-item marker, no Apex pseudo-element', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterDemo(page);

  await expect(page.locator('html')).not.toHaveAttribute('data-awj-ui', '3');

  const dashboardLink = page.locator('a[href="/dashboard"]').first();
  const legacyMarker = dashboardLink.locator('[data-awj-legacy-marker]');
  await expect(legacyMarker).toBeVisible();

  const beforeContent = await dashboardLink.evaluate(
    (el) => getComputedStyle(el, '::before').content
  );
  expect(beforeContent).toBe('none');
});

test('gate ON (?awj-ui=3): gate attribute set, Apex pseudo-element painted, legacy marker hidden', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterDemo(page);
  await page.goto(`${baseUrl}/dashboard?awj-ui=3`, { waitUntil: 'load' });

  await expect(page.locator('html')).toHaveAttribute('data-awj-ui', '3');

  const dashboardLink = page.locator('a[href="/dashboard"]').first();
  const before = await dashboardLink.evaluate((el) => {
    const cs = getComputedStyle(el, '::before');
    return { content: cs.content, width: cs.width, opacity: cs.opacity };
  });
  expect(before.content).toBe('""');
  expect(before.width).toBe('3px');
  expect(before.opacity).toBe('1');

  const legacyMarker = dashboardLink.locator('[data-awj-legacy-marker]');
  await expect(legacyMarker).toBeHidden();

  // Opting out (?awj-ui=legacy) clears the persisted preference again.
  await page.goto(`${baseUrl}/dashboard?awj-ui=legacy`, { waitUntil: 'load' });
  await expect(page.locator('html')).not.toHaveAttribute('data-awj-ui', '3');
});

test('gate ON: sidebar and topbar carry the shell marker and pick up the tinted shell background', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterDemo(page);
  await page.goto(`${baseUrl}/dashboard?awj-ui=3`, { waitUntil: 'load' });

  const sidebar = page.locator('[data-awj-shell="sidebar"]');
  await expect(sidebar).toHaveCount(1);
  const topbar = page.locator('[data-awj-shell="topbar"]');
  await expect(topbar).toHaveCount(1);

  const sidebarBg = await sidebar.evaluate((el) => getComputedStyle(el).backgroundColor);
  // Default theme shell-bg is #D5DFF0 → rgb(213, 223, 240)
  expect(sidebarBg).toBe('rgb(213, 223, 240)');
});
