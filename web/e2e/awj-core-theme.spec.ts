import { expect, test, type Page } from '@playwright/test';
import { seedDemoSession } from './helpers/demo-session';
import { scanContrast } from './helpers/contrast-scan';

// AWJ Core — the third V3 theme (THEMES.md §6A). Demo Mode, real components.
// Owner-approved contract: Light shell (sidebar + topbar) = #1E40AF, Dark shell = #4F8CFF;
// layout, components and the workspace are Default's, untouched. Presentation only.

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const CORE_LIGHT = 'rgb(30, 64, 175)'; // #1E40AF
const CORE_DARK = 'rgb(79, 140, 255)'; // #4F8CFF

async function open(page: Page, route: string, opts: { locale?: 'ar' | 'en'; mode?: 'light' | 'dark'; theme?: 'core' | 'ink' | 'default'; gate?: boolean } = {}) {
  const { locale = 'ar', mode = 'light', theme = 'core', gate = true } = opts;
  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  await seedDemoSession(page, { theme: mode, ...(theme === 'default' ? {} : { 'awj:theme': theme }) });
  await page.goto(`${baseUrl}${route}?awj-ui=${gate ? '3' : 'legacy'}`, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForTimeout(1200);
}

const bgOf = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor);

const overflowX = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('Core — shell colors (owner-approved contract)', () => {
  for (const locale of ['ar', 'en'] as const) {
    test(`Light ${locale}: sidebar and topbar are both #1E40AF`, async ({ page }) => {
      await open(page, '/dashboard', { locale, mode: 'light' });
      await expect(page.locator('html')).toHaveAttribute('data-awj-theme', 'core');
      expect(await bgOf(page, '[data-awj-shell="sidebar"]')).toBe(CORE_LIGHT);
      expect(await bgOf(page, '[data-awj-shell="topbar"]')).toBe(CORE_LIGHT);
      expect(await overflowX(page)).toBe(0);
    });

    test(`Dark ${locale}: sidebar and topbar are both #4F8CFF (not navy, not an accent)`, async ({ page }) => {
      await open(page, '/dashboard', { locale, mode: 'dark' });
      await expect(page.locator('html')).toHaveClass(/dark/);
      expect(await bgOf(page, '[data-awj-shell="sidebar"]')).toBe(CORE_DARK);
      expect(await bgOf(page, '[data-awj-shell="topbar"]')).toBe(CORE_DARK);
      expect(await overflowX(page)).toBe(0);
    });
  }

  test('the workspace is untouched: Desk keeps its Default Light / Dark surface', async ({ page }) => {
    await open(page, '/invoices', { mode: 'light' });
    const lightDesk = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--awj-surface-desk').trim());
    await open(page, '/invoices', { mode: 'light', theme: 'default' });
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--awj-surface-desk').trim())).toBe(lightDesk);

    await open(page, '/invoices', { mode: 'dark' });
    const darkDesk = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--awj-surface-desk').trim());
    await open(page, '/invoices', { mode: 'dark', theme: 'default' });
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--awj-surface-desk').trim())).toBe(darkDesk);
  });

  test('semantic tokens outside the shell are identical to Default (Light and Dark)', async ({ page }) => {
    const snapshot = () => page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const names = ['--awj-surface-paper', '--awj-surface-outcome', '--awj-action-primary', '--awj-action-primary-fg',
        '--awj-status-positive-fg', '--awj-status-negative-fg', '--awj-status-warning-fg', '--awj-text-primary', '--awj-border-hairline'];
      return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()]));
    });
    for (const mode of ['light', 'dark'] as const) {
      await open(page, '/dashboard', { mode, theme: 'core' });
      const core = await snapshot();
      await open(page, '/dashboard', { mode, theme: 'default' });
      expect(core, `non-shell tokens differ in ${mode}`).toEqual(await snapshot());
    }
  });
});

test.describe('Core — Default and Ink are unchanged', () => {
  test('Default Light and Ink Light keep their shell colors', async ({ page }) => {
    await open(page, '/dashboard', { theme: 'default' });
    expect(await bgOf(page, '[data-awj-shell="sidebar"]')).toBe('rgb(213, 223, 240)'); // #D5DFF0
    await open(page, '/dashboard', { theme: 'ink' });
    expect(await bgOf(page, '[data-awj-shell="sidebar"]')).toBe('rgb(14, 26, 49)'); // #0E1A31
  });

  test('Ink-Dark = Default-Dark still holds; only Core-Dark differs (#0E1A31 vs #4F8CFF)', async ({ page }) => {
    const shellBg = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--awj-shell-bg').trim().toUpperCase());
    await open(page, '/dashboard', { mode: 'dark', theme: 'ink' });
    expect(await shellBg()).toBe('#0E1A31');
    await page.evaluate(() => document.documentElement.removeAttribute('data-awj-theme'));
    expect(await shellBg()).toBe('#0E1A31');
    await page.evaluate(() => document.documentElement.setAttribute('data-awj-theme', 'core'));
    expect(await shellBg()).toBe('#4F8CFF');
  });

  test('gate OFF: a stored Core preference stays inert and renders legacy', async ({ page }) => {
    await open(page, '/dashboard', { gate: false });
    await expect(page.locator('html')).toHaveAttribute('data-awj-theme', 'core');
    await expect(page.locator('html')).not.toHaveAttribute('data-awj-ui', '3');
    const bg = await bgOf(page, '[data-awj-shell="sidebar"]');
    expect(bg).not.toBe(CORE_LIGHT);
    expect(bg).not.toBe(CORE_DARK);
  });
});

