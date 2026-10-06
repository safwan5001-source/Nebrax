import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-HV V3 — announcement bar in the builder: the panel is reachable and
 * usable, the Canvas shows the bar, and nothing overflows horizontally at
 * 390 · 430 · 768 · 1024 · 1280 · 1440 in Arabic RTL and English LTR.
 */
const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-hv-v3-announcements');
const WIDTHS = [390, 430, 768, 1024, 1280, 1440] as const;
const LOCALES = ['ar', 'en'] as const;
const NAV = { ar: 'شريط الإعلانات', en: 'Announcement bar' } as const;

async function hideDevOverlay(page: Page) {
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
}

// The builder shell itself overflows by 1px at every width on main (measured
// before any interaction); the guarantee here is that V3 adds nothing to it.
async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function openPanel(page: Page, locale: 'ar' | 'en', width: number) {
  const option = page.locator('[data-panel-option="announcements"]');
  if (width < 1024) {
    // The mobile bar's third button opens the "design" sheet (panel navigation).
    await page.locator('[data-builder-mobile-bar] button').nth(2).click().catch(() => undefined);
    await page.waitForTimeout(300);
  }
  if (!(await option.first().isVisible().catch(() => false))) {
    await page.getByRole('button', { name: NAV[locale] }).first().click();
  } else {
    await option.first().click();
  }
  await expect(page.locator('[data-announcements-panel]')).toBeVisible();
}

for (const locale of LOCALES) {
  for (const width of WIDTHS) {
    test(`announcements builder ${locale} @ ${width}`, async ({ page }) => {
      await mkdir(evidenceDir, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/dev/customizer-versions?locale=${locale}&scenario=single-draft`);
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('[data-experience-builder]');
      await hideDevOverlay(page);
      await page.waitForTimeout(300);
      const baseline = await horizontalOverflow(page);
      const noHorizontalOverflow = async (p: Page) => expect(await horizontalOverflow(p)).toBeLessThanOrEqual(baseline);

      await openPanel(page, locale, width);
      const panel = page.locator('[data-announcements-panel]');

      // Enable + add a message + write text.
      await panel.getByRole('checkbox').first().check({ force: true });
      await panel.getByRole('button', { name: locale === 'ar' ? 'إضافة رسالة' : 'Add message' }).click();
      const text = locale === 'ar' ? 'شحن مجاني لكل الطلبات فوق ٢٠٠ ريال — لفترة محدودة' : 'Free shipping on orders over SAR 200 — limited time';
      await panel.locator('textarea').first().fill(text);
      await panel.locator('select').first().selectOption('truck');
      await page.waitForTimeout(300);
      await noHorizontalOverflow(page);
      await page.screenshot({ path: path.join(evidenceDir, `panel-${locale}-${width}.png`) });

      // Custom colour with a low-contrast text pair is called out in the panel.
      await panel.getByRole('button', { name: locale === 'ar' ? 'لون مخصص' : 'Custom colour' }).click();
      await panel.getByRole('button', { name: locale === 'ar' ? 'مخصص' : 'Custom', exact: true }).click();
      await expect(panel.locator('[data-announcement-contrast]')).toBeVisible();
      await noHorizontalOverflow(page);
      await page.screenshot({ path: path.join(evidenceDir, `panel-colour-${locale}-${width}.png`) });

      // The Canvas shows the bar (mobile: switch to the preview pane first).
      if (width < 768) {
        await page.keyboard.press('Escape');
        const closeSheet = page.locator('div[role="presentation"].fixed button').first();
        if (await closeSheet.isVisible().catch(() => false)) await closeSheet.click();
      }
      await expect(page.locator('[data-announcement-preview]').first()).toBeAttached();
      await noHorizontalOverflow(page);
      await page.screenshot({ path: path.join(evidenceDir, `canvas-${locale}-${width}.png`) });
    });
  }
}
