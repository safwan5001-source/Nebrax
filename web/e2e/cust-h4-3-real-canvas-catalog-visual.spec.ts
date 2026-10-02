import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-H4-3 — real browser visual QA for the Home "categories"/
 * "newArrivals" sections' real Canvas catalog data, using the existing
 * `/dev/customizer-versions` fixture (mounts the real `ExperienceBuilder` in
 * demo mode — no Laravel server, no login; same pattern
 * `cust-h2-2-page-navigator.spec.ts`/`cust-h4-2-section-library-visual.spec.ts`
 * already use for this exact page). The fixture's demo-mode `mockApi()`
 * already has dedicated handlers for the real
 * `/commerce/workspace/storefronts/{id}/{products,categories}` routes
 * (`MOCK_WORKSPACE_PRODUCTS`/`MOCK_WORKSPACE_CATEGORIES`, built for CUST-H2-3/
 * H2-4's own visual QA) — this spec reuses that existing fixture data as-is,
 * it adds none of its own.
 *
 * None of this fixture's seeded scenarios ever attach a `config` to the
 * seeded version (`seedMockPresentationVersions`'s own `config: v.config ??
 * { version: 2 }` default), so every scenario's Home page starts with an
 * explicit, empty section list (CUST-H4 V2 documents treat an absent/empty
 * list as "merchant cleared it", unlike pre-V2 legacy documents — see
 * `resolveHomeBuilderSections` in `presentation/config.ts`) — a pre-existing
 * fixture property, not something this slice caused or changed. This spec
 * therefore adds the "categories"/"newArrivals" sections itself through the
 * real, already-shipped CUST-H4-2 Section Library UI (the same `onAdd` path
 * a merchant actually uses), rather than editing the shared fixture's
 * seeding to inject a config no scenario has ever used.
 */

const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-h4-3-real-canvas-catalog');

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

/** Adds one Home section type via the real CUST-H4-2 Section Library UI. */
async function addHomeSection(page: Page, type: 'categories' | 'newArrivals', isMobile: boolean) {
  if (isMobile) {
    // Mirrors `cust-h4-2-section-library-visual.spec.ts`'s own two-step
    // mobile flow exactly: the bottom nav opens the generic "sections"
    // sheet, then the sheet's own "+ Add section" opens the Library in
    // place of the composer (never a second stacked dialog). Adding a
    // second section right after the first leaves the sheet open (on the
    // just-added instance's own settings, per the H4-2 report's §5/§8) —
    // the outer bottom-nav trigger is then hidden behind that still-open
    // modal, so it must only be clicked when no dialog is open yet.
    if ((await page.getByRole('dialog').count()) === 0) {
      await page.getByRole('button', { name: /إضافة قسم/ }).first().click();
    }
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: /إضافة قسم/ }).click();
    await sheet.locator(`[data-picker-option="${type}"]`).click();
    return;
  }
  // Desktop: the Homepage inspector panel owns the composer/add-section
  // button and its centered `SectionLibraryDialog`.
  await page.getByRole('button', { name: 'الصفحة الرئيسية' }).click();
  await page.locator('[data-add-section]').click();
  await page.locator(`[data-picker-option="${type}"]`).click();
}

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

test.describe('CUST-H4-3 — real Home catalog Canvas preview (visual)', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own explicit viewport');
  });

  for (const width of [390, 430]) {
    test(`AR ${width} — real categories/new-arrivals render after adding them, no mock fixture text, no overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/dev/customizer-versions?locale=ar&scenario=single-draft');
      await page.waitForLoadState('networkidle');
      await waitForBuilderReady(page);
      await expect(page.locator('[data-experience-builder]')).toHaveAttribute('dir', 'rtl');

      await addHomeSection(page, 'categories', true);
      await addHomeSection(page, 'newArrivals', true);

      // The CSS-hidden desktop sidebar still mounts the same Canvas in
      // parallel at mobile widths (pre-existing, documented in the H4-2
      // report's §8/§14) — scope to the visible preview pane only.
      const categoriesSection = page.locator('[data-preview-canvas] section[aria-labelledby="preview-categories"]').first();
      const arrivalsSection = page.locator('[data-preview-canvas] section[aria-labelledby="preview-arrivals"]').first();

      // Real root categories from the fixture's mock workspace categories —
      // only the 3 with `parent_id: null` (bikes, many-children, empty);
      // the two non-root ones (road-bikes, deep) must not appear here.
      await expect(categoriesSection).toContainText('الدراجات الهوائية ومستلزماتها');
      await expect(categoriesSection).toContainText('إكسسوارات متنوعة');
      await expect(categoriesSection).toContainText('تصنيف فارغ');
      await expect(categoriesSection).not.toContainText('دراجات الطريق');

      // Real products from the fixture's mock workspace products, including
      // one with a real image and others with none (honest missing-image
      // fallback, no invented thumbnail).
      await expect(arrivalsSection).toContainText('خوذة دراجة هوائية');
      await expect(arrivalsSection.locator('img').first()).toHaveAttribute('src', '/dev/fixtures/helmet.svg');

      // The removed static fixture's own Arabic strings must not leak
      // anywhere in either section.
      for (const fake of ['الإلكترونيات', 'سماعات لاسلكية', 'إبريق ترشيح', 'كريم عناية']) {
        await expect(categoriesSection).not.toContainText(fake);
        await expect(arrivalsSection).not.toContainText(fake);
      }

      await assertNoOverflow(page);
      await page.screenshot({ path: path.join(evidenceDir, `ar-${width}-home-catalog.png`), fullPage: true });
    });
  }

  test('AR desktop — real categories/new-arrivals render after adding them at the wide viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=single-draft');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);

    await addHomeSection(page, 'categories', false);
    await addHomeSection(page, 'newArrivals', false);

    const categoriesSection = page.locator('[data-preview-canvas] section[aria-labelledby="preview-categories"]').first();
    const arrivalsSection = page.locator('[data-preview-canvas] section[aria-labelledby="preview-arrivals"]').first();
    await expect(categoriesSection).toContainText('الدراجات الهوائية ومستلزماتها');
    await expect(arrivalsSection).toContainText('خوذة دراجة هوائية');
    // The variant-managed product (no media) and the bare product (no
    // media, no description/SKU) both render honestly with no image, not a
    // broken `<img>` or an invented placeholder photo.
    await expect(arrivalsSection).toContainText('قميص قطني');
    await expect(arrivalsSection).toContainText('منتج بسيط بلا وصف');

    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'ar-desktop-home-catalog.png'), fullPage: true });
  });

  test('EN desktop — real categories/new-arrivals render under LTR', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto('/dev/customizer-versions?locale=en&scenario=single-draft');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);
    await expect(page.locator('[data-experience-builder]')).toHaveAttribute('dir', 'ltr');

    await page.getByRole('button', { name: 'Homepage' }).click();
    await page.locator('[data-add-section]').click();
    await page.locator('[data-picker-option="categories"]').click();
    await page.locator('[data-add-section]').click();
    await page.locator('[data-picker-option="newArrivals"]').click();

    const categoriesSection = page.locator('[data-preview-canvas] section[aria-labelledby="preview-categories"]').first();
    const arrivalsSection = page.locator('[data-preview-canvas] section[aria-labelledby="preview-arrivals"]').first();
    // Category/product *names* are tenant data with a single `name` column
    // (no `name_en` for categories; this slice's own `ProductPreviewPickerPanel`-
    // style convention renders `product.name` directly, never a locale
    // switch) — the real Arabic name still renders correctly under an LTR
    // document direction, it is not translated.
    await expect(categoriesSection).toContainText('الدراجات الهوائية ومستلزماتها');
    await expect(arrivalsSection).toContainText('خوذة دراجة هوائية');

    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'en-desktop-home-catalog.png'), fullPage: true });
  });
});