test.describe('Core — pre-paint and persistence', () => {
  test('a stored Core preference is on <html> at first paint, after reload and after navigation', async ({ page }) => {
    await open(page, '/invoices');
    await expect(page.locator('html')).toHaveAttribute('data-awj-theme', 'core');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-awj-theme', 'core');
    expect(await bgOf(page, '[data-awj-shell="topbar"]')).toBe(CORE_LIGHT);
    await page.goto(`${baseUrl}/dashboard?awj-ui=3`, { waitUntil: 'load' });
    await expect(page.locator('html')).toHaveAttribute('data-awj-theme', 'core');
  });

  test('an unrecognized stored value falls back to Default (no attribute)', async ({ page }) => {
    await open(page, '/dashboard', { theme: 'default' });
    await page.evaluate(() => localStorage.setItem('awj:theme', 'Core'));
    await page.reload();
    await expect(page.locator('html')).not.toHaveAttribute('data-awj-theme', /.+/);
  });
});

test.describe('Core — Settings selector', () => {
  test('lists Core, applies it immediately on save and persists it', async ({ page }) => {
    await open(page, '/settings', { theme: 'default', locale: 'en' });
    const select = page.locator('select[aria-describedby="preferences-app-theme-hint"]');
    await expect(select.locator('option')).toHaveText(['Default', 'Ink', 'Core']);
    await select.selectOption('core');
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-awj-theme', 'core');
    expect(await page.evaluate(() => localStorage.getItem('awj:theme'))).toBe('core');
    expect(await bgOf(page, '[data-awj-shell="topbar"]')).toBe(CORE_LIGHT);
  });
});

test.describe('Core — contrast, hover, active and keyboard focus (live)', () => {
  for (const mode of ['light', 'dark'] as const) {
    test(`${mode}: shell text scan has no pair below 4.5:1 with the first group expanded`, async ({ page }) => {
      await open(page, '/invoices', { mode, locale: 'en' });
      // /invoices expands the Sales group (active leaf + rail), so leaf text and group rows are both on screen.
      expect(await scanContrast(page, '[data-awj-shell="sidebar"]')).toEqual([]);
      expect(await scanContrast(page, '[data-awj-shell="topbar"]')).toEqual([]);
    });

    test(`${mode}: hovered nav item stays legible (hover surface + hover text)`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name === 'mobile', 'hover is a desktop pointer state');
      await open(page, '/dashboard', { mode, locale: 'en' });
      const item = page.locator('[data-awj-shell="sidebar"] nav button').nth(1);
      await item.hover();
      await page.waitForTimeout(250);
      expect(await scanContrast(page, '[data-awj-shell="sidebar"]')).toEqual([]);
    });

    test(`${mode}: keyboard focus ring on a shell control is ≥ 3:1 against the shell`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name === 'mobile', 'keyboard focus is a desktop interaction');
      await open(page, '/dashboard', { mode, locale: 'en' });
      await page.locator('[data-awj-shell="sidebar"] nav a').first().focus();
      await page.keyboard.press('Tab');
      const measured = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || !el.closest('[data-awj-shell]')) return null;
        const outline = getComputedStyle(el).outlineColor;
        const shell = getComputedStyle(el.closest('[data-awj-shell]') as HTMLElement).backgroundColor;
        const parse = (v: string) => (v.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
        const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
        const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
        const [hi, lo] = [lum(parse(outline)), lum(parse(shell))].sort((a, b) => b - a);
        return { outline, shell, ratio: (hi + 0.05) / (lo + 0.05), width: getComputedStyle(el).outlineWidth };
      });
      expect(measured, 'focus did not land on a shell control').not.toBeNull();
      expect(measured!.ratio, JSON.stringify(measured)).toBeGreaterThanOrEqual(3);
      expect(measured!.width).toBe('2px');
    });
  }

  test('a menu opened from the Core topbar sits on Paper and stays legible', async ({ page }) => {
    await open(page, '/dashboard', { mode: 'light', locale: 'en' });
    await page.getByRole('button', { name: /Notifications/ }).first().click();
    const menu = page.locator('[data-awj-shell="topbar"] [role="menu"], [data-awj-shell="topbar"] [role="dialog"]').first();
    await expect(menu).toBeVisible();
    expect(await menu.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
    await page.waitForTimeout(600); // let the panel's fade-in finish: the scanner reads ancestor opacity
    expect(await scanContrast(page, '[data-awj-shell="topbar"]')).toEqual([]);
  });
});

test.describe('Core — mobile drawer', () => {
  test('the drawer takes the same shell color and the page does not overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'drawer is the mobile shell');
    for (const mode of ['light', 'dark'] as const) {
      await open(page, '/dashboard', { mode, locale: 'en' });
      await page.getByRole('button', { name: 'Menu' }).click();
      const sidebar = page.locator('[data-awj-shell="sidebar"]').first();
      await expect(sidebar).toBeVisible();
      expect(await bgOf(page, '[data-awj-shell="sidebar"]')).toBe(mode === 'light' ? CORE_LIGHT : CORE_DARK);
      expect(await bgOf(page, '[data-awj-shell="topbar"]')).toBe(mode === 'light' ? CORE_LIGHT : CORE_DARK);
      expect(await scanContrast(page, '[data-awj-shell="sidebar"]')).toEqual([]);
      expect(await overflowX(page)).toBe(0);
    }
  });
});
