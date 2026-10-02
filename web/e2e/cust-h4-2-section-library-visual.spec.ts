import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-H4-2 review fix — real browser visual QA for the Section Library's
 * mobile Bottom Sheet contract, using the existing `/dev/customizer-versions`
 * fixture (mounts the real `ExperienceBuilder` in demo mode — no Laravel
 * server, no login; same pattern `cust-h2-2-page-navigator.spec.ts` already
 * uses for this exact page). Screenshots are saved under `test-results/` and
 * were actually opened/inspected for this review fix (see the implementation
 * report's Visual QA section).
 */

const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-h4-2-section-library');

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

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

test.describe('CUST-H4-2 — Section Library mobile Bottom Sheet contract (visual)', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own explicit viewport');
  });

  for (const width of [390, 430]) {
    test(`AR ${width} — Library replaces the Sections sheet content, exactly one dialog on screen, no horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/dev/customizer-versions?locale=ar&scenario=single-draft');
      await page.waitForLoadState('networkidle');
      await waitForBuilderReady(page);
      await expect(page.locator('[data-experience-builder]')).toHaveAttribute('dir', 'rtl');

      // Open the generic "sections" Bottom Sheet from the mobile bottom nav.
      await page.getByRole('button', { name: /إضافة قسم/ }).first().click();
      const sheet = page.getByRole('dialog');
      await expect(sheet).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await assertNoOverflow(page);
      await page.screenshot({ path: path.join(evidenceDir, `ar-${width}-sections-sheet.png`) });

      // Open the Library from the sheet's own "+ Add section" button — must
      // stay the same single sheet, not a second stacked dialog. All
      // further queries stay scoped to `sheet`: the (CSS-hidden-but-still-
      // mounted) desktop sidebar renders the same `HomepagePanel` in
      // parallel at this viewport, so an unscoped `page.locator(...)` would
      // ambiguously match both copies.
      await sheet.getByRole('button', { name: /إضافة قسم/ }).click();
      await expect(page.getByRole('dialog')).toHaveCount(1);
      const library = sheet.locator('[data-section-picker]');
      await expect(library).toBeVisible();
      expect(await library.getAttribute('role')).toBeNull();
      await assertNoOverflow(page);
      await page.screenshot({ path: path.join(evidenceDir, `ar-${width}-library-open.png`) });

      // Honest states visible without scrolling the search/chips out of view.
      await expect(library.locator('[data-picker-option="offers"]')).toBeVisible();
      await expect(library.locator('[data-picker-option="offers"]')).toBeDisabled();
      await expect(library.locator('[data-section-library-search]')).toBeVisible();

      // Search remains usable.
      await library.locator('[data-section-library-search]').fill('شريط ترويجي');
      await expect(library.locator('[data-picker-option="banner"]')).toBeVisible();
      await page.screenshot({ path: path.join(evidenceDir, `ar-${width}-library-search.png`) });

      // Add — returns to the composer (same sheet, not closed), now holding
      // the newly added instance. Proves "add" works end to end visually,
      // not just that the button exists.
      await library.locator('[data-picker-option="banner"]').click();
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await expect(sheet.locator('[data-section-picker]')).toHaveCount(0);
      await expect(sheet.locator('[data-composer-section="banner"]')).toBeVisible();
      await assertNoOverflow(page);
      await page.screenshot({ path: path.join(evidenceDir, `ar-${width}-after-add.png`) });

      // Re-open the Library and use its own close control — "back" to the
      // composer, not an exit from the sheet.
      await sheet.locator('[data-add-section]').click();
      const libraryAgain = sheet.locator('[data-section-picker]');
      await expect(libraryAgain).toBeVisible();
      await libraryAgain.getByLabel('إغلاق').click();
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await expect(sheet.locator('[data-section-picker]')).toHaveCount(0);
      await expect(sheet.locator('[data-composer-section="banner"]')).toBeVisible();
      await assertNoOverflow(page);
    });
  }

  test('AR desktop — Library opens as a centered dialog, Canvas stays visible behind it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=single-draft');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);

    await page.locator('[data-panel-option="homepage"]').click();
    await page.screenshot({ path: path.join(evidenceDir, 'ar-desktop-homepage-panel.png') });

    await page.locator('[data-add-section]').click();
    const dialog = page.getByRole('dialog', { name: 'مكتبة الأقسام' });
    await expect(dialog).toBeVisible();
    await expect(page.locator('[data-preview-canvas]')).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'ar-desktop-library-dialog.png') });

    // Offers is always disabled regardless of this fixture's starting
    // document (merchantAddable: false is a capability-level gate, not an
    // instance-count one) — the one assertion that holds unconditionally.
    await expect(dialog.locator('[data-picker-option="offers"]')).toBeDisabled();
    await expect(dialog.locator('[data-picker-option="banner"]')).toBeEnabled();
  });
});
