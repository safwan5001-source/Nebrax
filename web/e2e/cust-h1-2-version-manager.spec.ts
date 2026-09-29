import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-h1-2-version-manager');

async function assertNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

// المسار `/dev/customizer-versions` لا يضبط `<html dir>` (ذاك من طبقة تخطيط
// المنصة العامة)؛ اتجاه المحرِّر نفسه على جذره الداخلي `[data-experience-builder]`.
async function assertBuilderDir(page: Page, dir: 'rtl' | 'ltr') {
  await expect(page.locator('[data-experience-builder]')).toHaveAttribute('dir', dir);
}

// تفعيل وضع المعاينة وتحديد الجوال/سطح المكتب يحدثان بعد التحميل الأول عبر
// `useEffect` — ننتظر استقرارهما قبل القياس/التفاعل بدل الاعتماد فقط على
// `networkidle`.
async function waitForBuilderReady(page: Page) {
  await page.waitForSelector('[data-experience-builder]');
  await page.waitForTimeout(400);
}

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

test.describe('CUST-H1-2 — Version-aware Customizer UX', () => {
  test.beforeEach(() => {
    // كل اختبار هنا يضبط حجم النافذة صراحةً (390/430/768/1280/1440)؛ تشغيله
    // أيضاً تحت مشروع "mobile" (`isMobile`/`hasTouch` من Playwright) لا يضيف
    // تغطية ويُدخل انحرافاً بمقياس بكسل فرعي عند 1440 (طرحه فحص الفيضان).
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own explicit viewport');
  });

  test('desktop AR — toolbar Version selector shows name + state, manager opens with actions', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=single-draft');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);
    await assertBuilderDir(page, 'rtl');

    const selector = page.getByLabel('نسخة التصميم قيد التعديل');
    await expect(selector).toBeVisible();
    await expect(selector).toContainText('التصميم الحالي');
    await expect(selector).toContainText('مسودة');
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1440-ar-toolbar.png') });

    await selector.click();
    const manager = page.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    await expect(manager).toBeVisible();
    await expect(manager.getByRole('button', { name: 'فتح للتعديل' })).toBeVisible();
    await expect(manager.getByRole('button', { name: 'إعادة تسمية' })).toBeVisible();
    await expect(manager.getByRole('button', { name: 'تكرار النسخة' })).toBeVisible();
    // النسخة الوحيدة هنا هي أيضاً المفتوحة حالياً في المحرِّر، فحذفها مخفيّ
    // عمداً (`VersionManagerPanel`: `canDelete = state === 'draft' && !selected`)؛
    // حذف نسخة غير مفتوحة مُغطًّى في سيناريو «choose» أدناه وفي اختبارات Vitest.
    await expect(manager.getByRole('button', { name: 'حذف' })).toHaveCount(0);
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1440-ar-manager-open.png') });
  });

  test('desktop EN — Published version is read-only with a Create-Draft path, Publish stays gated', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto('/dev/customizer-versions?locale=en&scenario=published-readonly');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);
    await assertBuilderDir(page, 'ltr');

    await expect(page.getByText('This version is published and read-only')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create a draft from this version' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'نشر', exact: false }).or(page.getByRole('button', { name: 'Publish' }))).toBeDisabled();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1440-en-published-readonly.png') });
  });

  test('tablet 768 AR — layout remains coherent', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=single-draft');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'tablet-768-ar.png') });
  });

  test('mobile 390 AR — ambiguous choose state, then Version Manager as a bottom sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=choose');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);
    await assertNoOverflow(page);

    // الجوال معاينة أولاً افتراضياً (`mobilePane === "preview"`)، فرسالة
    // «اختر نسخة» في لوحة التحرير مخفية حتى ينتقل التاجر إليها؛ مؤشر النسخة
    // في الشريط العلوي، على العكس، ظاهر دوماً ويعكس الغموض بعدم عرض اسم.
    await expect(page.locator('[data-version-selector-mobile]')).toContainText('نسخ التصميم');
    await page.screenshot({ path: path.join(evidenceDir, 'mobile-390-ar-choose-state.png') });

    await page.getByText('نسخ التصميم').click();
    const sheet = page.getByRole('dialog', { name: 'إدارة نسخ التصميم' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('رمضان 1448')).toBeVisible();
    await expect(sheet.getByText('اليوم الوطني')).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'mobile-390-ar-manager-sheet.png') });

    await sheet.getByText('رمضان 1448').locator('xpath=ancestor::li[1]').getByRole('button', { name: 'فتح للتعديل' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-version-selector-mobile]')).toContainText('رمضان 1448');
  });

  test('mobile 430 EN — many versions with a long name: no overflow, sheet scrolls independently', async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto('/dev/customizer-versions?locale=en&scenario=many-long-names');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);
    await assertNoOverflow(page);

    await page.locator('[data-version-selector-mobile]').click();
    const sheet = page.getByRole('dialog', { name: 'Manage design versions' });
    await expect(sheet).toBeVisible();
    await assertNoOverflow(page);
    // Long name is truncated (ellipsis via CSS), never wrapped into overflow.
    const rows = sheet.locator('li[data-version-row]');
    await expect(rows).toHaveCount(6);
    await expect(sheet.locator('[data-version-state-label]', { hasText: 'Published' })).toBeVisible();
    await expect(sheet.locator('[data-version-state-label]', { hasText: 'Scheduled' })).toBeVisible();
    await page.screenshot({ path: path.join(evidenceDir, 'mobile-430-en-many-versions-sheet.png') });
  });

  test('desktop AR stress case — many versions + very long name in the manager popover', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/dev/customizer-versions?locale=ar&scenario=many-long-names');
    await page.waitForLoadState('networkidle');
    await waitForBuilderReady(page);

    await page.getByLabel('نسخة التصميم قيد التعديل').click();
    const manager = page.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    await expect(manager).toBeVisible();
    await expect(manager.locator('li[data-version-row]')).toHaveCount(6);
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-1280-ar-stress-many-versions.png') });
  });
});
