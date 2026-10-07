import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-HV V5d-3 (V1B) — a real editing surface at 768–1023 (DEF-7 / BL-3), and a
 * usable Canvas at 1024 (BL-4), in Arabic RTL and English LTR at the six widths.
 */
const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-hv-v5d3-layout');
const WIDTHS = [390, 430, 768, 1024, 1280, 1440] as const;
const LOCALES = ['ar', 'en'] as const;

async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

for (const locale of LOCALES) {
  for (const width of WIDTHS) {
    test(`builder layout ${locale} @ ${width}`, async ({ page }) => {
      await mkdir(evidenceDir, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/dev/customizer-versions?locale=${locale}&scenario=single-draft`);
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('[data-experience-builder]');
      await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
      await page.waitForTimeout(300);
      const baseline = await overflow(page);
      const toolbar = page.locator('[data-builder-toolbar]');

      // primary actions stay reachable at every width (V1A guarantee preserved)
      await expect(page.locator('[data-save]')).toBeVisible();

      if (width >= 768 && width < 1024) {
        const toggle = page.locator('[data-builder-edit-toggle]');
        await expect(toggle).toBeVisible();
        const drawer = page.locator('[data-builder-controls]');
        await expect(drawer).toBeHidden();
        await toggle.click();
        await expect(drawer).toBeVisible();
        const box = (await drawer.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(320);
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        // the toolbar (Save / Publish / Exit) is not covered by the drawer
        const tb = (await toolbar.boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(tb.y + tb.height - 1);
        await expect(page.locator('[data-save]')).toBeVisible();
        // panels are reachable inside the drawer
        await drawer.locator('#customizer-panel-select').selectOption('homepage');
        await expect(drawer.locator('[data-add-section]')).toBeVisible();
        await page.screenshot({ path: path.join(evidenceDir, `drawer-${locale}-${width}.png`) });
        // Escape closes it and focus returns to the toggle
        await page.keyboard.press('Escape');
        await expect(drawer).toBeHidden();
        await expect(toggle).toBeFocused();
        // the close button does the same
        await toggle.click();
        await drawer.locator('[data-builder-drawer-close]').click();
        await expect(drawer).toBeHidden();
      } else if (width >= 1024) {
        await expect(page.locator('[data-builder-edit-toggle]')).toHaveCount(0);
        const canvas = (await page.locator('[data-builder-preview]').boundingBox())!;
        if (width < 1280) {
          // BL-4: the rail collapsed to icons and the Canvas stays usable
          await expect(page.locator('[data-experience-builder]')).toHaveAttribute('data-builder-navigation-collapsed', 'true');
          expect(canvas.width).toBeGreaterThanOrEqual(560);
        }
        await page.screenshot({ path: path.join(evidenceDir, `wide-${locale}-${width}.png`) });
      } else {
        await expect(page.locator('[data-builder-edit-toggle]')).toHaveCount(0);
      }
      expect(await overflow(page)).toBeLessThanOrEqual(baseline);
    });
  }
}

test('accent role: today\'s badge colours without an accent, the accent with one (DEF-2)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/dev/customizer-visual?locale=en&scenario=populated&viewport=desktop');
  await page.waitForSelector('[data-visual-root]');
  const colours = await page.evaluate(() => {
    const root = document.querySelector('.awj-store-preview') as HTMLElement;
    const probe = document.createElement('span');
    probe.className = 'bg-store-accent text-store-accent-foreground';
    probe.textContent = 'x';
    root.appendChild(probe);
    const read = () => ({ bg: getComputedStyle(probe).backgroundColor, fg: getComputedStyle(probe).color });
    const legacy = read();
    const base = { bg: getComputedStyle(root).getPropertyValue('--store-foreground'), surface: getComputedStyle(root).getPropertyValue('--store-surface') };
    root.style.setProperty('--store-accent', '#d1456a');
    root.style.setProperty('--store-accent-foreground', '#ffffff');
    const live = read();
    probe.remove();
    return { legacy, live, base };
  });
  expect(colours.legacy.bg).toBe('rgb(17, 24, 39)'); // --store-foreground, as before
  expect(colours.legacy.fg).toBe('rgb(255, 255, 255)'); // --store-surface, as before
  expect(colours.live.bg).toBe('rgb(209, 69, 106)');
});
