import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-H4-4 — real browser visual QA for Banner (incl. the new `imageAlt`
 * field), Benefits, Custom Content and App Promo's own inline Content tab.
 * Same `/dev/customizer-versions` fixture as CUST-H4-2/H4-3 (mounts the real
 * `ExperienceBuilder` in demo mode — no Laravel server, no login).
 *
 * Every scenario seeds an empty Home section list (same pre-existing fixture
 * property H4-3's own spec documents), so this spec adds each section type
 * through the real Section Library `onAdd` flow and authors content through
 * the real field inputs — the same path a merchant actually uses.
 */

const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-h4-4-section-completion');

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

type SectionType = 'banner' | 'benefits' | 'customContent' | 'appPromo';

/** Adds one Home section type via the real CUST-H4-2 Section Library UI and
 * leaves it selected (same `onSelectSection` behavior `addSection` already
 * has), so its own settings fields render immediately afterward. */
async function addHomeSection(page: Page, type: SectionType, isMobile: boolean, homeLabel: string) {
  if (isMobile) {
    if ((await page.getByRole('dialog').count()) === 0) {
      await page.getByRole('button', { name: /إضافة قسم|Add section/ }).first().click();
    }
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: /إضافة قسم|Add section/ }).click();
    await sheet.locator(`[data-picker-option="${type}"]`).click();
    return;
  }
  await page.getByRole('button', { name: homeLabel }).click();
  await page.locator('[data-add-section]').click();
  await page.locator(`[data-picker-option="${type}"]`).click();
}

/**
 * The desktop sidebar is CSS-hidden (not unmounted) at mobile widths, so a
 * bare `page.locator('[data-selected-section-settings="…"]')` matches two
 * elements once the mobile Bottom Sheet is open (same pre-existing fixture
 * quirk CUST-H4-3's own spec documents for the Canvas). On mobile, scope to
 * the open dialog; on desktop there is no dialog to scope to.
 */
function sectionPanel(page: Page, type: SectionType, isMobile: boolean) {
  const locator = `[data-selected-section-settings="${type}"]`;
  return isMobile ? page.getByRole('dialog').locator(locator) : page.locator(locator);
}

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

