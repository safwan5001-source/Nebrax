import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-HV V9d-1 — the card tokens in the real builder's Theme panel (demo mode): the "Cards" group offers named steps only, writes them into the
 * draft (the Canvas root carries the same token list and variables the storefront wrapper does) and never leaves the viewport. AR RTL + EN LTR.
 * (The card visuals themselves are proven on the REAL product / offer cards in `storefront/scripts/card-proof`.)
 */
const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-hv-v9d1');
const WIDTHS = [390, 1024, 1280] as const;
const LOCALES = ['ar', 'en'] as const;

async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function openThemePanel(page: Page, width: number) {
  if (width >= 1024) {
    await page.locator('[data-panel-option="theme"]').first().click();
  } else {
    await page.locator('[data-builder-mobile-bar] button').nth(2).click();
    await page.locator('[data-design-panel-select]').selectOption('theme');
  }
}

for (const locale of LOCALES) {
  for (const width of WIDTHS) {
    test(`card tokens ${locale} @ ${width}`, async ({ page }) => {
      await mkdir(evidenceDir, { recursive: true });
      await page.setViewportSize({ width, height: 960 });
      await page.goto(`/dev/customizer-versions?locale=${locale}&scenario=single-draft`);
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('[data-experience-builder]');
      await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
      await page.waitForTimeout(300);
      const baseline = await overflow(page);

      await openThemePanel(page, width);
      const group = page.locator('[data-gt-cards]:visible');
      await group.scrollIntoViewIfNeeded();
      await expect(group).toBeVisible();

      const field = (name: string) => group.locator(`[data-gt-field="cards.${name}"]`);
      for (const name of ['align', 'imageRatio', 'imageFit', 'hover']) {
        await expect(field(name)).toHaveValue('');
        // an "as today" choice plus named steps only
        expect(await field(name).locator('option').count()).toBeGreaterThanOrEqual(3);
      }
      await field('align').selectOption('center');
      await field('imageRatio').selectOption('4:3');
      await field('imageFit').selectOption('contain');
      await field('hover').selectOption('lift');

      // the Canvas root carries the same token list and variables the published wrapper does
      const root = page.locator('.awj-store-preview[data-gt]').first();
      await expect(root).toHaveAttribute('data-gt', /cd-al/);
      await expect(root).toHaveAttribute('data-gt', /cd-ir/);
      await expect(root).toHaveAttribute('data-gt', /cd-if/);
      await expect(root).toHaveAttribute('data-gt', /cd-hv/);
      const vars = await root.evaluate((el) => ({
        ir: (el as HTMLElement).style.getPropertyValue('--cd-ir'),
        al: (el as HTMLElement).style.getPropertyValue('--cd-al'),
        hl: (el as HTMLElement).style.getPropertyValue('--cd-hl'),
      }));
      expect(vars).toEqual({ ir: '4 / 3', al: 'center', hl: '-4px' });

      // back to "as today" removes every trace
      for (const name of ['align', 'imageRatio', 'imageFit', 'hover']) await field(name).selectOption('');
      await expect(page.locator('.awj-store-preview[data-gt~="cd-al"], .awj-store-preview[data-gt~="cd-ir"]')).toHaveCount(0);

      expect(await overflow(page)).toBeLessThanOrEqual(baseline + 1);
      const inside = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        return [...document.querySelectorAll('[data-gt-cards] select')]
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .every((el) => {
            const r = el.getBoundingClientRect();
            return r.width === 0 || (r.left >= -0.5 && r.right <= vw + 0.5);
          });
      });
      expect(inside).toBe(true);
      await page.screenshot({ path: path.join(evidenceDir, `cards-${locale}-${width}.png`) });
    });
  }
}
