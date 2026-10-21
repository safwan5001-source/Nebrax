import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * P3-A-05 — real-browser visual QA of the global background control (Appearance panel) in the real
 * `ExperienceBuilder`, mounted in demo mode by `/dev/customizer-versions` (no Laravel, no login).
 * Demo mode serves its own in-memory media library, so nothing leaves the browser. Screenshots are the evidence.
 */

const evidenceDir = path.resolve(process.cwd(), 'test-results/p3-a-05');

async function hideDevOverlay(page: Page) {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
}

async function openAppearance(page: Page, locale: 'ar' | 'en') {
  await page.goto(`/dev/customizer-versions?locale=${locale}&scenario=single-draft`);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('[data-experience-builder]');
  await hideDevOverlay(page);
  await page.getByRole('button', { name: locale === 'ar' ? 'المظهر' : 'Appearance' }).first().click();
  const field = page.locator('[data-global-background]');
  await expect(field).toBeVisible();
  return field;
}

async function assertNoOverflow(page: Page) {
  const o = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(o.s).toBeLessThanOrEqual(o.c + 1);
}

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

test.describe('P3-A-05 — global background editor (visual)', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own explicit viewport');
  });

  for (const locale of ['ar', 'en'] as const) {
    test(`${locale} desktop — solid, gradient, image (draft-only), reset`, async ({ page }) => {
          await page.setViewportSize({ width: 1440, height: 1700 }); // tall enough to see the whole panel in one shot
      const field = await openAppearance(page, locale);
      const dir = locale === 'ar' ? 'rtl' : 'ltr';
      await expect(page.locator('[data-experience-builder]')).toHaveAttribute('dir', dir);
      const names = locale === 'ar'
        ? { solid: 'لون ثابت', gradient: 'تدرج لوني', image: 'صورة خلفية', reset: 'استعادة الافتراضي' }
        : { solid: 'Solid colour', gradient: 'Gradient', image: 'Background image', reset: 'Restore default' };
      const canvas = page.locator('.awj-store-preview').first();

      // Solid is the legacy default; only its fields are shown.
      await expect(field.getByRole('button', { name: names.solid })).toHaveAttribute('aria-pressed', 'true');
      await expect(field.locator('[data-global-bg-panel="gradient"], [data-global-bg-panel="image"]')).toHaveCount(0);
      await field.scrollIntoViewIfNeeded();
      await field.screenshot({ path: path.join(evidenceDir, `${locale}-1-solid.png`) });

      // Gradient: immediate canvas preview, logical direction in the page's writing direction.
      await field.getByRole('button', { name: names.gradient }).click();
      await expect(canvas).toHaveCSS('background-image', /linear-gradient/);
      await field.locator('[data-global-bg-direction]').selectOption('to-end');
      const image = await canvas.evaluate((el) => getComputedStyle(el).backgroundImage);
      expect(image).toContain(dir === 'rtl' ? 'to left' : 'to right');
      // a gradient is saved and previewed, but flagged draft-only: its contrast over text is not proven yet
      await expect(field.locator('[data-global-bg-draft-only="gradient"]')).toBeVisible();
      await expect(field.locator('[data-global-bg-draft-only="image"]')).toHaveCount(0);
      await field.screenshot({ path: path.join(evidenceDir, `${locale}-2-gradient.png`) });
      await page.screenshot({ path: path.join(evidenceDir, `${locale}-2-gradient-page.png`) });

      // Image: nothing is stored until a picture is picked; the draft-only note is there from the start.
      await field.getByRole('button', { name: names.image }).click();
      await expect(field.locator('[data-global-bg-pending]')).toBeVisible();
      await expect(field.locator('[data-global-bg-draft-only]')).toBeVisible();
      await expect(canvas).toHaveCSS('background-image', /linear-gradient/); // gradient still effective until a pick
      await field.screenshot({ path: path.join(evidenceDir, `${locale}-3-image-pending.png`) });

      await field.locator('[data-media-pick="global-background"]').click();
      await page.getByRole('button', { name: /hero-spring\.jpg/ }).first().click();
      await expect(page.locator('[data-global-background-layer]').first()).toBeVisible();
      await expect(page.locator('[data-global-background-layer] video')).toHaveCount(0);

      // phone image + focal + overlay
      await field.locator('[data-media-pick="global-background-phone"]').click();
      await page.getByRole('button', { name: /banner-ramadan\.webp/ }).first().click();
      await expect(field.locator('[data-global-bg-focal="phone"]')).toBeVisible();
      await field.locator('[data-global-bg-focal="desktop"] button').nth(2).click(); // top-right (physical)
      const cell = await field.locator('[data-global-bg-focal="desktop"] button').nth(2).boundingBox();
      const grid = await field.locator('[data-global-bg-focal="desktop"] [data-global-bg-focal-grid]').boundingBox();
      expect(cell && grid && cell.x + cell.width / 2 > grid.x + grid.width / 2).toBe(true); // it really sits on the right, even in RTL
      await field.locator('[data-global-bg-overlay-alpha]').selectOption('35');
      await expect(field.locator('[data-colour-field="global-bg-overlay-color"]')).toBeVisible();
      await expect(page.locator('[data-global-background-image]').first()).toHaveCSS('object-position', '100% 0%');
      await field.scrollIntoViewIfNeeded();
      await field.screenshot({ path: path.join(evidenceDir, `${locale}-4-image-configured.png`) });
      await page.screenshot({ path: path.join(evidenceDir, `${locale}-4-image-configured-page.png`) });

      // Restore default removes the advanced object entirely (not just the colour).
      await expect(field.locator('[data-global-bg-draft-only="image"]')).toBeVisible();
      await field.getByRole('button', { name: names.reset }).click();
      await expect(field.locator('[data-global-bg-draft-only]')).toHaveCount(0);
      await expect(page.locator('[data-global-background-layer]')).toHaveCount(0);
      await expect(field.getByRole('button', { name: names.solid })).toHaveAttribute('aria-pressed', 'true');
      await expect(canvas).toHaveCSS('background-image', 'none');
      await field.screenshot({ path: path.join(evidenceDir, `${locale}-5-after-reset.png`) });
      await assertNoOverflow(page);
    });
  }

  test('ar mobile 390 — the control fits, nothing overflows, and the draft-only note is readable', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=single-draft');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-experience-builder]');
    await hideDevOverlay(page);
    await page.locator('[data-builder-mobile-bar] button').last().click(); // «التصميم» opens the Appearance panel sheet
    const field = page.getByRole('dialog').locator('[data-global-background]');
    await expect(field).toBeVisible();
    await field.getByRole('button', { name: 'تدرج لوني' }).click();
    await field.getByRole('button', { name: 'صورة خلفية' }).click();
    await expect(field.locator('[data-global-bg-draft-only]')).toBeVisible();
    await field.locator('[data-media-pick="global-background"]').click();
    await page.getByRole('button', { name: /hero-spring\.jpg/ }).first().click();
    await field.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidenceDir, 'ar-mobile-390-image.png') });
    await assertNoOverflow(page);
  });
});