test.describe('CUST-H4-4 — Banner / Benefits / Custom Content / App Promo (visual)', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own explicit viewport');
  });

  for (const width of [390, 430]) {
    test(`AR ${width} — banner with image/alt/CTA, benefits, custom content, one app platform`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/dev/customizer-versions?locale=ar&scenario=single-draft');
      await page.waitForLoadState('networkidle');
      await waitForBuilderReady(page);
      await expect(page.locator('[data-experience-builder]')).toHaveAttribute('dir', 'rtl');

      // Banner — authored with a long title/subtitle to exercise wrapping,
      // a real https image, and the new imageAlt field.
      await addHomeSection(page, 'banner', true, 'الصفحة الرئيسية');
      const bannerPanel = sectionPanel(page, 'banner', true);
      await bannerPanel.getByLabel('العنوان').fill('عرض الصيف الكبير على جميع المنتجات المختارة لفترة محدودة جداً');
      await bannerPanel.getByLabel('النص', { exact: true }).fill('خصومات تصل إلى 50% على تشكيلة واسعة من المنتجات');
      await bannerPanel.getByLabel('نص الزر').fill('تسوّق الآن');
      await bannerPanel.getByLabel('رابط الزر').fill('https://example.com/sale');
      await bannerPanel.getByLabel('رابط الصورة (https)').fill('https://picsum.photos/seed/awj-banner/800/400');
      await bannerPanel.getByLabel(/النص البديل للصورة/).fill('صورة لمنتجات العرض الصيفي معروضة على طاولة خشبية');

      // Benefits — multiple items, one with a long body to exercise wrapping.
      await addHomeSection(page, 'benefits', true, 'الصفحة الرئيسية');
      const benefitsPanel = sectionPanel(page, 'benefits', true);
      await benefitsPanel.getByRole('button', { name: /إضافة ميزة|Add benefit/ }).click();
      await benefitsPanel.getByLabel('عنوان الميزة').first().fill('شحن مجاني فوري');
      await benefitsPanel.getByLabel('وصف الميزة').first().fill(
        'لجميع الطلبات التي تتجاوز 200 ريال سعودي داخل المملكة العربية السعودية بالكامل',
      );
      await benefitsPanel.getByRole('button', { name: /إضافة ميزة|Add benefit/ }).click();
      await benefitsPanel.getByLabel('عنوان الميزة').nth(1).fill('استرجاع مجاني خلال 14 يوماً');

      // Custom Content — a heading plus a paragraph.
      await addHomeSection(page, 'customContent', true, 'الصفحة الرئيسية');
      const customPanel = sectionPanel(page, 'customContent', true);
      await customPanel.getByRole('button', { name: /إضافة عنوان|Add heading/ }).click();
      await customPanel.getByLabel('النص').first().fill('من نحن');
      await customPanel.getByRole('button', { name: /إضافة فقرة|Add paragraph/ }).click();
      await customPanel.getByLabel('النص').nth(1).fill('متجر نبراس يقدّم تجربة تسوّق إلكترونية متكاملة لعملائه في المملكة.');

      // App Promo — authored inline from its own Content tab, one platform only.
      await addHomeSection(page, 'appPromo', true, 'الصفحة الرئيسية');
      const appPanel = sectionPanel(page, 'appPromo', true);
      await appPanel.getByLabel('اسم التطبيق').fill('تطبيق نبراس');
      await appPanel.getByLabel('رابط App Store').fill('https://apps.apple.com/app/id123456789');

      await assertNoOverflow(page);
      await page.screenshot({ path: path.join(evidenceDir, `ar-${width}-sections.png`), fullPage: true });
    });
  }

  test('AR desktop — banner without image, benefits, custom content, both app platforms', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=single-draft');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);

    await addHomeSection(page, 'banner', false, 'الصفحة الرئيسية');
    const bannerPanel = page.locator('[data-selected-section-settings="banner"]');
    await bannerPanel.getByLabel('العنوان').fill('عرض محدود');
    await bannerPanel.getByLabel('نص الزر').fill('اطلب الآن');
    await bannerPanel.getByLabel('رابط الزر').fill('/sale');
    // No image on purpose — proves the no-image layout stays correct.

    await addHomeSection(page, 'benefits', false, 'الصفحة الرئيسية');
    const benefitsPanel = page.locator('[data-selected-section-settings="benefits"]');
    await benefitsPanel.getByRole('button', { name: /إضافة ميزة|Add benefit/ }).click();
    await benefitsPanel.getByLabel('عنوان الميزة').first().fill('دعم فني على مدار الساعة');
    await benefitsPanel.getByLabel('وصف الميزة').first().fill('فريقنا متاح للمساعدة في أي وقت');

    await addHomeSection(page, 'customContent', false, 'الصفحة الرئيسية');
    const customPanel = page.locator('[data-selected-section-settings="customContent"]');
    await customPanel.getByRole('button', { name: /إضافة عنوان|Add heading/ }).click();
    await customPanel.getByLabel('النص').first().fill('الأسئلة الشائعة');

    await addHomeSection(page, 'appPromo', false, 'الصفحة الرئيسية');
    const appPanel = page.locator('[data-selected-section-settings="appPromo"]');
    await appPanel.getByLabel('اسم التطبيق').fill('تطبيق نبراس');
    await appPanel.getByLabel('رابط App Store').fill('https://apps.apple.com/app/id123456789');
    await appPanel.getByLabel('رابط Google Play').fill('https://play.google.com/store/apps/details?id=sa.awj');

    const canvas = page.locator('[data-preview-canvas]');
    await expect(canvas.locator('[data-preview-section-id] img')).toHaveCount(2); // both store badges, no banner image

    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'ar-desktop-sections.png'), fullPage: true });
  });

  test('EN desktop — same four sections under LTR', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/dev/customizer-versions?locale=en&scenario=single-draft');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);
    await expect(page.locator('[data-experience-builder]')).toHaveAttribute('dir', 'ltr');

    await addHomeSection(page, 'banner', false, 'Homepage');
    const bannerPanel = page.locator('[data-selected-section-settings="banner"]');
    await bannerPanel.getByLabel('Title').fill('Summer Sale');
    await bannerPanel.getByLabel('Image URL (https)').fill('https://picsum.photos/seed/awj-en/800/400');
    await bannerPanel.getByLabel(/Image alt text/).fill('Summer sale products on a wooden table');

    await addHomeSection(page, 'benefits', false, 'Homepage');
    const benefitsPanel = page.locator('[data-selected-section-settings="benefits"]');
    await benefitsPanel.getByRole('button', { name: 'Add benefit' }).click();
    await benefitsPanel.getByLabel('Benefit title').first().fill('Free shipping');

    await addHomeSection(page, 'customContent', false, 'Homepage');
    const customPanel = page.locator('[data-selected-section-settings="customContent"]');
    await customPanel.getByRole('button', { name: 'Add heading' }).click();
    await customPanel.getByLabel('Text').first().fill('About us');

    await addHomeSection(page, 'appPromo', false, 'Homepage');
    const appPanel = page.locator('[data-selected-section-settings="appPromo"]');
    await appPanel.getByLabel('App name').fill('AWJ App');
    await appPanel.getByLabel('Google Play URL').fill('https://play.google.com/store/apps/details?id=sa.awj');

    const bannerImg = page
      .locator('[data-preview-section-id="banner-1"] img, [data-preview-section] img')
      .first();
    await expect(bannerImg).toHaveAttribute('alt', 'Summer sale products on a wooden table');

    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'en-desktop-sections.png'), fullPage: true });
  });
});
