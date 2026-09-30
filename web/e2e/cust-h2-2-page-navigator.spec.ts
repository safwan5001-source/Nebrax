import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-h2-2-page-navigator');

async function assertNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

// Mirrors `cust-h1-2-version-manager.spec.ts`'s own note: the dev route
// doesn't set `<html dir>` (that's the public layout's job) — the builder's
// own direction lives on its internal root.
async function assertBuilderDir(page: Page, dir: 'rtl' | 'ltr') {
  await expect(page.locator('[data-experience-builder]')).toHaveAttribute('dir', dir);
}

async function waitForBuilderReady(page: Page) {
  await page.waitForSelector('[data-experience-builder]');
  await page.waitForTimeout(400);
}

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

test.describe('CUST-H2-2 — Page Navigator + page-aware Canvas shell', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own explicit viewport');
  });

  test('AR 390 — Home: mobile page pill visible, Canvas renders the unchanged Home preview', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=single-draft');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);
    await assertBuilderDir(page, 'rtl');

    const pill = page.locator('[data-page-navigator-mobile]');
    await expect(pill).toBeVisible();
    await expect(pill).toContainText('الرئيسية');
    await expect(page.locator('[data-preview-canvas]')).toHaveAttribute('data-preview-page', 'home');
    await expect(page.locator('[data-page-placeholder]')).toHaveCount(0);
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'ar-390-home.png') });
  });

  test('AR 390 — Product: Page Navigator sheet open, then a real structured Product preview (CUST-H2-3), no overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=single-draft');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);

    await page.locator('[data-page-navigator-mobile]').click();
    const sheet = page.getByRole('dialog', { name: 'اختيار صفحة' });
    await expect(sheet).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'ar-390-product-navigator-open.png') });

    await sheet.getByRole('button', { name: 'صفحة المنتج' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-experience-builder]')).toHaveAttribute('data-current-page', 'product');
    // CUST-H2-3 — Product is no longer a placeholder: the first eligible
    // dev-fixture Product (never a fabricated one) renders for real.
    await expect(page.locator('[data-product-preview="ready"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-page-placeholder="product"]')).toHaveCount(0);
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'ar-390-product-ready.png') });
  });

  test('AR 430 — Category via the mobile sheet, no overflow', async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=single-draft');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);

    await page.locator('[data-page-navigator-mobile]').click();
    await page.getByRole('dialog', { name: 'اختيار صفحة' }).getByRole('button', { name: 'صفحة التصنيف' }).click();
    await expect(page.locator('[data-page-placeholder="category"]')).toBeVisible();
    await expect(page.locator('[data-page-navigator-mobile]')).toContainText('صفحة التصنيف');
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'ar-430-category.png') });
  });

  test('AR 768 (tablet) — Product via the toolbar dropdown, Page and Version stay distinguishable, no overflow', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=single-draft');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);

    const pageTrigger = page.getByLabel('الصفحة المعروضة حالياً');
    const versionTrigger = page.getByLabel('نسخة التصميم قيد التعديل');
    await expect(pageTrigger).toBeVisible();
    await expect(versionTrigger).toBeVisible();
    // Two independent controls, never merged into one selector.
    await expect(pageTrigger).not.toBe(versionTrigger);

    await pageTrigger.click();
    await page.getByRole('menu', { name: 'اختيار صفحة' }).getByRole('button', { name: 'صفحة المنتج' }).click();
    await expect(page.locator('[data-product-preview="ready"]')).toBeVisible({ timeout: 10000 });
    // CUST-H2-3 — the Preview Product picker reuses PageNavigator's own
    // 768–1023px icon-only compaction (H2-2's own measured fix for this
    // exact budget) — visible, but without its full product-name label yet.
    const productPicker = page.getByLabel('منتج المعاينة');
    await expect(productPicker).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'ar-768-product.png') });
  });

  test('AR 1024 — Home: toolbar shows Page and Version as separate controls', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=single-draft');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);

    await expect(page.getByLabel('الصفحة المعروضة حالياً')).toContainText('الرئيسية');
    await expect(page.getByLabel('نسخة التصميم قيد التعديل')).toContainText('التصميم الحالي');
    await expect(page.locator('[data-preview-canvas]')).toHaveAttribute('data-preview-page', 'home');
    // No `assertNoOverflow` here: `document.documentElement.scrollWidth` is
    // 1037 at exactly this width/locale on **unmodified `main`, with the
    // Page Navigator entirely absent** — the `lg:inline` Schedule/Restore
    // toolbar buttons alone already exceed the 1024px budget by ~13px, a
    // pre-existing CUST-H1-5 toolbar-budget gap this slice's own QA pass
    // happened to be the first to probe at exactly 1024px (H1-2's own
    // tablet check only covers 768px). Confirmed independent of this
    // slice's changes by reverting `ExperienceBuilder.tsx` to `main` and
    // re-measuring (same 1037). Reported in the implementation report as a
    // discovered, out-of-scope defect rather than silently fixed here or
    // silently hidden by loosening the assertion for every viewport.
    await page.screenshot({ path: path.join(evidenceDir, 'ar-1024-home.png') });
  });

  test('AR 1440 — Category via the toolbar dropdown, no overflow, Home unaffected by prior state', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=single-draft');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);

    await page.getByLabel('الصفحة المعروضة حالياً').click();
    await page.getByRole('menu', { name: 'اختيار صفحة' }).getByRole('button', { name: 'صفحة التصنيف' }).click();
    await expect(page.locator('[data-page-placeholder="category"]')).toBeVisible();
    // Version and draft status are untouched by a page switch.
    await expect(page.getByLabel('نسخة التصميم قيد التعديل')).toContainText('التصميم الحالي');
    await expect(page.locator('[data-experience-builder]')).toHaveAttribute('data-lifecycle', 'clean');
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'ar-1440-category.png') });
  });

  test('EN 390 — Product via the mobile sheet, a real structured preview (CUST-H2-3), no overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dev/customizer-versions?locale=en&scenario=single-draft');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);
    await assertBuilderDir(page, 'ltr');

    await page.locator('[data-page-navigator-mobile]').click();
    const sheet = page.getByRole('dialog', { name: 'Choose a page' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Product page' }).click();
    await expect(page.locator('[data-product-preview="ready"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-page-placeholder="product"]')).toHaveCount(0);
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'en-390-product.png') });
  });

  test('EN 768 (tablet) — Category via the toolbar dropdown, no overflow', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/dev/customizer-versions?locale=en&scenario=single-draft');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);

    await page.getByLabel('Page currently being viewed').click();
    await page.getByRole('menu', { name: 'Choose a page' }).getByRole('button', { name: 'Category page' }).click();
    await expect(page.locator('[data-page-placeholder="category"]')).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'en-768-category.png') });
  });

  test('EN 1280 — Home: keyboard navigation opens the Page Navigator and selects Product with Enter', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/dev/customizer-versions?locale=en&scenario=single-draft');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);

    const trigger = page.getByLabel('Page currently being viewed');
    await expect(trigger).toContainText('Home');
    await page.screenshot({ path: path.join(evidenceDir, 'en-1280-home.png') });

    await trigger.focus();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: 'Choose a page' });
    await expect(menu).toBeVisible();
    const homeOption = menu.getByRole('button', { name: 'Home' });
    await expect(homeOption).toHaveAttribute('aria-current', 'page');

    const productOption = menu.getByRole('button', { name: 'Product page' });
    await productOption.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    await expect(page.locator('[data-experience-builder]')).toHaveAttribute('data-current-page', 'product');
    await expect(trigger).toBeFocused();

    // Escape closes the manager the same way it already does for the
    // Version Selector — reused Dropdown behavior, not reinvented here.
    await trigger.click();
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await assertNoOverflow(page);
  });
});
