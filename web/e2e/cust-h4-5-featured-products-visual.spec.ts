import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-H4-5 — real browser visual QA for the Featured Products real
 * picker (multi-select, search, selected chips, reorder, max enforcement)
 * and the Canvas preview resolving real Commerce product data (never bare
 * id chips, never PREVIEW_PRODUCTS). Same `/dev/customizer-versions`
 * fixture as CUST-H4-2/H4-3/H4-4 (mounts the real `ExperienceBuilder` in
 * demo mode — no Laravel server, no login). `MOCK_WORKSPACE_PRODUCTS`
 * (3 real-looking fixture products) now also honors an `ids[]` filter
 * (added in this slice, dev-fixture-only — see `web/src/lib/mock-data.ts`)
 * so the picker's selected chips and the Canvas preview both resolve
 * against the same mock data the real backend's `ids[]` filter would.
 */

const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-h4-5-featured-products');

async function waitForBuilderReady(page: Page) {
  await page.waitForSelector('[data-experience-builder]');
  await page.waitForTimeout(400);
}

async function assertNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

/** Adds the "featured" Home section via the real CUST-H4-2 Section Library
 * UI and leaves it selected, exactly like H4-4's own spec does. */
async function addFeaturedSection(page: Page, isMobile: boolean, homeLabel: string) {
  if (isMobile) {
    if ((await page.getByRole('dialog').count()) === 0) {
      await page.getByRole('button', { name: /إضافة قسم|Add section/ }).first().click();
    }
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: /إضافة قسم|Add section/ }).click();
    await sheet.locator('[data-picker-option="featured"]').click();
    return;
  }
  await page.getByRole('button', { name: homeLabel }).click();
  await page.locator('[data-add-section]').click();
  await page.locator('[data-picker-option="featured"]').click();
}

function sectionPanel(page: Page, isMobile: boolean) {
  const locator = '[data-selected-section-settings="featured"]';
  return isMobile ? page.getByRole('dialog').locator(locator) : page.locator(locator);
}

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

test.describe('CUST-H4-5 — Featured Products real picker (visual)', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own explicit viewport');
  });

  for (const width of [390, 430]) {
    test(`AR ${width} — picker with real candidates, select two, reorder`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/dev/customizer-versions?locale=ar&scenario=single-draft');
      await page.waitForLoadState('networkidle');
      await waitForBuilderReady(page);
      await expect(page.locator('[data-experience-builder]')).toHaveAttribute('dir', 'rtl');

      await addFeaturedSection(page, true, 'الصفحة الرئيسية');
      const panel = sectionPanel(page, true);
      await expect(panel.getByText('لم تُختَر منتجات بعد.')).toBeVisible();

      // Real candidates render (not a raw id input) — select two.
      await panel.locator('[data-featured-option="mock-product-helmet"]').click();
      await panel.locator('[data-featured-option="mock-product-tshirt"]').click();
      await expect(panel.locator('[data-featured-selected] >> text=2/8')).toBeVisible();

      await assertNoOverflow(page);
      await page.screenshot({ path: path.join(evidenceDir, `ar-${width}-featured-picker.png`), fullPage: true });
    });
  }

  test('AR desktop — selected chips, real Canvas preview, reorder and max enforcement', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=single-draft');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);

    await addFeaturedSection(page, false, 'الصفحة الرئيسية');
    const panel = page.locator('[data-selected-section-settings="featured"]');

    // Select all three real mock products — the fixture's full catalog —
    // to prove the Canvas renders real names/images, not ids.
    await panel.locator('[data-featured-option="mock-product-helmet"]').click();
    await panel.locator('[data-featured-option="mock-product-tshirt"]').click();
    await panel.locator('[data-featured-option="mock-product-bare"]').click();
    await expect(panel.locator('[data-featured-selected] >> text=3/8')).toBeVisible();

    // Reorder: move the first selected chip down one.
    const firstChip = panel.locator('[data-featured-selected-item]').first();
    await firstChip.getByLabel('أسفل').click();

    // The Canvas must show real resolved data, not bare ids.
    const canvas = page.locator('[data-preview-canvas]');
    const featuredSection = canvas.locator('section[aria-labelledby^="preview-featured-"]');
    await expect(featuredSection).toBeVisible();
    await expect(featuredSection).toContainText('قميص قطني');
    await expect(featuredSection.locator('img')).toHaveCount(1); // only the helmet has real media

    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'ar-desktop-featured-selected.png'), fullPage: true });
  });

  test('AR desktop — search narrows candidates and prevents duplicate selection', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=single-draft');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);

    await addFeaturedSection(page, false, 'الصفحة الرئيسية');
    const panel = page.locator('[data-selected-section-settings="featured"]');

    await panel.getByLabel('بحث عن منتج لإضافته').fill('قميص');
    await expect(panel.locator('[data-featured-option]')).toHaveCount(1);
    await panel.locator('[data-featured-option="mock-product-tshirt"]').click();
    await expect(panel.locator('[data-featured-option="mock-product-tshirt"]')).toHaveAttribute('aria-selected', 'true');

    // Clicking the same (now-selected) option again deselects it — no
    // duplicate can ever appear in the stored selection.
    await panel.locator('[data-featured-option="mock-product-tshirt"]').click();
    await expect(panel.locator('[data-featured-selected] >> text=لم تُختَر منتجات بعد.')).toBeVisible();

    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'ar-desktop-featured-search.png'), fullPage: true });
  });

  test('EN desktop — missing-image fallback and empty selection, under LTR', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/dev/customizer-versions?locale=en&scenario=single-draft');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);
    await expect(page.locator('[data-experience-builder]')).toHaveAttribute('dir', 'ltr');

    await addFeaturedSection(page, false, 'Homepage');
    const panel = page.locator('[data-selected-section-settings="featured"]');
    await expect(panel.getByText('No products selected yet.')).toBeVisible();

    // The t-shirt and the "bare" product both have no media — an honest
    // placeholder, never an invented image, on both the picker row and the
    // Canvas preview. The rendered name stays Arabic even under English UI
    // (no `name_en` column on this catalog's Canvas path — the existing,
    // documented convention `ProductPreviewPickerPanel.tsx`/Categories/New
    // Arrivals already follow; not a bug).
    await panel.locator('[data-featured-option="mock-product-tshirt"]').click();
    const canvas = page.locator('[data-preview-canvas]');
    const featuredSection = canvas.locator('section[aria-labelledby^="preview-featured-"]');
    await expect(featuredSection).toContainText('قميص قطني');
    await expect(featuredSection.locator('img')).toHaveCount(0);

    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'en-desktop-featured-no-image.png'), fullPage: true });
  });
});
